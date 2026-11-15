import * as Comlink from 'comlink'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EpisodePoint, EpisodeSample, GreedyEval, QParams, QSetup } from './lab/qlearn'
import type { QLearnWorkerApi } from './lab/qlearn.worker'
import { PlannerPool, type PlanAllResult, type PlanQuery } from './nav/planner-pool'
import { PolicyClient, type LoadedPolicy } from './policy/policy-client'
import { RunSession } from './replay/run-loader'
import type { InferResponse } from './policy/messages'

/**
 * React bindings for the intelligence services. All heavy work happens in Workers; these hooks only
 * hold state for the UI. Every hook terminates its Workers on unmount.
 */

// ---------------------------------------------------------------------------- planner

export interface PlannerLayers {
  /** grid side (cells); the planner is square-grid */
  n: number
  slopeDeg: Float32Array
  rough: Float32Array
  resM?: number
}

export function usePlanner(layers: PlannerLayers | null) {
  const poolRef = useRef<PlannerPool | null>(null)
  const seq = useRef(0)
  const [ready, setReady] = useState(false)
  const [planning, setPlanning] = useState(false)
  const [results, setResults] = useState<PlanAllResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!layers) return
    const pool = new PlannerPool()
    poolRef.current = pool
    let cancelled = false
    pool
      .setLayers(layers.n, layers.slopeDeg, layers.rough, layers.resM ?? 2)
      .then(() => {
        if (!cancelled) setReady(true)
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
      pool.dispose()
      poolRef.current = null
      setReady(false)
    }
  }, [layers])

  /** Latest request wins: results of superseded queries are dropped (dragging the goal marker). */
  const plan = useCallback(async (q: PlanQuery) => {
    const pool = poolRef.current
    if (!pool) return
    const mine = ++seq.current
    setPlanning(true)
    const res = await pool.planAll(q)
    if (mine !== seq.current) return
    setResults(res)
    setPlanning(false)
  }, [])

  return { ready, planning, results, error, plan }
}

// ---------------------------------------------------------------------------- Q-learning

export type QStatus = 'idle' | 'running' | 'paused'

/** How the training loop talks to the Watch view: batch size, which episodes to trace, and whether to wait for the animation. */
export interface WatchPlan {
  batch: number
  /** trace every N-th episode (0 = never; the last episode of a batch is always traced when > 0) */
  sampleEvery: number
  /** wait until the UI says it finished playing the traced episode before asking for the next batch */
  waitForPlayback: boolean
}

export interface LearnerSnapshot {
  value: Float32Array
  action: Uint8Array
  episode: number
}

const FLUSH_MS = 120
const SNAPSHOT_MS = 450

