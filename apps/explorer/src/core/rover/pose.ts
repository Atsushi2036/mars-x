import type { Heightfield } from '@/core/terrain/heightfield'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface RoverPose {
  position: Vec3
  /** orthonormal basis: right (+x of the rover model), up, forward (-z of the model faces forward) */
  right: Vec3
  up: Vec3
  forward: Vec3
  /** degrees */
  pitchDeg: number
  rollDeg: number
}

const norm = (v: Vec3): Vec3 => {
  const l = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / l, y: v.y / l, z: v.z / l }
}
const cross = (a: Vec3, b: Vec3): Vec3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
})
const dot = (a: Vec3, b: Vec3) => a.x * b.x + a.y * b.y + a.z * b.z

/**
 * Pose of a rover standing at (x,z) heading `yaw` (atan2(dz,dx) in world axes). Yaw comes from the route,
 * pitch and roll come from the terrain normal under the wheelbase, so the body follows the ground.
 */
export function roverPose(hf: Heightfield, x: number, z: number, yaw: number, wheelbase = 2.4): RoverPose {
  const fx = Math.cos(yaw)
  const fz = Math.sin(yaw)
  // normal averaged over the footprint (4 corners + centre) -> stable on rough ground
  const half = wheelbase / 2
  const pts: Array<[number, number]> = [
    [0, 0],
    [fx * half, fz * half],
    [-fx * half, -fz * half],
    [-fz * half, fx * half],
    [fz * half, -fx * half],
  ]
  let ax = 0
  let ay = 0
  let az = 0
  let h = 0
  for (const [dx, dz] of pts) {
    const n = hf.normalAt(x + dx, z + dz, Math.max(hf.res, 0.75))
    ax += n.x
    ay += n.y
    az += n.z
    h += hf.sampleHeight(x + dx, z + dz)
  }
  const up = norm({ x: ax, y: ay, z: az })
  const f0: Vec3 = { x: fx, y: 0, z: fz }
  // forward projected onto the ground plane
  const d = dot(f0, up)
  const forward = norm({ x: f0.x - up.x * d, y: f0.y - up.y * d, z: f0.z - up.z * d })
  const right = norm(cross(forward, up)) // forward x up = right-handed "right"
  const pitchDeg = (Math.asin(Math.max(-1, Math.min(1, forward.y))) * 180) / Math.PI
  const rollDeg = (Math.asin(Math.max(-1, Math.min(1, -right.y))) * 180) / Math.PI
  return { position: { x, y: h / pts.length, z }, right, up, forward, pitchDeg, rollDeg }
}
