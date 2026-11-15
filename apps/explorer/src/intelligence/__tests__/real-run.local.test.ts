import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeTrajectory, runSchema } from '../contracts'
import { LightingConditions, irradianceSeries } from '../conditions/lighting'
import { HorizonMaps, SunTable, f32FromBytes } from '../conditions/tables'
import { EnvLite, type EnvConfig } from '../sim/env-lite'
import { replayEpisode } from '../sim/replay'

/**
 * End-to-end check on a REAL run.json + the processed Jezero dataset. Skipped unless both exist locally
 * (MARSX_REAL_RUN=<run.json> and data/processed/jezero-v1). Replays every episode of the scenarios that need
 * no external conditions data (RTG rover: generation is constant) and requires zero discrepancies.
 */
const root = path.resolve(import.meta.dirname, '../../../../..')
const data = path.join(root, 'data/processed/jezero-v1')
const runPath = process.env.MARSX_REAL_RUN
const ready = Boolean(runPath && existsSync(runPath) && existsSync(path.join(data, 'manifest.json')))

function layer(id: string) {
  const m = JSON.parse(readFileSync(path.join(data, 'manifest.json'), 'utf8'))
  const l = m.layers.find((x: { id: string }) => x.id === id)
  const raw = readFileSync(path.join(data, l.path))
  const out = new Float32Array(1024 * 1024)
  const e = l.encoding
  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength)
  for (let i = 0; i < out.length; i++) {
    const q = e.dtype === 'uint8' ? raw[i]! : view.getUint16(2 * i, true)
    out[i] = q === e.nodata ? Number.NaN : q * (e.scale ?? 1) + (e.offset ?? 0)
  }
  return out
}

describe.runIf(ready)('real run replay (local only)', () => {
  it('re-simulates RTG episodes with zero discrepancies', async () => {
    const run = runSchema.parse(JSON.parse(readFileSync(runPath!, 'utf8')))
    const terrain = { rows: 1024, cols: 1024, resM: 2, slope: layer('plan_slope'), step: layer('plan_step'), height: layer('plan_height') }
    const cfg: EnvConfig = {
      kind: 'rtg_rover', maxSlopeDeg: 24, maxStepM: 0.525, speedMS: 0.042, gravity: run.conditions.gravity,
      reward: { energy: 0, risk: 0, time: 0, progress: 0.3, goal: 10, failure: 10, hazardAttempt: 1, stepCost: 0.1 },
      maxSteps: 800, energyOn: true, sensorRadiusM: 0, waitS: 60, sols: 1,
    }
    const env = new EnvLite(terrain, cfg)
    let n = 0
    const bad: string[] = []
    for (const ep of run.episodes) {
      if (ep.scenarioId !== 'jezero-v1/l2/rtg-storm' || !ep.trajectory) continue
      const rep = replayEpisode(env, ep, await decodeTrajectory(ep.trajectory))
      n++
      if (!rep.ok) bad.push(`#${ep.index}: ${rep.mismatches[0]}`)
    }
    console.log(`replayed ${n} rtg-storm episodes, ${bad.length} with discrepancies`, bad.slice(0, 5))
    expect(n).toBeGreaterThan(0)
    expect(bad).toEqual([])
  }, 120_000)

  it('re-simulates solar-storm episodes (sun tables + horizon + sky view) with zero discrepancies', async () => {
    const run = runSchema.parse(JSON.parse(readFileSync(runPath!, 'utf8')))
    const manifest = JSON.parse(readFileSync(path.join(data, 'manifest.json'), 'utf8'))
    const tables = manifest.layers
      .filter((l: { kind: string }) => l.kind === 'sun_table')
      .map((l: { path: string; table: { startUtc: string; stepS: number } }) => ({
        start: Date.parse(l.table.startUtc),
        t: new SunTable(f32FromBytes(new Uint8Array(readFileSync(path.join(data, l.path)))), { startMs: Date.parse(l.table.startUtc), stepS: l.table.stepS }),
      }))
      .sort((a: { start: number }, b: { start: number }) => a.start - b.start)
    const t0 = Date.parse('2022-01-07T04:14:50Z')
    const n = Math.ceil(88775.244 / 60) + 2
    const az = new Float64Array(n)
    const elev = new Float64Array(n)
    const rAu = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const ms = t0 + i * 60_000
      for (const { t } of tables) {
        try {
          const st = t.at(ms)
          az[i] = st.azimuthDeg
          elev[i] = st.elevationDeg
          rAu[i] = st.rAu
          break
        } catch {
          /* next table */
        }
      }
    }
    const { direct, diffuse } = irradianceSeries({ azDeg: az, elevDeg: elev, rAu }, 2.0)
    const hz = new Uint8Array(readFileSync(path.join(data, 'horizon.u8')))
    const sv = layer('sky_view')
    const hook = new LightingConditions({
      azDeg: az, elevDeg: elev, direct, diffuse, horizon: new HorizonMaps(hz, 1024, 1024), skyView: sv.map((v) => (Number.isNaN(v) ? 1 : v)), cols: 1024,
    })
    const terrain = { rows: 1024, cols: 1024, resM: 2, slope: layer('plan_slope'), step: layer('plan_step'), height: layer('plan_height') }
    const cfg: EnvConfig = {
      kind: 'solar_rover', maxSlopeDeg: 24, maxStepM: 0.525, speedMS: 0.042, gravity: run.conditions.gravity,
      reward: { energy: 0, risk: 0, time: 0, progress: 0.3, goal: 10, failure: 10, hazardAttempt: 1, stepCost: 0.1 },
      maxSteps: 800, energyOn: true, sensorRadiusM: 0, waitS: 60, sols: 1,
    }
    const env = new EnvLite(terrain, cfg, undefined, hook)
    let count = 0
    const bad: string[] = []
    for (const ep of run.episodes) {
      if (ep.scenarioId !== 'jezero-v1/l2/solar-storm' || !ep.trajectory) continue
      const rep = replayEpisode(env, ep, await decodeTrajectory(ep.trajectory))
      count++
      if (!rep.ok) bad.push(`#${ep.index}: ${rep.mismatches[0]}`)
    }
    console.log(`replayed ${count} solar-storm episodes, ${bad.length} with discrepancies`, bad.slice(0, 5))
    expect(count).toBeGreaterThan(0)
    expect(bad).toEqual([])
  }, 120_000)
})
