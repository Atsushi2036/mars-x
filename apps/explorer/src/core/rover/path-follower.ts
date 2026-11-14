/**
 * Waypoint follower for the rover. Pure and deterministic (no three.js, no React) so it can be unit
 * tested and reused by planners. Coordinates are world metres (x east, z south). Heading `yaw` is the
 * direction of travel measured from +x towards +z (atan2(dz, dx)).
 */
export interface Waypoint {
  x: number
  z: number
}

export interface FollowerOptions {
  /** cruise speed in m/s */
  speed: number
  /** maximum turn rate in rad/s */
  maxTurnRate?: number
  /** restart from the first waypoint when the end is reached */
  loop?: boolean
}

export interface FollowerState {
  x: number
  z: number
  yaw: number
  /** current ground speed (m/s), reduced while turning */
  speed: number
  /** distance travelled along the path (m) */
  travelled: number
  /** index of the waypoint currently targeted */
  target: number
  done: boolean
}

export class PathFollower {
  private wp: Waypoint[]
  private opts: Required<FollowerOptions>
  state: FollowerState

  constructor(waypoints: readonly Waypoint[], opts: FollowerOptions) {
    if (waypoints.length < 2) throw new Error('A path needs at least 2 waypoints')
    if (!(opts.speed > 0)) throw new Error('speed must be > 0')
    this.wp = waypoints.map((w) => ({ x: w.x, z: w.z }))
    this.opts = { maxTurnRate: opts.maxTurnRate ?? (60 * Math.PI) / 180, loop: opts.loop ?? false, speed: opts.speed }
    const first = this.wp[0]!
    const second = this.wp[1]!
    this.state = {
      x: first.x,
      z: first.z,
      yaw: Math.atan2(second.z - first.z, second.x - first.x),
      speed: 0,
      travelled: 0,
      target: 1,
      done: false,
    }
  }

  get length(): number {
    let d = 0
    for (let i = 1; i < this.wp.length; i++) d += Math.hypot(this.wp[i]!.x - this.wp[i - 1]!.x, this.wp[i]!.z - this.wp[i - 1]!.z)
    return d
  }

  /** Advances the simulation by dt seconds (dt is clamped to avoid tunnelling after a tab stall). */
  step(dtRaw: number): FollowerState {
    const s = this.state
    if (s.done) return s
    let dt = Math.min(Math.max(dtRaw, 0), 0.1)
    while (dt > 1e-6 && !s.done) {
      const t = this.wp[s.target]!
      const dx = t.x - s.x
      const dz = t.z - s.z
      const dist = Math.hypot(dx, dz)
      // turn towards the target heading, limited by the maximum turn rate
      if (dist > 1e-6) {
        const want = Math.atan2(dz, dx)
        const err = wrapAngle(want - s.yaw)
        const maxTurn = this.opts.maxTurnRate * dt
        s.yaw = wrapAngle(s.yaw + Math.max(-maxTurn, Math.min(maxTurn, err)))
        // slow down while the heading error is large (turning on the spot)
        const align = Math.max(0, Math.cos(Math.min(Math.abs(err), Math.PI / 2)))
        s.speed = this.opts.speed * (align * align)
      }
      const travel = s.speed * dt
      if (travel >= dist) {
        // reach the waypoint, spend the remaining time on the next one
        s.x = t.x
        s.z = t.z
        s.travelled += dist
        const used = s.speed > 1e-6 ? dist / s.speed : dt
        dt -= Math.min(dt, used)
        if (s.target >= this.wp.length - 1) {
          if (this.opts.loop) {
            s.target = 1
          } else {
            s.done = true
            s.speed = 0
          }
        } else s.target++
      } else {
        s.x += Math.cos(s.yaw) * travel
        s.z += Math.sin(s.yaw) * travel
        s.travelled += travel
        dt = 0
      }
      if (s.speed <= 1e-6 && dist > 1e-6) {
        // fully misaligned: keep turning with a small creep so the loop terminates
        dt = Math.max(0, dt - 1e-3)
      }
    }
    return s
  }
}

export function wrapAngle(a: number): number {
  let r = a % (2 * Math.PI)
  if (r > Math.PI) r -= 2 * Math.PI
  if (r < -Math.PI) r += 2 * Math.PI
  return r
}
