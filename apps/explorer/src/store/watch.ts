import { cellToWorld, type PlanGrid, type XZ } from '@/core/mission/geometry'
import { curveFor, headingAhead, type Curve } from '@/core/rover/curve'
import type { LiveTrack } from '@/intelligence/drive/drive-loop'
import { useByo } from '@/features/shared/byo-store'
import { EVENT_LABEL, fmtElapsed, stepAtTime, useReplay } from '@/features/replay/store'
import { agentLive } from './camera'
import { DRIVER_ENABLED, useDriver } from './driver'
import { useMission } from './mission'
import { eventKind, fmtMission, usePlayback, type PlaybackEvent } from './playback'
import { roverLive, useRover } from './rover'

/** Replay speed at 1x, trajectory steps per second (same pace as the replay in the AI Lab panel). */
export const RUN_RATE = 24
/** how fast the agent MOVES on screen at 1x playback (m/s): a believable pace at any route length, with no ceiling on the duration */
export const VISUAL_ROVER_MS = 3
export const VISUAL_ASTRO_MS = 2
/** a short route still takes at least this long at 1x */
export const MIN_ROUTE_SECONDS = 15

/** On-screen speed (m/s) at 1x: the vehicle's pace, slowed only so that a short route lasts at least MIN_ROUTE_SECONDS. */
export function visualSpeed(lengthM: number, astro: boolean): number {
  return Math.min(astro ? VISUAL_ASTRO_MS : VISUAL_ROVER_MS, lengthM / MIN_ROUTE_SECONDS)
}
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
  /** the smoothed arc-length curve the agent drives AND the 3D line draws (core/rover/curve) */
  curve: Curve
  /** on-screen speed at 1x, m/s */
  speed: number
  /** arc length covered so far, metres (advanced every frame by the driver) */
  s: number
  /** damped heading, radians */
  yaw: number
  length: number
  /** id of the rover route this Watch started (another route taking over ends the Watch); -1 = none, any new rover route ends the Watch */
  routeId: number
}
export interface RunCtx {
  kind: 'run'
  x: Float32Array
  z: Float32Array
  tS: Uint32Array
  last: number
  step: number
  yaw: number
  /** AI drive: the buffers fill while the policy runs (see store/drive-watch.ts) */
  live?: LiveDrive
}
export interface LiveDrive {
  track: LiveTrack
  grid: PlanGrid
  /** track points already converted to world metres */
  filled: number
  /** cumulative distance along the converted points, metres */
  cum: Float32Array
  /** on-screen speed at 1x, m/s: the SAME as the A* route Watch (visualSpeed of the A* route length) */
  speed: number
  abort: () => void
}
export const watchCtx: { current: RouteCtx | RunCtx | null } = { current: null }

export function startRouteWatch(): boolean {
  const m = useMission.getState()
  const out = m.outcomes[m.profile]
  if (!out || out.status !== 'ok' || out.path.length < 2) return false
  const path = out.path
  const astro = m.profile === 'astronaut'
  const curve = curveFor(path)
  const length = curve.length
  const speed = visualSpeed(length, astro)
  const duration = length / speed
  // mission time is the real one (distance over the real pace); timeScale is how much faster than real the playback runs
  const timeScale = speed / (astro ? m.walk.speedMs : ROVER_REAL_SPEED)
  agentLive.kind = astro ? 'astronaut' : 'rover'
  const yaw0 = headingAhead(curve, 0)
  roverLive.x = curve.pts[0]!.x
  roverLive.z = curve.pts[0]!.z
  roverLive.yaw = yaw0
  // the driver moves the agent along the curve every frame; the rover's own follower (demo loop) stays out of it
  useRover.getState().stop()
  watchCtx.current = { kind: 'route', path, curve, speed, s: 0, yaw: yaw0, length, routeId: -1 }
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

/** Starts the Watch for whatever the button offers; a route Watch honours the chosen driver (A* plan, reference AI, the user's model). */
export function startWatch(appMode: string): boolean {
  const t = currentWatchTarget(appMode)
  if (!t) return false
  if (t.kind === 'run') return startRunWatch()
  return startJourney()
}

/**
 * Starts the route Watch with the chosen driver (see setDriver in store/driver): the A* plan, the reference AI or the user's model.
 * The wizard's "Start the journey" should call this instead of startRouteWatch.
 */
export function startJourney(): boolean {
  const d = useDriver.getState().kind
  if (DRIVER_ENABLED && d !== 'astar') {
    // lazy: the live drive (policy client, env-lite) stays out of the first load
    void import('./drive-watch').then((m) => m.startAiWatch(d))
    return true
  }
  return startRouteWatch()
}

/** Parks the active agent (rover or astronaut) on the origin of the profile's route, facing the first leg, and stops any rover route. */
export function placeAgentAtOrigin(): boolean {
  const m = useMission.getState()
  const out = m.outcomes[m.profile]
  if (!out || out.status !== 'ok' || out.path.length < 2) return false
  const curve = curveFor(out.path)
  useRover.getState().stop()
  roverLive.x = curve.pts[0]!.x
  roverLive.z = curve.pts[0]!.z
  roverLive.yaw = headingAhead(curve, 0)
  agentLive.kind = m.profile === 'astronaut' ? 'astronaut' : 'rover'
  return true
}

/**
 * Keeps the agent consistent with the plan (installed once by the playback driver):
 *  - a finished plan, or a profile change, parks the agent on the new origin (Watch or not) and stops the Explore demo loop;
 *  - replanning during a route Watch restarts it on the new route (or ends it when the plan is gone);
 *  - another rover route (the demo loop) starting during a route Watch ends the Watch instead of fighting it.
 */
export function installAgentSync(): () => void {
  const offMission = useMission.subscribe((s, prev) => {
    if (s.outcomes === prev.outcomes && s.profile === prev.profile) return
    const src = usePlayback.getState().source
    if (src === 'run') return
    if (src === 'route') {
      // a live AI drive belongs to the plan it started from: a new plan or profile ends it (the user presses Watch again)
      if (usePlayback.getState().ai) {
        usePlayback.getState().exit()
        placeAgentAtOrigin()
        return
      }
      if (!startRouteWatch()) usePlayback.getState().exit()
      return
    }
    placeAgentAtOrigin()
  })
  const offRover = useRover.subscribe((s, prev) => {
    const ctx = watchCtx.current
    if (!ctx || ctx.kind !== 'route' || usePlayback.getState().source !== 'route') return
    if (s.route && s.route !== prev.route && s.route.id !== ctx.routeId) usePlayback.getState().exit()
  })
  return () => {
    offMission()
    offRover()
  }
}
