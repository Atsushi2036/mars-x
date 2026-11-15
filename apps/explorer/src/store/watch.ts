import { cellToWorld, type XZ } from '@/core/mission/geometry'
import { useByo } from '@/features/shared/byo-store'
import { EVENT_LABEL, fmtElapsed, stepAtTime, useReplay } from '@/features/replay/store'
import { agentLive } from './camera'
import { useMission } from './mission'
import { eventKind, fmtMission, pathLength, playbackLive, usePlayback, type PlaybackEvent } from './playback'
import { roverLive, useRover } from './rover'

/** Replay speed at 1x, trajectory steps per second (same pace as the replay in the AI Lab panel). */
export const RUN_RATE = 24
/** how fast the rover MOVES on screen at 1x playback (m/s) */
const ROVER_SPEED = 1.5
/** how fast the real rover drives (m/s, Perseverance autonav average): mission time = distance / this */
export const ROVER_REAL_SPEED = 0.042

/** What the Watch button would play right now: the planned route of the selected profile, or the selected replay episode. */
export type WatchTarget = { kind: 'route'; label: 'Watch route' } | { kind: 'run'; label: 'Watch run' }

export function currentWatchTarget(appMode: string): WatchTarget | null {
  const m = useMission.getState()
  const out = m.outcomes[m.profile]
  const route = !!out && out.status === 'ok' && out.path.length >= 2
  const r = useReplay.getState()
  const run = r.status === 'ready' && !!r.traj && r.traj.row.length >= 2 && !!m.layers
  if (run && (appMode === 'lab' || !route)) return { kind: 'run', label: 'Watch run' }
  if (route) return { kind: 'route', label: 'Watch route' }
  return null
}

/** Live context of what is being watched (module-level: the driver reads it every frame, no re-renders). */
export interface RouteCtx {
  kind: 'route'
  path: XZ[]
  speed: number
  /** metres already covered before the current follower was created (after a seek) */
  base: number
  length: number
  /** frames to ignore the rover's travelled counter after a seek (the follower is rebuilt on the next React commit) */
  settle: number
}
export interface RunCtx {
  kind: 'run'
  x: Float32Array
  z: Float32Array
  tS: Uint32Array
  last: number
  step: number
  yaw: number
}
export const watchCtx: { current: RouteCtx | RunCtx | null } = { current: null }

export function startRouteWatch(): boolean {
  const m = useMission.getState()
  const out = m.outcomes[m.profile]
  if (!out || out.status !== 'ok' || out.path.length < 2) return false
  const path = out.path.map((p) => ({ x: p.x, z: p.z }))
  const astro = m.profile === 'astronaut'
  const speed = astro ? m.walk.speedMs : ROVER_SPEED
  const length = pathLength(path)
  const duration = length / speed
  // an astronaut walks at real pace; the rover is shown sped up
  const timeScale = astro ? 1 : ROVER_SPEED / ROVER_REAL_SPEED
  agentLive.kind = astro ? 'astronaut' : 'rover'
  roverLive.x = path[0]!.x
  roverLive.z = path[0]!.z
  roverLive.yaw = Math.atan2(path[1]!.z - path[0]!.z, path[1]!.x - path[0]!.x)
  watchCtx.current = { kind: 'route', path, speed, base: 0, length, settle: 3 }
  playbackLive.travelled = 0
  useRover.getState().followPath(path.slice(1), speed)
  usePlayback.getState().begin({
    source: 'route',
    duration,
    timeScale,
    label: (t) => fmtMission(t * timeScale),
    events: [{ t: duration, kind: 'end', label: astro ? 'Reach the stop' : 'Arrive' }],
  })
  return true
}

export function startRunWatch(): boolean {
  const r = useReplay.getState()
  const layers = useMission.getState().layers
  const traj = r.traj
  if (!traj || !layers || r.status !== 'ready' || traj.row.length < 2) return false
  const g = layers.grid
  const n = traj.row.length
  const x = new Float32Array(n)
  const z = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const w = cellToWorld(g, traj.row[i]! * g.n + traj.col[i]!)
    x[i] = w.x
    z[i] = w.z
  }
  const ep = useByo.getState().run.result?.run.episodes.find((e) => e.index === r.episodeIndex)
  const events: PlaybackEvent[] = []
  for (const e of ep?.events ?? []) {
    const kind = eventKind(e.type)
    if (kind) events.push({ t: stepAtTime(traj.tS, e.t), kind, label: EVENT_LABEL[e.type] ?? e.type })
  }
  const ok = ep ? ep.outcome === 'success' && ep.violations === 0 : true
  events.push({ t: n - 1, kind: ok ? 'end' : 'stuck', label: ok ? 'Reached the goal' : 'Run ended' })
  watchCtx.current = { kind: 'run', x, z, tS: traj.tS, last: n - 1, step: 0, yaw: Math.atan2(z[1]! - z[0]!, x[1]! - x[0]!) }
  agentLive.kind = 'run'
  agentLive.x = x[0]!
  agentLive.z = z[0]!
  agentLive.yaw = watchCtx.current.yaw
  agentLive.ready = true
  r.setPlaying(false)
  r.setStep(0)
  usePlayback.getState().begin({
    source: 'run',
    duration: n - 1,
    label: (t) => fmtElapsed(traj.tS[Math.min(n - 1, Math.max(0, Math.floor(t)))]!),
    events,
  })
  return true
}

/** Starts the Watch for whatever the button offers. */
export function startWatch(appMode: string): boolean {
  const t = currentWatchTarget(appMode)
  if (!t) return false
  return t.kind === 'route' ? startRouteWatch() : startRunWatch()
}
