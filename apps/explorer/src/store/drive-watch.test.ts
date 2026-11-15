import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ACTIONS } from '@/intelligence/contracts'
import { useUserModel } from '@/intelligence/drive/user-model'
import { PolicyClient } from '@/intelligence/policy/policy-client'
import type { Terrain } from '@/intelligence/sim/env-lite'
import { useApp } from './app'
import { useDriver } from './driver'
import { setPolicyClientFactory, startAiWatch } from './drive-watch'
import { useMission, type ProfileOutcome } from './mission'
import { usePlayback } from './playback'
import { roverLive, useRover } from './rover'
import { watchCtx } from './watch'

const N = 24
const terrain: Terrain = { rows: N, cols: N, resM: 2, slope: new Float32Array(N * N).fill(2), step: new Float32Array(N * N).fill(0.05), height: new Float32Array(N * N) }
vi.mock('@/features/replay/sim-terrain', () => ({ loadSimTerrain: async () => terrain }))

const route: ProfileOutcome = {
  status: 'ok',
  path: [
    { x: 5, z: 5 },
    { x: 35, z: 31 },
  ],
  stats: { lengthM: 40, maxSlopeDeg: 2, meanSlopeDeg: 2, climbM: 0 },
  expanded: 0,
  ms: 0,
}

/** a fake worker client: loads anything, drives greedily toward the goal from obs/1 */
class Greedy extends PolicyClient {
  override async load() {
    return { info: { opset: 20, nodeCount: 1, ops: ['Gemm'], outputName: 'logits' as const }, sha256: 'x'.repeat(64), bytes: 1 }
  }
  override async infer(obs: Float32Array) {
    const dr = obs[486]!
    const dc = obs[487]!
    let best = 8
    let score = -Infinity
    ACTIONS.forEach(([, r, c], i) => {
      if (i !== 8 && r * dr + c * dc > score) {
        score = r * dr + c * dc
        best = i
      }
    })
    return { actions: Int32Array.of(best), logits: null, ms: 0 }
  }
  override terminate() {}
}
class Broken extends Greedy {
  override async load(): Promise<never> {
    throw new Error('not an ONNX file')
  }
}

const settle = async (pred: () => boolean) => {
  for (let i = 0; i < 400 && !pred(); i++) await new Promise((r) => setTimeout(r, 5))
}

describe('AI drive in Watch', () => {
  beforeEach(() => {
    usePlayback.getState().exit()
    useRover.getState().stop()
    useDriver.setState({ kind: 'user', phase: 'idle', notice: null, summary: null, catalog: [] })
    useApp.setState({ dataset: { base: '/data/test' } as never })
    useMission.setState({ profile: 'rover-rtg', outcomes: { 'rover-rtg': route }, layers: { grid: { n: N, res: 2, x0: 0, y0: 0 } } as never })
    useUserModel.setState({ file: new File([new Uint8Array([1])], 'mine.onnx'), catalogId: null })
    roverLive.ready = true
  })

  it('runs the policy live from the route start to its goal and reports a real outcome', async () => {
    setPolicyClientFactory(() => new Greedy())
    expect(await startAiWatch('user')).toBe(true)
    expect(usePlayback.getState().ai).toBe(true)
    expect(usePlayback.getState().source).toBe('route')
    await settle(() => useDriver.getState().phase === 'done')
    const s = useDriver.getState().summary
    expect(s?.outcome).toBe('success')
    expect(s?.steps).toBeGreaterThan(5)
    expect(s?.astarM).toBeGreaterThan(30)
    // the agent starts on the route origin (cell centre) and the trail grows while it runs
    const ctx = watchCtx.current
    expect(ctx?.kind === 'run' && ctx.live?.track.count).toBeGreaterThan(5)
    expect(roverLive.x).toBeCloseTo(5, 0)
  })

  it('the replay of an AI drive moves at the same visual speed as the A* route Watch, with the same clock', async () => {
    const { curveFor } = await import('@/core/rover/curve')
    const { visualSpeed, startRouteWatch } = await import('./watch')
    setPolicyClientFactory(() => new Greedy())
    await startAiWatch('user')
    const ctx = watchCtx.current
    const aiSpeed = ctx?.kind === 'run' ? ctx.live?.speed : undefined
    const aiScale = usePlayback.getState().timeScale
    expect(aiSpeed).toBe(visualSpeed(curveFor(route.path).length, false))
    usePlayback.getState().exit()
    useUserModel.setState({ file: null })
    startRouteWatch()
    const r = watchCtx.current
    expect(r?.kind === 'route' && r.speed).toBe(aiSpeed)
    expect(usePlayback.getState().timeScale).toBe(aiScale)
  })

  it('falls back to the A* Watch, with a notice, when the model cannot be loaded', async () => {
    setPolicyClientFactory(() => new Broken())
    await startAiWatch('user')
    expect(usePlayback.getState().source).toBe('route')
    expect(usePlayback.getState().ai).toBe(false)
    expect(useDriver.getState().notice).toMatch(/Could not run the model: not an ONNX file.*A\* plan/)
    expect(useDriver.getState().phase).toBe('idle')
  })

  it('falls back when no model is loaded for Your model', async () => {
    useUserModel.setState({ file: null })
    setPolicyClientFactory(() => new Greedy())
    await startAiWatch('user')
    expect(usePlayback.getState().ai).toBe(false)
    expect(useDriver.getState().notice).toMatch(/No model is loaded/)
  })

  it('warns when the route is outside the 40-700 m the reference policy was trained on', async () => {
    useMission.setState({ outcomes: { 'rover-rtg': { ...route, path: [{ x: 5, z: 5 }, { x: 9, z: 9 }] } as ProfileOutcome } })
    setPolicyClientFactory(() => new Greedy())
    await startAiWatch('user')
    expect(useDriver.getState().notice).toMatch(/shorter than the 40-700 m/)
  })

  it('exiting the Watch aborts the drive and frees the worker', async () => {
    let terminated = 0
    class Slow extends Greedy {
      override async infer(obs: Float32Array) {
        await new Promise((r) => setTimeout(r, 2))
        return super.infer(obs)
      }
      override terminate() {
        terminated++
      }
    }
    setPolicyClientFactory(() => new Slow())
    await startAiWatch('user')
    const { stopAiDrive } = await import('./drive-watch')
    usePlayback.getState().exit()
    stopAiDrive()
    expect(terminated).toBeGreaterThan(0)
  })
})
