import { EnvLite } from '../sim/env-lite'

/**
 * Live driving loop: a policy (any function from obs/1 to an act/1 index) drives env-lite from start to goal, one step at a time.
 * Deterministic for a deterministic policy. The track is a growing buffer the 3D scene and the playback read while the loop is still
 * running, so the agent moves as the steps are produced.
 */
export type DriveOutcome = 'success' | 'collision' | 'battery' | 'spe_violation' | 'timeout' | 'error' | 'aborted'

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
  error?: string
}

export interface DriveOptions {
  env: EnvLite
  start: readonly [number, number]
  goal: readonly [number, number]
  /** obs/1 in, act/1 index out */
  infer: (obs: Float32Array) => Promise<number>
  track: LiveTrack
  signal?: AbortSignal
  /** called after every step (throttle in the caller) */
  onStep?: (n: number) => void
}

/** Hard ceiling regardless of the env config, so a hostile or looping policy cannot run forever. */
export const MAX_DRIVE_STEPS = 4000

export async function runDrive(o: DriveOptions): Promise<DriveResult> {
  const { env, track } = o
  env.reset(o.start, o.goal)
  track.push(o.start[0], o.start[1])
  let lastShield = 0
  let blocked = 0
  const finish = (outcome: DriveOutcome, error?: string): DriveResult => {
    const s = env.state
    if (outcome === 'success' || outcome === 'collision' || outcome === 'battery' || outcome === 'spe_violation' || outcome === 'timeout') track.events.push({ at: track.count - 1, kind: 'end' })
    track.done = true
    return { outcome, steps: s.steps, pathM: s.pathM, blockedAttempts: blocked, ...(error ? { error } : {}) }
  }
  const cap = Math.min(MAX_DRIVE_STEPS, env.cfg.maxSteps)
  for (let i = 0; i < cap + 1; i++) {
    if (o.signal?.aborted) return finish('aborted')
    let action: number
    try {
      action = await o.infer(env.observe())
    } catch (e) {
      return finish('error', e instanceof Error ? e.message : String(e))
    }
    const res = env.step(action)
    const s = env.state
    track.push(s.row, s.col)
    if (s.shield > lastShield) {
      blocked += s.shield - lastShield
      lastShield = s.shield
      track.events.push({ at: track.count - 1, kind: 'blocked' })
    }
    if (res.outcome === 'collision') track.events.push({ at: track.count - 1, kind: 'rock' })
    o.onStep?.(track.count)
    if (res.outcome !== '') return finish(res.outcome)
  }
  return finish('timeout')
}
