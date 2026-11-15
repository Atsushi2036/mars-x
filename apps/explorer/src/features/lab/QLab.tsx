import { CircleAlert, Pause, Play, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Slider } from '@/components/ui/slider'
import { worldToCell } from '@/core/mission/geometry'
import { astar, PROFILES, useQLearning } from '@/intelligence'
import { useApp } from '@/store/app'
import { useMission } from '@/store/mission'
import { Section } from '@/ui/panels/Section'
import { fmtNum } from '../shared/fmt'
import { compareVerdict, summarizeCurve } from './curve'
import { RewardChart } from './LineChart'
import { PathMap } from './PathMap'
import { buildQProblem, DEFAULT_WEIGHTS, type QProblem, type RewardWeights } from './problem'

const PROFILE = PROFILES['rover-rtg']

function timedAstar(p: QProblem) {
  const t0 = performance.now()
  const result = astar(p.cost, p.rows, p.cols, p.start, p.goal)
  return { result, ms: performance.now() - t0 }
}

function Param({ id, label, value, min, max, step, digits = 2, onChange, hint }: { id: string; label: string; value: number; min: number; max: number; step: number; digits?: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-baseline justify-between">
        <label id={id} className="text-xs text-muted-foreground">
          {label}
        </label>
        <span className="font-mono text-xs tabular-nums">{value.toFixed(digits)}</span>
      </div>
      <Slider aria-labelledby={id} min={min} max={max} step={step} value={[value]} onValueChange={([v]) => v !== undefined && onChange(v)} />
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border px-2.5 py-2">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className="font-mono text-sm tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  )
}

