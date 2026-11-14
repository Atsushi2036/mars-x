import { describe, expect, it } from 'vitest'
import layout from '../../../../packages/schemas/obs-v1.layout.json'
import policyExample from '../../../../packages/schemas/examples/policy.example.json'
import runExample from '../../../../packages/schemas/examples/run.example.json'
import { ACTIONS, OBS_BLOCKS, OBS_DIM, PATCH_K, decodeTrajectory, halfToFloat, policyCardSchema, runSchema } from './contracts'

describe('contracts mirror the Python models', () => {
  it('obs/1 layout matches packages/schemas/obs-v1.layout.json', () => {
    expect(layout.obsDim).toBe(OBS_DIM)
    expect(layout.patchK).toBe(PATCH_K)
    expect(layout.blocks.map((b) => [b.name, b.start, b.size])).toEqual(OBS_BLOCKS.map((b) => [b.name, b.start, b.size]))
    expect(layout.actions.map((a) => [a.name, a.dRow, a.dCol])).toEqual(ACTIONS.map((a) => [...a]))
  })

  it('accepts the Python run.json example and rejects unknown keys / non-finite numbers', () => {
    expect(runSchema.safeParse(runExample).success).toBe(true)
    expect(runSchema.safeParse({ ...runExample, surprise: 1 }).success).toBe(false)
    const bad = structuredClone(runExample)
    bad.episodes[0]!.pathM = Number.POSITIVE_INFINITY
    expect(runSchema.safeParse(bad).success).toBe(false)
  })

  it('accepts the Python policy card example', () => {
    expect(policyCardSchema.safeParse(policyExample).success).toBe(true)
  })

  it('decodes traj/1 written by Python and verifies its sha256', async () => {
    const run = runSchema.parse(runExample)
    const t = await decodeTrajectory(run.episodes[0]!.trajectory!)
    expect(Array.from(t.row)).toEqual([10, 10, 11])
    expect(Array.from(t.col)).toEqual([10, 11, 12])
    expect(Array.from(t.tS)).toEqual([0, 48, 115])
    expect(Array.from(t.action)).toEqual([2, 6, 8])
    expect(halfToFloat(t.socHalf[0]!)).toBe(1)
    await expect(decodeTrajectory({ ...run.episodes[0]!.trajectory!, sha256: '0'.repeat(64) })).rejects.toThrow('sha256')
  })
})
