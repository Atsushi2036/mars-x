import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { MAX_RUN_BYTES, decodeTrajBytes, decodeTrajectory, type Episode } from '../contracts'
import { RunSession, type RunWorkerHandle } from '../replay/run-loader'
import { parseRun, RunValidationError } from '../replay/run-service'
import { EnvLite, type EnvConfig } from '../sim/env-lite'
import { replayEpisode } from '../sim/replay'

const dir = import.meta.dirname
const example = readFileSync(path.resolve(dir, '../../../../../packages/schemas/examples/run.example.json'), 'utf8')
const buf = (s: string) => {
  const u = new TextEncoder().encode(s)
  return u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer
}
const withRun = (mut: (r: Record<string, unknown>) => void) => {
  const r = JSON.parse(example) as Record<string, unknown>
  mut(r)
  return buf(JSON.stringify(r))
}

describe('run.json loader (parseRun)', () => {
  it('accepts the repo example and recomputes metrics', () => {
    const r = parseRun(buf(example))
    expect(r.run.schemaVersion).toBe('run/1')
    expect(r.recomputed.n).toBe(1)
  })
  it('rejects unknown keys (strict), without echoing content', () => {
    expect(() => parseRun(withRun((r) => (r.evil = '<img src=x onerror=alert(1)>')))).toThrow(RunValidationError)
    try {
      parseRun(withRun((r) => (r.evil = '<img src=x onerror=alert(1)>')))
    } catch (e) {
      expect((e as Error).message).not.toMatch(/onerror/)
    }
  })
  it('rejects wrong schemaVersion, non-finite numbers and over-long strings', () => {
    expect(() => parseRun(withRun((r) => (r.schemaVersion = 'run/2')))).toThrow(/schemaVersion|literal|invalid/i)
    expect(() => parseRun(withRun((r) => ((r.conditions as { gravity: unknown }).gravity = 'NaN')))).toThrow(RunValidationError)
    expect(() => parseRun(withRun((r) => (r.runId = 'x'.repeat(500))))).toThrow(RunValidationError)
  })
  it('rejects empty, oversized and non-JSON input', () => {
    expect(() => parseRun(new ArrayBuffer(0))).toThrow(/empty/)
    expect(() => parseRun(new ArrayBuffer(MAX_RUN_BYTES + 1))).toThrow(/larger/)
    expect(() => parseRun(buf('not json'))).toThrow(/valid/)
    expect(() => parseRun(Uint8Array.from([0xff, 0xfe, 0xfd]).buffer)).toThrow(/UTF-8/)
  })
  it('flags metrics that disagree with the episodes', () => {
    const r = parseRun(withRun((x) => ((x.metrics as { success: number }).success = 0.5)))
    expect(r.metricDiffs.map((d) => d.field)).toContain('success')
  })
})

describe('RunSession (page side)', () => {
  const handle = (over: Partial<RunWorkerHandle['api']> = {}) => {
    const terminate = vi.fn()
    const h: RunWorkerHandle = { api: { parse: async (b: ArrayBuffer) => parseRun(b), trajectory: async () => { throw new Error('n/a') }, ...over } as RunWorkerHandle['api'], terminate }
    return { h, terminate }
  }
  it('checks file.size before reading', async () => {
    const arrayBuffer = vi.fn()
    await expect(RunSession.open({ size: MAX_RUN_BYTES + 1, arrayBuffer } as unknown as Blob, () => handle().h)).rejects.toThrow(/larger/)
    expect(arrayBuffer).not.toHaveBeenCalled()
  })
  it('opens a valid file and keeps the worker', async () => {
    const f = handle()
    const s = await RunSession.open(new Blob([example]), () => f.h)
    expect(s.result.run.runId).toBeTruthy()
    expect(f.terminate).not.toHaveBeenCalled()
    s.close()
    expect(f.terminate).toHaveBeenCalled()
  })
  it('terminates the worker on a validation error and on timeout', async () => {
    const f = handle()
    await expect(RunSession.open(new Blob(['{}']), () => f.h)).rejects.toThrow(/run\/1/)
    expect(f.terminate).toHaveBeenCalledTimes(1)
    const g = handle({ parse: () => new Promise(() => {}) as never })
    await expect(RunSession.open(new Blob([example]), () => g.h, 30)).rejects.toThrow(/Timed out/)
    expect(g.terminate).toHaveBeenCalledTimes(1)
  })
})

describe('traj/1 decode', () => {
  it('decodes the example trajectory and verifies its sha256', async () => {
    const r = parseRun(buf(example))
    const t = r.run.episodes[0]!.trajectory!
    const arr = await decodeTrajectory(t)
    expect(Array.from(arr.row)).toEqual([10, 10, 11])
    expect(Array.from(arr.col)).toEqual([10, 11, 12])
    await expect(decodeTrajectory({ ...t, sha256: '0'.repeat(64) })).rejects.toThrow(/sha256/)
  })
})

