/**
 * Route curve shared by the agent and the drawn line (pure, no three.js): the planner's cell polyline smoothed with Chaikin corner
 * cutting (ratio 1/4, endpoints kept) and parametrised by arc length. Corner cutting moves the path at most about a quarter of the
 * shorter adjacent segment from a corner, so with 2 m cells it stays within 1 m of the planned cells (tested).
 */
export interface XZ {
  x: number
  z: number
}

export interface Curve {
  pts: XZ[]
  /** cumulative arc length at each point, metres */
  cum: number[]
  length: number
}

/** One Chaikin round with cutting ratio `q` (0.25 = classic). Endpoints are kept so the route still starts and ends on its cells. */
export function chaikin(path: readonly XZ[], q = 0.25): XZ[] {
  if (path.length < 3) return path.map((p) => ({ x: p.x, z: p.z }))
  const out: XZ[] = [{ x: path[0]!.x, z: path[0]!.z }]
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i]!
    const b = path[i + 1]!
    // the first and last segments keep their outer end, so the curve begins and ends exactly on the route
    if (i > 0) out.push({ x: a.x + (b.x - a.x) * q, z: a.z + (b.z - a.z) * q })
    if (i < path.length - 2) out.push({ x: a.x + (b.x - a.x) * (1 - q), z: a.z + (b.z - a.z) * (1 - q) })
  }
  out.push({ x: path[path.length - 1]!.x, z: path[path.length - 1]!.z })
  return out
}

/** Drops consecutive duplicates (a zero-length segment has no tangent). */
function dedupe(path: readonly XZ[]): XZ[] {
  const out: XZ[] = []
  for (const p of path) {
    const l = out[out.length - 1]
    if (!l || Math.hypot(p.x - l.x, p.z - l.z) > 1e-6) out.push({ x: p.x, z: p.z })
  }
  return out
}

/** Smoothed polyline (the line the 3D view draws and the agent drives). */
export function smoothPath(path: readonly XZ[], rounds = 2): XZ[] {
  let p = dedupe(path)
  for (let i = 0; i < rounds; i++) p = chaikin(p)
  return p
}

const cache = new WeakMap<object, Curve>()

/** Arc-length curve of a planned path; cached per path array so the line and the agent share the very same object. */
export function curveFor(path: readonly XZ[]): Curve {
  const hit = cache.get(path)
  if (hit) return hit
  const pts = smoothPath(path)
  const cum: number[] = [0]
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.z - pts[i - 1]!.z))
  const c: Curve = { pts, cum, length: cum[cum.length - 1] ?? 0 }
  cache.set(path, c)
  return c
}

/** Point at arc length `s` (clamped to the curve) and the unit tangent there. */
export function curveAt(c: Curve, s: number, out: { x: number; z: number; tx: number; tz: number } = { x: 0, z: 0, tx: 1, tz: 0 }) {
  const n = c.pts.length
  if (n === 0) return out
  if (n === 1) {
    out.x = c.pts[0]!.x
    out.z = c.pts[0]!.z
    return out
  }
  const d = Math.min(Math.max(s, 0), c.length)
  // binary search for the segment containing d
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (c.cum[mid]! <= d) lo = mid
    else hi = mid
  }
  const a = c.pts[lo]!
  const b = c.pts[hi]!
  const seg = c.cum[hi]! - c.cum[lo]!
  const f = seg > 0 ? (d - c.cum[lo]!) / seg : 0
  out.x = a.x + (b.x - a.x) * f
  out.z = a.z + (b.z - a.z) * f
  if (seg > 0) {
    out.tx = (b.x - a.x) / seg
    out.tz = (b.z - a.z) / seg
  }
  return out
}

/** Heading (atan2(dz, dx)) of the curve looking `ahead` metres in front of `s`: what the agent faces, so it never snaps at a corner. */
export function headingAhead(c: Curve, s: number, ahead = 4): number {
  const p = curveAt(c, s)
  const q = curveAt(c, Math.min(c.length, s + ahead))
  const dx = q.x - p.x
  const dz = q.z - p.z
  return Math.hypot(dx, dz) < 1e-6 ? Math.atan2(p.tz, p.tx) : Math.atan2(dz, dx)
}

/** Largest distance from any point of `path` to the polyline `ref` (used by the tests to bound the smoothing). */
export function maxDeviation(path: readonly XZ[], ref: readonly XZ[]): number {
  let worst = 0
  for (const p of path) {
    let best = Infinity
    for (let i = 1; i < ref.length; i++) {
      const a = ref[i - 1]!
      const b = ref[i]!
      const dx = b.x - a.x
      const dz = b.z - a.z
      const l2 = dx * dx + dz * dz || 1
      const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / l2))
      best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.z - (a.z + dz * t)))
    }
    worst = Math.max(worst, best)
  }
  return worst
}

/** Exponential damping of an angle towards a target (frame-rate independent), taking the short way round. */
export function dampAngle(cur: number, target: number, dt: number, rate = 5): number {
  let d = (target - cur) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return cur + d * (1 - Math.exp(-rate * dt))
}
