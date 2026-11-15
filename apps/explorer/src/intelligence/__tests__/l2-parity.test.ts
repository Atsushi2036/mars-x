import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { LightingConditions, irradianceSeries, netFluxF, surfaceIrradiance } from '../conditions/lighting'
import { HorizonMaps } from '../conditions/tables'
import { EnvLite, type EnvConfig } from '../sim/env-lite'

/** Fixture from the Python oracle (NavBatch + MarsConditions): idle energy on WAIT, solar generation with horizon and sky view, SPE rule. */
const doc = JSON.parse(readFileSync(path.resolve(import.meta.dirname, 'fixtures/env-l2lite-golden.json'), 'utf8'))

const buf = (b64: string) => {
  const b = Buffer.from(b64, 'base64')
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength)
}
const f64 = (b64: string) => new Float64Array(buf(b64))
const f32 = (b64: string) => new Float32Array(buf(b64))

interface Case {
  id: string
  rows: number
  cols: number
  resM: number
  kind: EnvConfig['kind']
  [k: string]: unknown
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function build(c: Case & Record<string, any>) {
  const n = c.rows * c.cols
  const terrain = { rows: c.rows, cols: c.cols, resM: c.resM, slope: new Float32Array(n), step: new Float32Array(n), height: new Float32Array(n) }
  const cfg: EnvConfig = {
    kind: c.kind, maxSlopeDeg: c.maxSlopeDeg, maxStepM: c.maxStepM, speedMS: c.speedMS, gravity: c.gravity,
    reward: {
      energy: c.reward.energy, risk: c.reward.risk, time: c.reward.time, progress: c.reward.progress, goal: c.reward.goal,
      failure: c.reward.failure, hazardAttempt: c.reward.hazard_attempt, stepCost: c.reward.step_cost,
    },
    maxSteps: c.maxSteps, energyOn: c.energyOn, sensorRadiusM: c.sensorRadiusM, waitS: c.waitS, sols: c.sols, spe: c.spe,
  }
  const m = c.minutes
  const hook = new LightingConditions({
    azDeg: f64(m.az), elevDeg: f64(m.elev), direct: f64(m.direct), diffuse: f64(m.diffuse),
    horizon: new HorizonMaps(new Uint8Array(buf(c.horizon)), c.rows, c.cols), skyView: f32(c.skyView), cols: c.cols,
  })
  return { env: new EnvLite(terrain, cfg, new Uint8Array(buf(c.rocks)), hook), hook }
}

describe('L2 dynamics parity with python (idle on WAIT, solar generation, SPE)', () => {
  it('fixture spec', () => expect(doc.specVersion).toBe('envl2lite/1'))
  for (const c of doc.cases) {
    it(`${c.id}: every step (cell, time, battery, energy, outcome, SPE state, goal, reward)`, () => {
      const { env } = build(c)
      env.reset(c.start, c.goal, { alertTS: c.alertT ?? undefined, initialSoc: c.initialSoc ?? undefined })
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      c.steps.forEach((g: Record<string, any>, i: number) => {
        const r = env.step(g.action)
        const s = env.state
        const at = `${c.id} step ${i}`
        expect([s.row, s.col], at).toEqual(g.cell)
        expect(Math.abs(s.tS - g.tS), `${at} tS`).toBeLessThan(1e-9)
        expect(Math.abs(s.soc - g.soc), `${at} soc`).toBeLessThan(1e-6)
        expect(Math.abs(s.energyWh - g.energyWh), `${at} energy`).toBeLessThan(1e-6)
        expect(s.outcome, `${at} outcome`).toBe(g.outcome)
        expect(s.speState, `${at} spe`).toBe(g.speState)
        expect([s.goalRow, s.goalCol], `${at} goal`).toEqual(g.goal)
        expect(r.terminated).toBe(g.terminated)
        expect(r.truncated).toBe(g.truncated)
        expect(Math.abs(r.reward - g.reward), `${at} reward`).toBeLessThan(1e-5)
      })
    })
  }
})

describe('insolation port (Appelbaum and Flood 1990) against python', () => {
  for (const c of doc.cases.filter((x: Case) => x.kind === 'solar_rover').slice(0, 2)) {
    it(`${c.id}: per-minute direct/diffuse from sun position`, () => {
      const m = c.minutes
      const mine = irradianceSeries({ azDeg: f64(m.az), elevDeg: f64(m.elev), rAu: f64(m.rAu) }, c.tau)
      const d = f64(m.direct)
      const f = f64(m.diffuse)
      let worst = 0
      for (let i = 0; i < m.n; i++) worst = Math.max(worst, Math.abs(mine.direct[i]! - d[i]!), Math.abs(mine.diffuse[i]! - f[i]!))
      expect(worst).toBeLessThan(1e-6)
    })
  }
  it('range checks and night', () => {
    expect(() => netFluxF(30, 7)).toThrow(RangeError)
    expect(() => netFluxF(30, 1, 0.9)).toThrow(RangeError)
    expect(surfaceIrradiance(95, 0.5, 1.5)).toEqual({ global: 0, direct: 0, diffuse: 0 })
  })
})