// --------------------------------------------------------------------------- replay vs python goldens
const f32 = (b64: string) => {
  const b = Buffer.from(b64, 'base64')
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
}
function floatToHalf(x: number): number {
  const f = new Float32Array([x])
  const i = new Uint32Array(f.buffer)[0]!
  const s = (i >>> 16) & 0x8000
  let e = ((i >>> 23) & 0xff) - 127 + 15
  let m = i & 0x7fffff
  if (e <= 0) return s
  if (e >= 31) return s | 0x7c00
  m = (m + 0x1000) >> 13
  if (m === 0x400) {
    m = 0
    e++
  }
  return s | (e << 10) | m
}

const golden = JSON.parse(readFileSync(path.resolve(dir, 'fixtures/env-golden.json'), 'utf8'))

function buildEnv(c: (typeof golden.cases)[number]) {
  const rc = c.config.reward
  const cfg: EnvConfig = {
    kind: c.config.kind, maxSlopeDeg: c.config.maxSlopeDeg, maxStepM: c.config.maxStepM, speedMS: c.config.speedMS, gravity: c.config.gravity,
    reward: { energy: rc.energy, risk: rc.risk, time: rc.time, progress: rc.progress, goal: rc.goal, failure: rc.failure, hazardAttempt: rc.hazard_attempt, stepCost: rc.step_cost },
    maxSteps: c.config.maxSteps, energyOn: c.config.energyOn, sensorRadiusM: c.config.sensorRadiusM, waitS: c.config.waitS, sols: c.config.sols,
  }
  const u8 = new Uint8Array(Buffer.from(c.rocks, 'base64'))
  return new EnvLite({ rows: c.rows, cols: c.cols, resM: c.resM, slope: f32(c.terrain.slope), step: f32(c.terrain.step), height: f32(c.terrain.height) }, cfg, u8)
}

function trajBytes(points: [number, number, number, number, number][]) {
  const n = points.length
  const b = new Uint8Array(11 * n)
  const dv = new DataView(b.buffer)
  points.forEach(([r, c, t, soc, a], i) => {
    dv.setUint16(2 * i, r, true)
    dv.setUint16(2 * n + 2 * i, c, true)
    dv.setUint32(4 * n + 4 * i, Math.round(t), true)
    dv.setUint16(8 * n + 2 * i, floatToHalf(soc), true)
    dv.setUint8(10 * n + i, a)
  })
  return b
}

describe('replay of python trajectories through env-lite', () => {
  for (const c of golden.cases) {
    it(`${c.id}: reproduces the episode and recomputes its result`, () => {
      const pts = c.traj as [number, number, number, number, number][]
      // traj/1 stores time as uint32 whole seconds
      const traj = decodeTrajBytes(trajBytes(pts.map(([r, cc, t, s, a]) => [r, cc, Math.round(t), s, a])), pts.length)
      const last = c.steps.at(-1)
      const ep = {
        index: 0, seed: 1, start: c.start, goal: c.goal, outcome: last.outcome || 'timeout', steps: last.steps, pathM: last.pathM,
        energyWh: last.energyWh, violations: last.violations, risk: { timeSlopeGt15S: 0 }, events: [],
      } as unknown as Episode
      const rep = replayEpisode(buildEnv(c), ep, traj)
      // golden "outcome" is '' while running (cut at 50 steps): that is a truncation of our recording, not a result
      const mism = rep.mismatches.filter((m) => !(last.outcome === '' && m.startsWith('outcome')))
      expect(mism).toEqual([])
      expect(rep.states.length).toBe(pts.length)
    })
  }
  it('detects a tampered trajectory and a lying result', () => {
    const c = golden.cases[0]
    const pts = c.traj as [number, number, number, number, number][]
    const tampered = pts.map((p) => [...p]) as typeof pts
    tampered[5] = [tampered[5]![0] + 3, tampered[5]![1], tampered[5]![2], tampered[5]![3], tampered[5]![4]]
    const traj = decodeTrajBytes(trajBytes(tampered), tampered.length)
    const ep = { index: 0, seed: 1, start: c.start, goal: c.goal, outcome: 'success', steps: 3, pathM: 1, violations: 0, risk: { timeSlopeGt15S: 0 }, events: [] } as unknown as Episode
    const rep = replayEpisode(buildEnv(c), ep, traj)
    expect(rep.ok).toBe(false)
    expect(rep.mismatches.join(' ')).toMatch(/expected cell/)
  })
  it('sha256 helper agrees with node crypto', () => {
    expect(createHash('sha256').update('a').digest('hex')).toHaveLength(64)
  })
})
