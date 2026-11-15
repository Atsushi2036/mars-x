import { ACTIONS } from '@/intelligence/contracts'
import { FLAG_BUMP } from '@/intelligence/lab/qlearn'

/**
 * Pure logic of the "Watch training" view: speeds, per-frame animation state of one traced episode,
 * the cividis colour ramp for the value map, and the counters. No React, no canvas: unit-tested.
 */

export type WatchSpeed = 'slow' | 'fast' | 'turbo'

/**
 * Slow: one episode per request and the UI plays it step by step. Fast/Turbo: the worker trains in batches and
 * the UI animates only the last episode of each batch (1 of N), at a quicker step rate.
 */
export const WATCH_SPEEDS: Record<WatchSpeed, { batch: number; sampleEvery: number; stepMs: number }> = {
  slow: { batch: 1, sampleEvery: 1, stepMs: 120 },
  fast: { batch: 20, sampleEvery: 20, stepMs: 30 },
  turbo: { batch: 100, sampleEvery: 100, stepMs: 8 },
}

export function planBatch(speed: WatchSpeed) {
  const { batch, sampleEvery } = WATCH_SPEEDS[speed]
  return { batch, sampleEvery }
}

/** The fields of a traced episode that the animation needs (EpisodeSample satisfies it). */
export interface SampleLike {
  start: number
  cells: ArrayLike<number>
  reward: ArrayLike<number>
  flags: ArrayLike<number>
  outcome: 'goal' | 'timeout'
}

export type FloaterTone = 'gain' | 'loss' | 'hazard'
export interface Floater {
  /** index of the step in the sample (stable key) */
  step: number
  cell: number
  text: string
  tone: FloaterTone
  /** 0 = just appeared, 1 = gone */
  age: number
}
export type FlashTone = 'goal' | 'timeout' | 'hazard'
export interface Frame {
  /** steps already played */
  step: number
  /** where the agent is */
  cell: number
  /** cells visited so far, oldest first, at most `trail` + 1 */
  trail: number[]
  floaters: Floater[]
  flash: { tone: FlashTone; age: number } | null
  banner: string | null
  /** false until the end-of-episode hold is over */
  done: boolean
}

const minus = (s: string) => s.replace('-', '−')
const signed = (v: number) => (v >= 0 ? `+${v.toFixed(1)}` : minus(v.toFixed(1)))

export function frameAt(s: SampleLike, elapsedMs: number, stepMs: number, o: { trail?: number; floatMs?: number; endHoldMs?: number } = {}): Frame {
  const trailLen = o.trail ?? 14
  const floatMs = o.floatMs ?? 700
  const endHoldMs = o.endHoldMs ?? 900
  const n = s.cells.length
  const step = Math.max(0, Math.min(n, Math.floor(elapsedMs / stepMs)))
  const cell = step === 0 ? s.start : (s.cells[step - 1] as number)

  const trail: number[] = [s.start]
  for (let i = 0; i < step; i++) if (s.cells[i] !== trail[trail.length - 1]) trail.push(s.cells[i] as number)
  const shown = trail.slice(-(trailLen + 1))

  const floaters: Floater[] = []
  for (let i = Math.max(0, step - 3); i < step; i++) {
    const age = (elapsedMs - (i + 1) * stepMs) / floatMs
    if (age < 0 || age >= 1) continue
    const r = s.reward[i] as number
    const bump = ((s.flags[i] as number) & FLAG_BUMP) !== 0
    floaters.push({
      step: i,
      cell: s.cells[i] as number,
      text: bump ? `Hazard ${minus(String(Math.round(r)))}` : signed(r),
      tone: bump ? 'hazard' : r >= 0 ? 'gain' : 'loss',
      age,
    })
  }

  let flash: Frame['flash'] = null
  let banner: string | null = null
  let done = false
  if (step === n && n > 0) {
    const age = (elapsedMs - n * stepMs) / endHoldMs
    const last = s.reward[n - 1] as number
    const lastBump = ((s.flags[n - 1] as number) & FLAG_BUMP) !== 0
    if (s.outcome === 'goal') {
      flash = { tone: 'goal', age }
      banner = `+${Math.round(last)} Goal`
    } else if (lastBump) {
      flash = { tone: 'hazard', age }
      banner = `Hazard ${minus(String(Math.round(last)))}`
    } else {
      flash = { tone: 'timeout', age }
      banner = 'Out of time'
    }
    done = age >= 1
  } else if (n === 0) {
    done = elapsedMs >= endHoldMs
  }
  return { step, cell, trail: shown, floaters, flash, banner, done }
}

// ------------------------------------------------------------------------------------------------ colours

// matplotlib "cividis": perceptually uniform, colour-blind safe, brighter = more (never a red-green ramp)
const CIVIDIS: ReadonlyArray<readonly [number, number, number]> = [
  [0, 34, 78],
  [18, 53, 112],
  [59, 73, 108],
  [87, 93, 109],
  [112, 113, 115],
  [138, 134, 120],
  [166, 157, 117],
  [196, 181, 110],
  [228, 207, 91],
  [253, 234, 69],
]

/** t in [0, 1] (clamped) to an [r, g, b] triple. */
export function cividis(t: number): [number, number, number] {
  const x = Math.max(0, Math.min(1, t)) * (CIVIDIS.length - 1)
  const i = Math.min(CIVIDIS.length - 2, Math.floor(x))
  const f = x - i
  const a = CIVIDIS[i]!
  const b = CIVIDIS[i + 1]!
  return [Math.round(a[0] + (b[0] - a[0]) * f), Math.round(a[1] + (b[1] - a[1]) * f), Math.round(a[2] + (b[2] - a[2]) * f)]
}

/** V(s) scaled to 0..1 over the cells the agent has learned something about; the others are -1 (no data). */
export function normalizeValues(value: Float32Array, action: Uint8Array, noAction = 255): Float32Array {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < value.length; i++) {
    if (action[i] === noAction) continue
    lo = Math.min(lo, value[i]!)
    hi = Math.max(hi, value[i]!)
  }
  const out = new Float32Array(value.length)
  for (let i = 0; i < value.length; i++) {
    if (action[i] === noAction) out[i] = -1
    else out[i] = hi > lo ? (value[i]! - lo) / (hi - lo) : 0.5
  }
  return out
}

/** [dRow, dCol] of each of the 8 moves, for the policy arrows (row grows southwards). */
export const ACTION_ARROWS: ReadonlyArray<readonly [number, number]> = ACTIONS.slice(0, 8).map((a) => [a[1], a[2]] as const)

// ------------------------------------------------------------------------------------------------ counters

/** Share of the last `window` episodes that reached the goal; null before the first episode. */
export function successRate(curve: ReadonlyArray<{ reachedGoal: boolean }>, window = 100): number | null {
  if (curve.length === 0) return null
  const recent = curve.slice(-window)
  return recent.filter((p) => p.reachedGoal).length / recent.length
}

/** Share of moves that are random (epsilon) vs greedy, for the "Exploring vs Exploiting" bar. */
export function exploreShare(epsilon: number): number {
  return Math.max(0, Math.min(1, epsilon))
}
