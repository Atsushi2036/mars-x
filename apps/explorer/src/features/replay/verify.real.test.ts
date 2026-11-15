import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeTrajectory, runSchema } from '@/intelligence/contracts'
import type { Terrain } from '@/intelligence'
import { verifyRun } from './verify'

const root = path.resolve(import.meta.dirname, '../../../../..')
const ds = path.join(root, 'data/processed/jezero-v1')
const runs = process.env.MARSX_RUNS_DIR ?? 'C:/Users/alfre/AppData/Local/Temp/claude/9fe24e7c521c5521/6360acb0-94bd-4e36-99d0-1a9bee8b82ba/scratchpad/runs'
const have = existsSync(path.join(ds, 'plan_slope.u8')) && existsSync(path.join(runs, 'ppo-L1.run.json'))

function terrain(): Terrain {
  const m = JSON.parse(readFileSync(path.join(ds, 'manifest.json'), 'utf8'))
  const enc = (id: string) => m.layers.find((l: { id: string }) => l.id === id).encoding
  const u8 = (id: string, name: string) => {
    const e = enc(id)
    const b = readFileSync(path.join(ds, name))
    return Float32Array.from(b, (v) => (v === e.nodata ? NaN : v * e.scale + (e.offset ?? 0)))
  }
  const h = enc('plan_height')
  const hb = readFileSync(path.join(ds, 'plan_height.u16'))
  const hv = new Uint16Array(hb.buffer, hb.byteOffset, hb.byteLength / 2)
  return { rows: 1024, cols: 1024, resM: 2, slope: u8('plan_slope', 'plan_slope.u8'), step: u8('plan_step', 'plan_step.u8'), height: Float32Array.from(hv, (v) => (v === h.nodata ? NaN : v * h.scale + h.offset)) }
}

// Integration check against real bench output; skipped when the data or the runs are not on this machine.
describe.skipIf(!have)('re-simulation of real runs', () => {
  for (const L of ['L1', 'L2', 'L3']) {
    it(`ppo-${L}`, async () => {
      const run = runSchema.parse(JSON.parse(readFileSync(path.join(runs, `ppo-${L}.run.json`), 'utf8').replace(/"seed": ?\d{16,}/g, '"seed":0')))
      const s = await verifyRun(run.episodes, run.scenario.id, terrain(), (e) => decodeTrajectory(e.trajectory!))
      console.log(L, JSON.stringify(s))
      expect(s.total).toBe(run.episodes.length)
    }, 120_000)
  }
})
