/**
 * MARS-X intelligence contracts (web side). Mirrors the pydantic models in python/src/marsx/contracts
 * and the JSON Schemas in packages/schemas (run.schema.json, policy-card.schema.json, obs-v1.layout.json).
 * Keys are camelCase; unknown keys are rejected (ADR-0007: strict validation of uploaded run.json, in a worker).
 */
import { z } from 'zod'

// ------------------------------------------------------------------ obs/1 + act/1
export const OBS_SPEC = 'obs/1'
export const ACT_SPEC = 'act/1'
export const POLICY_CONTRACT = 'policy/1'
export const PATCH_K = 11
export const PATCH_CHANNELS = ['cost', 'knownHazard', 'relElevation', 'revealedRocks'] as const
export const OBS_BLOCKS = [
  { name: 'terrain', start: 0, size: 484 },
  { name: 'goal', start: 484, size: 4 },
  { name: 'agent', start: 488, size: 4 },
  { name: 'environment', start: 492, size: 8 },
  { name: 'comm', start: 500, size: 3 },
  { name: 'time', start: 503, size: 2 },
] as const
export const OBS_DIM = 505
/** act/1: index -> [dRow, dCol]; row grows southwards. Index 8 = WAIT. */
export const ACTIONS: ReadonlyArray<readonly [name: string, dRow: number, dCol: number]> = [
  ['N', -1, 0],
  ['S', 1, 0],
  ['E', 0, 1],
  ['W', 0, -1],
  ['NE', -1, 1],
  ['NW', -1, -1],
  ['SE', 1, 1],
  ['SW', 1, -1],
  ['WAIT', 0, 0],
]
export const N_ACTIONS = 9

// ------------------------------------------------------------------ primitives
const num = z.number() // zod 4 rejects Infinity/NaN
const sha256 = z.string().regex(/^[0-9a-f]{64}$/)
const short = z.string().max(96)
const cell = z.tuple([z.number().int(), z.number().int()])
const level = z.enum(['L1', 'L2', 'L3'])
/** Seeds are exact JSON integers in [0, 2^53 - 1] (no rounding in JavaScript). */
const seed = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)

export const MAX_RUN_BYTES = 10 * 1024 * 1024
export const MAX_EPISODES = 5000
export const MAX_TRAJ_STEPS = 20000

export const trajectorySchema = z
  .object({
    encoding: z.literal('traj/1').default('traj/1'),
    steps: z.number().int().min(0).max(MAX_TRAJ_STEPS),
    data: z.string().max(4 * Math.ceil((MAX_TRAJ_STEPS * 11) / 3)),
    sha256,
  })
  .strict()

const eventSchema = z
  .object({
    t: num.min(0),
    type: z.enum(['rockRevealed', 'uplink', 'speAlert', 'shelterReached', 'stuck', 'batteryLow', 'replan']),
    cell: cell.nullish(),
  })
  .strict()

export const episodeSchema = z
  .object({
    index: z.number().int().min(0),
    seed,
    scenarioId: short.nullish(),
    start: cell,
    goal: cell,
    outcome: z.enum(['success', 'collision', 'hazard', 'battery', 'stuck', 'spe_violation', 'timeout']),
    steps: z.number().int().min(0).max(MAX_TRAJ_STEPS),
    pathM: num.min(0),
    energyWh: num.nullish(),
    oracle: z.object({ pathM: num.min(0), cost: num.min(0), energyWh: num.nullish() }).strict().nullish(),
    risk: z.object({ timeSlopeGt15S: num.min(0).default(0), minHazardDistM: num.nullish() }).strict().default({ timeSlopeGt15S: 0 }),
    violations: z.number().int().min(0).default(0),
    events: z.array(eventSchema).max(1000).default([]),
    trajectory: trajectorySchema.nullish(),
  })
  .strict()

