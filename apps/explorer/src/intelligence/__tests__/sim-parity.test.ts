import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { OBS_DIM, runSchema, type Episode } from '../contracts'
import { EnvLite, type EnvConfig } from '../sim/env-lite'
import { computeMetrics, diffMetrics, alertCompliance, failureTaxonomy } from '../sim/metrics'

/** Fixtures generated from the Python oracle (NavBatch / bench.metrics); see fixtures/README in the commit message. */
const fx = (name: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'fixtures', name), 'utf8'))

const f32 = (b64: string) => {
  const b = Buffer.from(b64, 'base64')
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
const u8 = (b64: string) => new Uint8Array(Buffer.from(b64, 'base64'))

interface Step {
  action: number
  reward: number
  terminated: boolean
  truncated: boolean
  cell: [number, number]
  tS: number
  soc: number
  energyWh: number
  pathM: number
  pathCost: number
  steps: number
  violations: number
  timeSlopeGt15S: number
  shield: number
  outcome: string
}

const env = fx('env-golden.json')

describe('env-lite parity with python NavBatch (obs/1 + step)', () => {
  it('fixture is the expected spec', () => {
    expect(env.specVersion).toBe('envgolden/1')
    expect(env.obsDim).toBe(OBS_DIM)
  })
  for (const c of env.cases) {
    it(`${c.id}: observations (1e-6) and every step state`, () => {
      const rc = c.config.reward
      const cfg: EnvConfig = {
        kind: c.config.kind,
        maxSlopeDeg: c.config.maxSlopeDeg,
        maxStepM: c.config.maxStepM,
        speedMS: c.config.speedMS,
        gravity: c.config.gravity,
        reward: {
          energy: rc.energy,
          risk: rc.risk,
          time: rc.time,
          progress: rc.progress,
          goal: rc.goal,
          failure: rc.failure,
          hazardAttempt: rc.hazard_attempt,
          stepCost: rc.step_cost,
        },
        maxSteps: c.config.maxSteps,
        energyOn: c.config.energyOn,
        sensorRadiusM: c.config.sensorRadiusM,
        waitS: c.config.waitS,
        sols: c.config.sols,
      }
      const terrain = { rows: c.rows, cols: c.cols, resM: c.resM, slope: f32(c.terrain.slope), step: f32(c.terrain.step), height: f32(c.terrain.height) }
      const sim = new EnvLite(terrain, cfg, u8(c.rocks))
      const obsAt = (i: number) => f32(c.obs[String(i)])
      const compare = (i: number, o: Float32Array) => {
        const g = obsAt(i)
        expect(o.length).toBe(OBS_DIM)
        let worst = 0
        let at = -1
        for (let k = 0; k < OBS_DIM; k++) {
          const d = Math.abs(o[k]! - g[k]!)
          if (d > worst) {
            worst = d
            at = k
          }
        }
        expect(worst, `obs step ${i} worst index ${at}`).toBeLessThan(1e-6)
      }
      compare(0, sim.reset(c.start, c.goal))
      const steps = c.steps as Step[]
      steps.forEach((g, idx) => {
        const r = sim.step(g.action)
        const s = sim.state
        expect([s.row, s.col]).toEqual(g.cell)
        expect(s.steps).toBe(g.steps)
        expect(s.violations).toBe(g.violations)
        expect(s.outcome).toBe(g.outcome)
        expect(r.terminated).toBe(g.terminated)
        expect(r.truncated).toBe(g.truncated)
        expect(Math.abs(s.tS - g.tS)).toBeLessThan(1e-9)
        expect(Math.abs(s.soc - g.soc)).toBeLessThan(1e-6)
        expect(Math.abs(s.energyWh - g.energyWh)).toBeLessThan(1e-6)
        expect(Math.abs(s.pathM - g.pathM)).toBeLessThan(1e-9)
        expect(Math.abs(s.pathCost - g.pathCost)).toBeLessThan(1e-5)
        expect(Math.abs(s.timeSlopeGt15S - g.timeSlopeGt15S)).toBeLessThan(1e-9)
        expect(s.shield).toBe(g.shield)
        expect(Math.abs(r.reward - g.reward)).toBeLessThan(1e-5)
        if (c.obsSteps.includes(idx + 1)) compare(idx + 1, sim.observe())
      })
    })
  }
})

describe('metrics parity with python bench.metrics', () => {
  const doc = fx('metrics-golden.json')
  for (const c of doc.cases) {
    it(`${c.name}: recomputed metrics equal Python's`, () => {
      const eps = c.episodes as Episode[]
      const m = computeMetrics(eps)
      const claimed = c.metrics
      expect(diffMetrics(claimed, m, 1e-9)).toEqual([])
      expect(alertCompliance(eps)).toBe(c.alertCompliance)
      expect(failureTaxonomy(eps)).toEqual(c.taxonomy)
    })
  }
  it('diffMetrics flags a doctored success rate', () => {
    const c = doc.cases[0]
    const m = computeMetrics(c.episodes)
    const diff = diffMetrics({ ...c.metrics, success: 0.99 }, m)
    expect(diff.map((d) => d.field)).toEqual(['success'])
  })
  it('the repo example run.json parses and its metrics recompute', () => {
    const ex = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../../../packages/schemas/examples/run.example.json'), 'utf8'))
    const run = runSchema.parse(ex)
    expect(diffMetrics(run.metrics, computeMetrics(run.episodes), 1e-4)).toEqual([]) // example is hand-rounded to 4 decimals
  })
})
