import { describe, expect, it } from 'vitest'
import { EnvLite, type Episode, type Terrain, type TrajArrays } from '@/intelligence'
import { configFor, FAMILIES, GAP_TEXT, relevantMismatches, resimulability, summaryState, verifyRun, waitsBeforeEnd } from './verify'

const ID = 'jezero-v1/l1/rtg-geometry'
const N = 8
const terrain: Terrain = {
  rows: N,
  cols: N,
  resM: 2,
  slope: new Float32Array(N * N).fill(2),
  step: new Float32Array(N * N).fill(0.05),
  height: new Float32Array(N * N).fill(100),
}

/** Plays `actions` in env-lite and writes the traj/1 arrays the way the bench does (state before each action + terminal state). */
function record(actions: number[], start: [number, number], goal: [number, number]) {
  const env = new EnvLite(terrain, configFor(ID)!)
  env.reset(start, goal)
  const row = [start[0]]
  const col = [start[1]]
  const tS = [0]
  for (const a of actions) {
    env.step(a)
    row.push(env.state.row)
    col.push(env.state.col)
    tS.push(Math.round(env.state.tS))
  }
  const traj: TrajArrays = {
    row: Uint16Array.from(row),
    col: Uint16Array.from(col),
    tS: Uint32Array.from(tS),
    socHalf: new Uint16Array(row.length).fill(0x3c00),
    action: Uint8Array.from([...actions, 8]),
  }
  const s = env.state
  const ep: Episode = {
    index: 0,
    seed: 1,
    scenarioId: ID,
    start,
    goal,
    outcome: s.outcome === '' ? 'timeout' : s.outcome,
    steps: actions.length,
    pathM: s.pathM,
    energyWh: null,
    oracle: null,
    risk: { timeSlopeGt15S: 0 },
    violations: s.violations,
    events: [],
    trajectory: { encoding: 'traj/1', steps: actions.length + 1, data: '', sha256: 'a'.repeat(64) },
  }
  return { ep, traj }
}

describe('what can be re-simulated in the browser', () => {
  const base = record([2, 2, 2], [2, 0], [2, 3]).ep
  it('knows every family of the suite and names no scenario it does not know', () => {
    expect(Object.keys(FAMILIES)).toContain('jezero-v1/l1/rtg-geometry')
    expect(Object.keys(FAMILIES)).toContain('jezero-v1/l3/astronaut-storm')
    expect(resimulability(base, 'jezero-v1/l9/unknown')).toEqual({ ok: false, why: 'unknown scenario family' })
  })
  it('L1 episodes replay; episodes without a trajectory do not', () => {
    expect(resimulability(base, ID).ok).toBe(true)
    expect(resimulability({ ...base, trajectory: null }, ID)).toEqual({ ok: false, why: 'no trajectory recorded' })
  })
  it('hidden-rock collisions cannot be replayed (the rocks come from a NumPy seed)', () => {
    const r = resimulability({ ...base, outcome: 'collision' }, 'jezero-v1/l3/rtg-clear')
    expect(r).toEqual({ ok: false, why: GAP_TEXT['no-rocks'] })
    expect(resimulability({ ...base, outcome: 'timeout' }, 'jezero-v1/l3/rtg-clear').ok).toBe(true)
  })
  it('solar battery failures and shelter-rule episodes are named gaps, not silent skips', () => {
    expect(resimulability({ ...base, outcome: 'battery' }, 'jezero-v1/l2/solar-clear')).toEqual({ ok: false, why: GAP_TEXT['no-energy'] })
    expect(resimulability({ ...base, outcome: 'spe_violation' }, 'jezero-v1/l2/astronaut-clear')).toEqual({ ok: false, why: GAP_TEXT['no-shelter'] })
    expect(resimulability({ ...base, events: [{ t: 5, type: 'speAlert' }] }, 'jezero-v1/l2/astronaut-clear').ok).toBe(false)
  })
  it('detects waits, ignoring the closing sentinel', () => {
    expect(waitsBeforeEnd({ action: Uint8Array.from([2, 2, 8]) })).toBe(false)
    expect(waitsBeforeEnd({ action: Uint8Array.from([2, 8, 2, 8]) })).toBe(true)
  })
  it('ignores energy lines only where the scenario has the energy model off', () => {
    const m = ['energy: file says 600 Wh, dynamics give 0.000 Wh', 'step 4: battery level differs', 'outcome: file says success, dynamics give timeout']
    expect(relevantMismatches(m, false)).toEqual([m[2]])
    expect(relevantMismatches(m, true)).toEqual(m)
  })
  it('turns counts into a state', () => {
    expect(summaryState({ verified: 5, mismatched: 0 })).toBe('verified')
    expect(summaryState({ verified: 5, mismatched: 1 })).toBe('mismatch')
    expect(summaryState({ verified: 0, mismatched: 0 })).toBe('not-resimulated')
  })
})

describe('verifyRun', () => {
  it('verifies an honest episode', async () => {
    const { ep, traj } = record([2, 2, 2], [2, 0], [2, 3])
    expect(ep.outcome).toBe('success')
    const s = await verifyRun([ep], ID, terrain, async () => traj)
    expect(s).toMatchObject({ verified: 1, mismatched: 0, notResimulable: 0, state: 'verified' })
  })
  it('catches a recorded outcome that the dynamics do not give', async () => {
    const { ep, traj } = record([2, 2], [2, 0], [2, 3])
    const lie: Episode = { ...ep, outcome: 'success' }
    const s = await verifyRun([lie], ID, terrain, async () => traj)
    expect(s.state).toBe('mismatch')
    expect(s.examples[0]!.reason).toContain('outcome')
  })
  it('catches a trajectory that teleports', async () => {
    const { ep, traj } = record([2, 2, 2], [2, 0], [2, 3])
    traj.col[2] = 7
    const s = await verifyRun([ep], ID, terrain, async () => traj)
    expect(s.state).toBe('mismatch')
  })
  it('counts what it could not replay, with the reason', async () => {
    const { ep, traj } = record([2, 2, 2], [2, 0], [2, 3])
    const s = await verifyRun([ep, { ...ep, index: 1, scenarioId: 'jezero-v1/l9/x' }], ID, terrain, async () => traj)
    expect(s).toMatchObject({ verified: 1, notResimulable: 1, state: 'verified' })
    expect(s.gaps['unknown scenario family']).toBe(1)
  })
  it('a failing decode is a mismatch, not a crash', async () => {
    const { ep } = record([2, 2, 2], [2, 0], [2, 3])
    const s = await verifyRun([ep], ID, terrain, async () => Promise.reject(new Error('sha256 mismatch')))
    expect(s.state).toBe('mismatch')
    expect(s.examples[0]!.reason).toContain('sha256')
  })
})
