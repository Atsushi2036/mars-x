import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { decodeTrajectory, runSchema } from '@/intelligence/contracts'
import type { Terrain } from '@/intelligence'
import { verifyRun } from './verify'

const root = path.resolve(import.meta.dirname, '../../../../..')
const ds = path.join(root, 'data/processed/jezero-v1')
const fixture = path.join(root, 'packages/schemas/examples/run.real-l1-astar.json')
// optional: extra real runs (e.g. a PPO L2/L3 run) from a folder named by MARSX_RUNS_DIR, as <name>.run.json
const extra = process.env.MARSX_RUNS_DIR
const have = existsSync(path.join(ds, 'plan_slope.u8')) && existsSync(fixture)

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

// Integration check against real bench output; skipped when the processed dataset is not on this machine.
describe.skipIf(!have)('re-simulation of real runs', () => {
  const files = [fixture, ...(extra && existsSync(extra) ? readdirSync(extra).filter((f) => f.endsWith('.run.json')).map((f) => path.join(extra, f)) : [])]
  for (const f of files) {
    it(path.basename(f), async () => {
      const run = runSchema.parse(JSON.parse(readFileSync(f, 'utf8')))
      const s = await verifyRun(run.episodes, run.scenario.id, terrain(), (e) => decodeTrajectory(e.trajectory!))
      expect(s.total).toBe(run.episodes.length)
      expect(s.mismatched).toBe(0)
      expect(s.examples).toEqual([])
      if (f === fixture) expect(s).toMatchObject({ verified: 10, notResimulable: 0, state: 'verified' })
    }, 120_000)
  }
})
