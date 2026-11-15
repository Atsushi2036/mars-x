/**
 * Pure camera maths shared by the rig, the nav widgets and the tests (no three.js, no React).
 * Conventions: world x east, z south, y up. `azimuth` is the compass heading the camera LOOKS towards, measured from north
 * (-z) towards east (+x) with the sign of atan2(-dx, -dz), so azimuth 0 = camera south of its target looking north (north up).
 * `pitch` is the elevation of the camera above the horizon, radians.
 */
export const DIST_MIN = 20
export const DIST_MAX = 2400
export const PITCH_MIN = (10 * Math.PI) / 180
export const PITCH_MAX = (85 * Math.PI) / 180

export const easeInOut = (t: number): number => {
  const x = Math.min(1, Math.max(0, t))
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2
}

export const clampDistance = (d: number, max = DIST_MAX): number => Math.min(max, Math.max(DIST_MIN, d))
export const clampPitch = (p: number): number => Math.min(PITCH_MAX, Math.max(PITCH_MIN, p))

/** Camera position for a target, heading, elevation and distance. */
export function orbitPosition(target: { x: number; y: number; z: number }, azimuth: number, pitch: number, dist: number) {
  const h = Math.cos(pitch) * dist
  return { x: target.x + Math.sin(azimuth) * h, y: target.y + Math.sin(pitch) * dist, z: target.z + Math.cos(azimuth) * h }
}

/** Heading of an orbit camera from its offset to the target (camera minus target). */
export const azimuthOf = (dx: number, dz: number): number => Math.atan2(dx, dz)

/** Shortest-way interpolation between two angles. */
export function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (2 * Math.PI)
  if (d > Math.PI) d -= 2 * Math.PI
  if (d < -Math.PI) d += 2 * Math.PI
  return a + d * t
}

export interface Extent {
  xMin: number
  xMax: number
  zMin: number
  zMax: number
}

/** Keeps a point inside the terrain tile (users cannot fly off the slab). */
export function clampToTile(x: number, z: number, ext: Extent, margin = 2): { x: number; z: number } {
  return {
    x: Math.max(ext.xMin + margin, Math.min(ext.xMax - margin, x)),
    z: Math.max(ext.zMin + margin, Math.min(ext.zMax - margin, z)),
  }
}

/** World-space displacement for `fwd` (+1 = away from the camera) and `str` (+1 = right) amounts at a given heading. */
export function panStep(azimuth: number, fwd: number, str: number, amount: number): { x: number; z: number } {
  const s = Math.sin(azimuth)
  const c = Math.cos(azimuth)
  return { x: (-s * fwd + c * str) * amount, z: (-c * fwd - s * str) * amount }
}