export function useQLearning(batchEpisodes = 25, evalEvery = 100) {
  const workerRef = useRef<Worker | null>(null)
  const apiRef = useRef<Comlink.Remote<QLearnWorkerApi> | null>(null)
  const loop = useRef(0)
  const plan = useRef<WatchPlan>({ batch: batchEpisodes, sampleEvery: 0, waitForPlayback: false })
  const playback = useRef<(() => void) | null>(null)
  const [status, setStatus] = useState<QStatus>('idle')
  const [curve, setCurve] = useState<EpisodePoint[]>([])
  const [evals, setEvals] = useState<GreedyEval[]>([])
  const [optimum, setOptimum] = useState<number | null>(null)
  const [params, setParamsState] = useState<QParams | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sample, setSample] = useState<EpisodeSample | null>(null)
  const [snapshot, setSnapshot] = useState<LearnerSnapshot | null>(null)

  const releasePlayback = useCallback(() => {
    const r = playback.current
    playback.current = null
    r?.()
  }, [])

  const stop = useCallback(() => {
    loop.current++
    releasePlayback()
    setStatus((s) => (s === 'running' ? 'paused' : s))
  }, [releasePlayback])

  /** The UI calls this when it has finished playing the traced episode (Slow mode waits for it). */
  const playbackDone = useCallback(() => releasePlayback(), [releasePlayback])
  const setPlan = useCallback((p: Partial<WatchPlan>) => {
    plan.current = { ...plan.current, ...p }
  }, [])

  const refreshSnapshot = useCallback(async (episode: number) => {
    const api = apiRef.current
    if (!api) return
    const s = await api.snapshot()
    setSnapshot({ value: s.value, action: s.action, episode })
  }, [])

  const run = useCallback(async () => {
    const api = apiRef.current
    if (!api) return
    const mine = ++loop.current
    setStatus('running')
    let buf: EpisodePoint[] = []
    let bufEvals: GreedyEval[] = []
    let lastFlush = 0
    let lastSnap = 0
    let episodes = 0
    const flush = () => {
      if (buf.length) {
        const add = buf
        setCurve((c) => (c.length > 20_000 ? [...c.slice(-10_000), ...add] : [...c, ...add]))
        buf = []
      }
      if (bufEvals.length) {
        const add = bufEvals
        setEvals((e) => [...e, ...add])
        bufEvals = []
      }
    }
    try {
      while (mine === loop.current) {
        const p = plan.current
        const b = await api.runBatchSampled(p.sampleEvery > 0 ? p.batch : batchEpisodes, evalEvery, p.sampleEvery > 0 ? p.sampleEvery : 0, 1)
        if (mine !== loop.current) break
        buf.push(...b.curve)
        bufEvals.push(...b.evals)
        episodes = b.episodes
        const now = performance.now()
        if (now - lastFlush > FLUSH_MS) {
          flush()
          lastFlush = now
        }
        if (p.sampleEvery > 0 && b.samples.length) {
          const s = b.samples[b.samples.length - 1]!
          flush()
          lastFlush = now
          setSample(s)
          if (p.waitForPlayback) {
            // the timer is a safety net: a hidden tab pauses requestAnimationFrame and the animation would never report back
            await Promise.race([new Promise<void>((r) => (playback.current = r)), new Promise<void>((r) => setTimeout(r, 15_000))])
            playback.current = null
          }
        }
        if (now - lastSnap > SNAPSHOT_MS) {
          lastSnap = now
          await refreshSnapshot(episodes)
        }
        await new Promise((r) => setTimeout(r, 0)) // let the UI breathe, keep the loop cancellable
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStatus('idle')
    } finally {
      flush()
      if (episodes > 0) void refreshSnapshot(episodes).catch(() => undefined)
    }
  }, [batchEpisodes, evalEvery, refreshSnapshot])

  const start = useCallback(
    async (setup: QSetup) => {
      loop.current++
      releasePlayback()
      workerRef.current?.terminate()
      const worker = new Worker(new URL('./lab/qlearn.worker.ts', import.meta.url), { type: 'module' })
      workerRef.current = worker
      const api = Comlink.wrap<QLearnWorkerApi>(worker)
      apiRef.current = api
      setCurve([])
      setEvals([])
      setSample(null)
      setSnapshot(null)
      setError(null)
      try {
        const init = await api.init(setup)
        setOptimum(Number.isFinite(init.optimum) ? init.optimum : null)
        setParamsState(init.params)
        void run()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
        setStatus('idle')
      }
    },
    [run, releasePlayback],
  )

  const setParams = useCallback(async (patch: Parameters<QLearnWorkerApi['setParams']>[0]) => {
    const api = apiRef.current
    if (!api) return
    try {
      setParamsState(await api.setParams(patch))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const greedyPath = useCallback(async () => apiRef.current?.greedyPath() ?? null, [])
  const valueMap = useCallback(async () => apiRef.current?.valueMap() ?? null, [])

  useEffect(
    () => () => {
      loop.current++
      playback.current?.()
      workerRef.current?.terminate()
    },
    [],
  )

  return { status, curve, evals, optimum, params, error, sample, snapshot, start, pause: stop, resume: run, setParams, setPlan, playbackDone, greedyPath, valueMap }
}

// ---------------------------------------------------------------------------- ONNX policy

export function usePolicy() {
  const client = useMemo(() => new PolicyClient(), [])
  const [loading, setLoading] = useState(false)
  const [policy, setPolicy] = useState<LoadedPolicy | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (file: Blob) => {
      setLoading(true)
      setError(null)
      setPolicy(null)
      try {
        setPolicy(await client.load(file))
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [client],
  )
  const infer = useCallback(
    async (obs: Float32Array, batch: number): Promise<InferResponse> => {
      try {
        return await client.infer(obs, batch)
      } catch (e) {
        setPolicy(null) // the client already terminated the worker
        setError(e instanceof Error ? e.message : String(e))
        throw e
      }
    },
    [client],
  )
  const unload = useCallback(() => {
    client.terminate()
    setPolicy(null)
  }, [client])

  useEffect(() => () => client.terminate(), [client])
  return { loading, policy, error, load, infer, unload }
}

// ---------------------------------------------------------------------------- run.json

export function useRunFile() {
  const sessionRef = useRef<RunSession | null>(null)
  const [loading, setLoading] = useState(false)
  const [session, setSession] = useState<RunSession | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (file: Blob) => {
    sessionRef.current?.close()
    sessionRef.current = null
    setSession(null)
    setError(null)
    setLoading(true)
    try {
      const s = await RunSession.open(file)
      sessionRef.current = s
      setSession(s)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])
  const close = useCallback(() => {
    sessionRef.current?.close()
    sessionRef.current = null
    setSession(null)
  }, [])

  useEffect(
    () => () => {
      sessionRef.current?.close()
    },
    [],
  )
  return { loading, session, result: session?.result ?? null, error, load, close }
}
