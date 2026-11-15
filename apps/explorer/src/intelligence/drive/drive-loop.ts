import { EnvLite } from '../sim/env-lite'

/**
 * Live driving loop: a policy (any function from obs/1 to an act/1 index) drives env-lite one step at a time.
 * Two modes: free (start straight to the goal) and guided (an ordered list of sub-goals, the way a rover team gives a rover
 * waypoints: the policy drives from one to the next with its own local decisions). Deterministic for a deterministic policy.
 * The track is a growing buffer the 3D scene and the playback read while the loop is still running.
 */
export type DriveOutcome = 'success' | 'collision' | 'battery' | 'spe_violation' | 'timeout' | 'stuck' | 'error' | 'aborted'

export interface DriveEvent {
  /** index into the track (0 = the start cell) */
  at: number
  kind: 'blocked' | 'rock' | 'end'
}

export class LiveTrack {
  readonly rows: Uint16Array
  readonly cols: Uint16Array
  /** points written so far, the start cell included */
  count = 0
  readonly events: DriveEvent[] = []
  done = false
  constructor(capacity: number) {
    this.rows = new Uint16Array(capacity + 1)
    this.cols = new Uint16Array(capacity + 1)
  }
  push(r: number, c: number) {
    this.rows[this.count] = r
    this.cols[this.count] = c
    this.count++
  }
}

export interface DriveResult {
  outcome: DriveOutcome
  steps: number
  pathM: number
  /** blocked moves the policy attempted (walls, steep cells) */
  blockedAttempts: number
  /** sub-goals reached (guided mode) and how many there were */
  reached: number
  total: number
  error?: string
}

export type Cell = readonly [number, number]

export interface DriveOptions {
  env: EnvLite
  start: Cell
  /** ordered sub-goals; the last one is the real goal. A single entry = free mode. */
  goals: readonly Cell[]
  /** obs/1 in, act/1 index out */
  infer: (obs: Float32Array) => Promise<number>
  track: LiveTrack
  signal?: AbortSignal
  /** called after every step (throttle in the caller) */
  onStep?: (n: number) => void
}

/** Hard ceiling regardless of the env config, so a hostile or looping policy cannot run forever. */
export const MAX_DRIVE_STEPS = 6000
/** steps without getting closer to the current goal before the drive is declared stuck (30 steps/s: about 2 s of playback) */
export const STUCK_STEPS = 60

/** Picks guided sub-goals along a cell path: one every `spacingCells` of path, always ending on the real goal. */
export function subGoals(path: readonly Cell[], spacingCells: number): Cell[] {
  const out: Cell[] = []
  let acc = 0
  for (let i = 1; i < path.length; i++) {
    acc += Math.hypot(path[i]![0] - path[i - 1]![0], path[i]![1] - path[i - 1]![1])
    if (acc >= spacingCells && i < path.length - 1) {
      out.push(path[i]!)
      acc = 0
    }
  }
  const last = path[path.length - 1]!
  // merge a tiny last leg into the previous sub-goal
  if (out.length && Math.hypot(last[0] - out[out.length - 1]![0], last[1] - out[out.length - 1]![1]) < spacingCells * 0.4) out.pop()
  out.push(last)
  return out
}

export async function runDrive(o: DriveOptions): Promise<DriveResult> {
  const { env, track } = o
  track.push(o.start[0], o.start[1])
  let blocked = 0
  let steps = 0
  let pathM = 0
  let reached = 0
  const finish = (outcome: DriveOutcome, error?: string): DriveResult => {
    if (outcome !== 'error' && outcome !== 'aborted') track.events.push({ at: track.count - 1, kind: 'end' })
    track.done = true
    return { outcome, steps, pathM, blockedAttempts: blocked, reached, total: o.goals.length, ...(error ? { error } : {}) }
  }
  const cap = Math.min(MAX_DRIVE_STEPS, env.cfg.maxSteps)
  let cur: Cell = o.start
  for (const goal of o.goals) {
    env.reset(cur, goal)
    let lastShield = 0
    let best = Math.hypot(goal[0] - cur[0], goal[1] - cur[1])
    let sinceBest = 0
    for (;;) {
      if (o.signal?.aborted) return finish('aborted')
      if (steps >= cap) return finish('timeout')
      let action: number
      try {
        action = await o.infer(env.observe())
      } catch (e) {
        return finish('error', e instanceof Error ? e.message : String(e))
      }
      const res = env.step(action)
      steps++
      const s = env.state
      track.push(s.row, s.col)
      if (s.shield > lastShield) {
        blocked += s.shield - lastShield
        lastShield = s.shield
        track.events.push({ at: track.count - 1, kind: 'blocked' })
      }
      if (res.outcome === 'collision') track.events.push({ at: track.count - 1, kind: 'rock' })
      o.onStep?.(track.count)
      cur = [s.row, s.col]
      if (res.outcome === 'success') {
        pathM += s.pathM
        reached++
        break
      }
      if (res.outcome !== '') {
        pathM += s.pathM
        // the per-segment step budget running out is the policy dithering: report it as stuck, not as a generic timeout
        return finish(res.outcome === 'timeout' ? 'stuck' : res.outcome)
      }
      const d = Math.hypot(goal[0] - s.row, goal[1] - s.col)
      if (d < best - 0.5) {
        best = d
        sinceBest = 0
      } else if (++sinceBest >= STUCK_STEPS) {
        pathM += s.pathM
        return finish('stuck')
      }
    }
  }
  return finish('success')
}
