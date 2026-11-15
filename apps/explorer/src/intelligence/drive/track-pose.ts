/**
 * Pose along a growing AI track by DISTANCE (metres), so the replay of a live drive moves at the same visual pace as the A* route
 * (rover 3 m/s, astronaut 2 m/s at 1x) however fast the policy produced the steps.
 */

/** Extends the cumulative distance array for points `from`..`to-1` (world metres). */
export function extendCum(xs: ArrayLike<number>, zs: ArrayLike<number>, cum: Float32Array, from: number, to: number): void {
  for (let i = from; i < to; i++) cum[i] = i === 0 ? 0 : cum[i - 1]! + Math.hypot(xs[i]! - xs[i - 1]!, zs[i]! - zs[i - 1]!)
}

/** Position and the index of the segment at distance `s` (clamped to the track). `last` is the index of the last point. */
export function poseAt(xs: ArrayLike<number>, zs: ArrayLike<number>, cum: ArrayLike<number>, last: number, s: number, out: { x: number; z: number; i: number } = { x: 0, z: 0, i: 0 }) {
  if (last <= 0) {
    out.x = xs[0] ?? 0
    out.z = zs[0] ?? 0
    out.i = 0
    return out
  }
  const d = Math.min(Math.max(s, 0), cum[last]!)
  let lo = 0
  let hi = last
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid]! <= d) lo = mid
    else hi = mid
  }
  const seg = cum[hi]! - cum[lo]!
  const f = seg > 0 ? (d - cum[lo]!) / seg : 0
  out.x = xs[lo]! + (xs[hi]! - xs[lo]!) * f
  out.z = zs[lo]! + (zs[hi]! - zs[lo]!) * f
  out.i = lo
  return out
}
