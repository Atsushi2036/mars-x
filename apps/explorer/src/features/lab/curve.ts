import type { EpisodePoint } from '@/intelligence'

export interface ChartPoint {
  episode: number
  /** raw return of this episode (mean of the bucket) */
  raw: number
  /** moving average */
  smooth: number
  /** share of episodes in the bucket that reached the goal, 0..1 */
  success: number
}

/**
 * Reduces an episode curve to at most `maxPoints` buckets for drawing and adds a moving average.
 * Bucket values are means, so the curve keeps its shape instead of showing every 20th episode.
 */
export function summarizeCurve(curve: readonly EpisodePoint[], maxPoints = 160, window = 5): ChartPoint[] {
  if (curve.length === 0) return []
  const size = Math.max(1, Math.ceil(curve.length / maxPoints))
  const out: ChartPoint[] = []
  for (let i = 0; i < curve.length; i += size) {
    const chunk = curve.slice(i, i + size)
    const raw = chunk.reduce((a, p) => a + p.ret, 0) / chunk.length
    const success = chunk.filter((p) => p.reachedGoal).length / chunk.length
    out.push({ episode: chunk[chunk.length - 1]!.episode, raw, smooth: raw, success })
  }
  for (let i = 0; i < out.length; i++) {
    const lo = Math.max(0, i - window + 1)
    let s = 0
    for (let k = lo; k <= i; k++) s += out[k]!.raw
    out[i]!.smooth = s / (i - lo + 1)
  }
  return out
}

/** "Nice" axis bounds and ticks for a numeric range. */
export function niceTicks(min: number, max: number, count = 4): { lo: number; hi: number; ticks: number[] } {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { lo: 0, hi: 1, ticks: [0, 1] }
  if (min === max) {
    min -= 1
    max += 1
  }
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag
  const lo = Math.floor(min / step) * step
  const hi = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Number(v.toPrecision(12)))
  return { lo, hi, ticks }
}

/** Honest verdict on the latest greedy evaluation versus the A* optimum. */
export function compareVerdict(ev: { reached: boolean; ratio: number | null } | null): string {
  if (!ev) return 'Not evaluated yet.'
  if (!ev.reached || ev.ratio === null) return 'The greedy policy does not reach the goal yet.'
  if (ev.ratio <= 1.0001) return 'Matches the A* optimum.'
  return `${((ev.ratio - 1) * 100).toFixed(1)}% costlier than the A* optimum.`
}

/**
 * Value range to draw. Early episodes of a learner are far worse than later ones and would flatten the whole
 * curve, so the lower bound is the 5th percentile of the moving average; `clipped` tells the UI to say so.
 */
export function chartRange(points: readonly ChartPoint[]): { min: number; max: number; clipped: boolean } {
  if (points.length === 0) return { min: 0, max: 1, clipped: false }
  const sm = points.map((p) => p.smooth).sort((a, b) => a - b)
  const all = points.flatMap((p) => [p.raw, p.smooth])
  const trueMin = Math.min(...all)
  const max = Math.max(...all)
  const p5 = sm[Math.floor(0.05 * (sm.length - 1))]!
  const span = Math.max(1e-9, max - p5)
  const min = p5 - span * 0.15
  const clipped = trueMin < min
  return { min: clipped ? min : trueMin, max, clipped }
}