export const runSchema = z
  .object({
    schemaVersion: z.literal('run/1'),
    runId: short,
    createdUtc: short,
    producer: z.object({ marsxVersion: short, gitSha: short.nullish(), python: short, platform: short }).strict(),
    suite: z
      .object({ id: short, version: short, level, split: z.enum(['train', 'test']), rootSeed: seed })
      .strict(),
    dataset: z.object({ id: short, sha256, layers: z.record(z.string(), sha256).default({}) }).strict(),
    scenario: z.object({ id: short, sha256 }).strict(),
    policy: z
      .object({
        name: short,
        kind: z.enum(['onnx', 'python', 'baseline']),
        sha256: sha256.nullish(),
        contract: z.literal('policy/1').default('policy/1'),
        obsSpec: z.literal('obs/1').default('obs/1'),
      })
      .strict(),
    conditions: z
      .object({ medaSols: z.array(z.number().int()).max(8).default([]), tau: num.nullish(), gravity: num, owltMin: num.nullish() })
      .strict(),
    episodes: z.array(episodeSchema).max(MAX_EPISODES),
    metrics: z
      .object({
        n: z.number().int().min(0),
        success: num.min(0).max(1),
        successCi95: z.tuple([num, num]),
        spl: num.min(0).max(1).nullish(),
        energyRatio: num.nullish(),
        violations: z.number().int().min(0).default(0),
        meanPathM: num.nullish(),
      })
      .strict(),
    scorecard: z.object({ thresholdsVersion: short, passed: z.record(z.string(), z.boolean()).default({}) }).strict().nullish(),
  })
  .strict()
export type Run = z.infer<typeof runSchema>
export type Episode = z.infer<typeof episodeSchema>

export const policyCardSchema = z
  .object({
    schemaVersion: z.literal('policyCard/1').default('policyCard/1'),
    contract: z.literal('policy/1').default('policy/1'),
    obsSpec: z.literal('obs/1').default('obs/1'),
    actSpec: z.literal('act/1').default('act/1'),
    obsDim: z.literal(OBS_DIM).default(OBS_DIM),
    nActions: z.literal(N_ACTIONS).default(N_ACTIONS),
    inputName: z.literal('obs').default('obs'),
    outputName: z.literal('logits').default('logits'),
    name: short,
    version: z.string().max(32),
    onnxSha256: sha256,
    onnxBytes: z.number().int().positive().max(20 * 1024 * 1024),
    opset: z.number().int().min(17).max(21),
    ops: z.array(z.string().max(64)).max(64),
    training: z
      .object({
        algorithm: z.string().max(64),
        library: z.string().max(64),
        timesteps: z.number().int().min(0),
        wallClockS: num.min(0),
        seed,
        suiteId: z.string().max(64).nullish(),
        split: z.enum(['train', 'test']).default('train'),
      })
      .strict()
      .nullish(),
    metrics: z.record(z.string(), num).default({}),
    intendedUse: z.string().max(1000),
    limitations: z.string().max(2000),
    license: z.string().max(64),
    authors: z.array(z.string()).max(20).default([]),
  })
  .strict()
export type PolicyCard = z.infer<typeof policyCardSchema>

// ------------------------------------------------------------------ traj/1 decoder
export interface TrajArrays {
  row: Uint16Array
  col: Uint16Array
  tS: Uint32Array
  /** float16 bits; use halfToFloat() to read */
  socHalf: Uint16Array
  action: Uint8Array
}

/** Decode traj/1 bytes (structure of arrays, little-endian: u16 row | u16 col | u32 t | f16 soc | u8 action). */
export function decodeTrajBytes(bytes: Uint8Array, steps: number): TrajArrays {
  if (bytes.byteLength !== 11 * steps) throw new Error('traj/1: length does not match steps')
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const row = new Uint16Array(steps)
  const col = new Uint16Array(steps)
  const tS = new Uint32Array(steps)
  const socHalf = new Uint16Array(steps)
  const action = new Uint8Array(steps)
  for (let i = 0; i < steps; i++) {
    row[i] = dv.getUint16(2 * i, true)
    col[i] = dv.getUint16(2 * steps + 2 * i, true)
    tS[i] = dv.getUint32(4 * steps + 4 * i, true)
    socHalf[i] = dv.getUint16(8 * steps + 2 * i, true)
    action[i] = dv.getUint8(10 * steps + i)
  }
  return { row, col, tS, socHalf, action }
}

export function halfToFloat(h: number): number {
  const s = h & 0x8000 ? -1 : 1
  const e = (h >> 10) & 0x1f
  const f = h & 0x3ff
  if (e === 0) return s * 2 ** -14 * (f / 1024)
  if (e === 31) return f ? Number.NaN : s * Number.POSITIVE_INFINITY
  return s * 2 ** (e - 15) * (1 + f / 1024)
}

/** base64 -> bytes, then verify sha256 (WebCrypto) before use. */
export async function decodeTrajectory(block: z.infer<typeof trajectorySchema>): Promise<TrajArrays> {
  const bin = atob(block.data)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  const hex = Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('')
  if (hex !== block.sha256) throw new Error('traj/1: sha256 mismatch')
  return decodeTrajBytes(bytes, block.steps)
}
