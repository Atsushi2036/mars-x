import { describe, expect, it } from 'vitest'
import { EnvLite, type EnvConfig } from '../sim/env-lite'

const cfg: EnvConfig = {
  kind: 'rtg_rover', maxSlopeDeg: 24, maxStepM: 0.525, speedMS: 0.042, gravity: 3.69,
  reward: { energy: 0, risk: 0, time: 0, progress: 0.3, goal: 10, failure: 10, hazardAttempt: 1, stepCost: 0.1 },
  maxSteps: 10, energyOn: true, sensorRadiusM: 0, waitS: 60, sols: null,
}
function flat(n = 6) {
  const z = new Float32Array(n * n)
  return { rows: n, cols: n, resM: 2, slope: z.slice(), step: z.slice(), height: z.slice() }
}

describe('EnvLite', () => {
  it('refuses to cut a blocked corner (NE from (2,2) with (1,2) steep) and counts the attempt', () => {
    const t = flat()
    t.slope[1 * 6 + 2] = 40
    const env = new EnvLite(t, cfg)
    env.reset([2, 2], [0, 4])
    const r = env.step(4) // NE
    expect(env.state).toMatchObject({ row: 2, col: 2, shield: 1 })
    expect(r.reward).toBeCloseTo(-1)
  })
  it('observation has 505 finite float32 values in range', () => {
    const env = new EnvLite(flat(), cfg)
    const o = env.reset([2, 2], [5, 5])
    expect(o.length).toBe(505)
    expect(o.every((v) => Number.isFinite(v) && v >= -1 && v <= 1)).toBe(true)
  })
  it('times out at maxSteps and ignores steps after the episode ends', () => {
    const env = new EnvLite(flat(), cfg)
    env.reset([2, 2], [5, 5])
    let last = env.step(8)
    for (let i = 0; i < 12; i++) last = env.step(8)
    expect(env.state.outcome).toBe('timeout')
    expect(env.state.steps).toBe(10)
    expect(last.reward).toBe(0)
  })
  it('rejects invalid actions and out-of-grid starts', () => {
    const env = new EnvLite(flat(), cfg)
    expect(() => env.reset([9, 9], [0, 0])).toThrow()
    env.reset([1, 1], [4, 4])
    expect(() => env.step(9)).toThrow()
    expect(() => env.step(1.5)).toThrow()
  })
})