export function QLab() {
  const ds = useApp((s) => s.dataset)
  const layers = useMission((s) => s.layers)
  const layersStatus = useMission((s) => s.layersStatus)
  const layersError = useMission((s) => s.layersError)
  const ensureLayers = useMission((s) => s.ensureLayers)
  const origin = useMission((s) => s.origin)
  const destination = useMission((s) => s.destination)

  const [alpha, setAlpha] = useState(0.2)
  const [gamma, setGamma] = useState(0.99)
  const [epsilon, setEpsilon] = useState(1)
  const [weights, setWeights] = useState<RewardWeights>(DEFAULT_WEIGHTS)
  const q = useQLearning(25, 100)
  const [trained, setTrained] = useState<QProblem | null>(null)
  const [greedy, setGreedy] = useState<Uint32Array | null>(null)
  const startedAt = useRef(0)
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (ds) void ensureLayers(ds)
  }, [ds, ensureLayers])

  const preview = useMemo(() => {
    if (!layers) return null
    const g = layers.grid
    const o = origin ? worldToCell(g, origin.x, origin.z) : null
    const d = destination ? worldToCell(g, destination.x, destination.z) : null
    return buildQProblem({ n: g.n, slopeDeg: layers.slope, roughM: layers.rough, resM: g.res, maxSlopeDeg: PROFILE.maxSlope, weights, origin: o, destination: d })
  }, [layers, origin, destination, weights])

  const shown = trained ?? preview
  const optimum = useMemo(() => {
    if (!shown) return null
    return timedAstar(shown)
  }, [shown])

  // keep the learner's alpha and gamma live while it trains
  const { setParams, status } = q
  useEffect(() => {
    if (status !== 'idle') void setParams({ alpha, gamma })
  }, [alpha, gamma, status, setParams])

  // refresh the greedy path while training and once after it stops
  const { greedyPath } = q
  useEffect(() => {
    if (status === 'idle') return
    let live = true
    const tick = () => void greedyPath().then((g) => live && g && setGreedy(g.path))
    tick()
    if (status !== 'running') return () => void (live = false)
    const id = setInterval(tick, 1200)
    return () => {
      live = false
      clearInterval(id)
    }
  }, [status, greedyPath])

  useEffect(() => {
    if (status !== 'running') return
    const id = setInterval(() => setElapsed((performance.now() - startedAt.current) / 1000), 250)
    return () => clearInterval(id)
  }, [status])

  const train = useCallback(() => {
    if (!preview) return
    setTrained(preview)
    setGreedy(null)
    startedAt.current = performance.now()
    setElapsed(0)
    void q.start({
      rows: preview.rows,
      cols: preview.cols,
      cost: preview.cost,
      start: preview.start,
      goal: preview.goal,
      seed: 20261115,
      params: { alpha, gamma, epsilonStart: epsilon, epsilonDecay: 0.998, maxStepsPerEpisode: 600, reward: { wShaping: 0.5 } },
    })
  }, [preview, q, alpha, gamma, epsilon])

  const chart = useMemo(() => summarizeCurve(q.curve), [q.curve])
  const lastEval = q.evals.length ? q.evals[q.evals.length - 1]! : null
  const episodes = q.curve.length ? q.curve[q.curve.length - 1]!.episode : 0
  const recent = q.curve.slice(-100)
  const successRate = recent.length ? recent.filter((p) => p.reachedGoal).length / recent.length : null
  const astarPath = optimum?.result.status === 'ok' ? optimum.result.path : null
  const astarCost = optimum?.result.status === 'ok' ? optimum.result.cost : null

  const reason = !ds || layersStatus === 'idle' || layersStatus === 'loading' ? 'Loading the planning layers…' : layersStatus === 'error' ? 'The planning layers failed to load.' : !preview ? 'No free route on this crop: every cell is too steep.' : null
  const running = q.status === 'running'

  return (
    <div>
      <Section title="Q-learning, live" hint="Tabular Q-learning on a downsampled grid. It learns from scratch, in your browser, in a Worker.">
        {layersStatus === 'error' && (
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>Planning layers failed to load</AlertTitle>
            <AlertDescription>{layersError}</AlertDescription>
          </Alert>
        )}
        {reason && layersStatus !== 'error' && !preview && (
          <div className="space-y-2" role="status" aria-label={reason}>
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="aspect-square w-full" />
          </div>
        )}
        {shown && (
          <div className="space-y-1.5">
            <PathMap problem={shown} astarPath={astarPath} greedyPath={greedy} />
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-chart-1" aria-hidden="true" /> A* path
              </span>
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded bg-chart-2" aria-hidden="true" /> Learned policy
              </span>
              <span className="ml-auto font-mono tabular-nums">
                {shown.cols}×{shown.rows} cells · {fmtNum(shown.cellM, 0)} m each
              </span>
            </div>
            <p className="text-[11px] text-muted-foreground">
              {shown.endpoints === 'mission' ? 'Endpoints come from your Mission origin and destination.' : 'Default endpoints. Place an origin and a destination in Mission mode to train on your own route.'} Profile: {PROFILE.label}, {PROFILE.maxSlope}° limit.
            </p>
          </div>
        )}
      </Section>

      <Section title="Hyper-parameters" hint="Learning rate and discount update live. Exploration and reward weights apply on the next Train.">
        <div className="space-y-3">
          <Param id="q-alpha" label="Learning rate (α)" value={alpha} min={0.02} max={1} step={0.01} onChange={setAlpha} />
          <Param id="q-gamma" label="Discount (γ)" value={gamma} min={0.8} max={1} step={0.005} digits={3} onChange={setGamma} />
          <Param id="q-eps" label="Exploration at start (ε)" value={epsilon} min={0.05} max={1} step={0.05} onChange={setEpsilon} />
        </div>
      </Section>

      <Section title="Reward weights" hint="Each step is priced from the terrain: time is distance, energy is climbing effort, risk is steep and rough ground.">
        <div className="space-y-3">
          <Param id="w-energy" label="Energy" value={weights.energy} min={0} max={3} step={0.1} digits={1} onChange={(v) => setWeights((w) => ({ ...w, energy: v }))} />
          <Param id="w-risk" label="Risk" value={weights.risk} min={0} max={3} step={0.1} digits={1} onChange={(v) => setWeights((w) => ({ ...w, risk: v }))} />
          <Param id="w-time" label="Time" value={weights.time} min={0.2} max={3} step={0.1} digits={1} onChange={(v) => setWeights((w) => ({ ...w, time: v }))} />
        </div>
      </Section>

      <Section title="Train">
        <div className="flex gap-2">
          <Button className="h-10 flex-1 md:h-8" disabled={!!reason || running} onClick={train} aria-describedby={reason ? 'train-why' : undefined}>
            <Play /> {q.status === 'idle' ? 'Train' : 'Train again'}
          </Button>
          {running ? (
            <Button variant="outline" className="h-10 md:h-8" onClick={q.pause}>
              <Pause /> Pause
            </Button>
          ) : (
            <Button variant="outline" className="h-10 md:h-8" disabled={q.status !== 'paused'} onClick={() => void q.resume()}>
              <RotateCcw /> Resume
            </Button>
          )}
        </div>
        {reason && (
          <p id="train-why" className="text-[11px] text-muted-foreground">
            Disabled: {reason}
          </p>
        )}
        {q.error && (
          <Alert variant="destructive" role="alert">
            <CircleAlert />
            <AlertTitle>Training stopped</AlertTitle>
            <AlertDescription>{q.error}</AlertDescription>
          </Alert>
        )}
        {q.status !== 'idle' && (
          <div className="grid grid-cols-3 gap-2" aria-live="polite">
            <Stat label="Episodes" value={fmtNum(episodes, 0)} />
            <Stat label="Goal reached" value={successRate === null ? 'No data' : `${Math.round(successRate * 100)}%`} sub="last 100" />
            <Stat label="Time" value={`${elapsed.toFixed(0)} s`} />
          </div>
        )}
      </Section>

      <Section title="Reward per episode">
        <RewardChart points={chart} />
      </Section>

      <Section title="Greedy policy vs A*">
        <div className="grid grid-cols-2 gap-2">
          <Stat label="A* optimum" value={astarCost === null ? 'No route' : fmtNum(astarCost, 1)} sub={optimum ? `found in ${optimum.ms.toFixed(1)} ms, no training` : undefined} />
          <Stat label="Learned policy" value={lastEval?.reached ? fmtNum(lastEval.pathCost, 1) : 'Not there yet'} sub={lastEval?.ratio ? `${fmtNum(lastEval.ratio, 3)}× the optimum` : undefined} />
        </div>
        <p className="text-xs">{compareVerdict(lastEval)}</p>
        <p className="rounded-md bg-surface px-2.5 py-2 text-[11px] leading-4 text-muted-foreground">
          A* plans, it does not learn. It searches the known map and is optimal on it. Q-learning has to discover the same route through trial and error, so on a known map it can only match A*, not beat it. Learning pays off when the map is unknown, which is what the benchmark levels L2 and L3 test.
        </p>
      </Section>
    </div>
  )
}
