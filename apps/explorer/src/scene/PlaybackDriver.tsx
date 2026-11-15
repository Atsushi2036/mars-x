import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { agentLive } from '@/store/camera'
import { lerpAngle } from '@/store/camera-math'
import { usePlayback } from '@/store/playback'
import { useMission } from '@/store/mission'
import { roverLive, useRover } from '@/store/rover'
import { cellToWorld } from '@/core/mission/geometry'
import { curveAt, dampAngle, headingAhead } from '@/core/rover/curve'
import { extendCum, poseAt } from '@/intelligence/drive/track-pose'
import { useDriver } from '@/store/driver'
import { liveEvents, stopAiDrive } from '@/store/drive-watch'
import { installAgentSync, RUN_RATE, watchCtx, type RouteCtx, type RunCtx } from '@/store/watch'
import { useReplay } from '@/features/replay/store'
import { captureUserModel } from '@/intelligence/drive/user-model'

const TICK_S = 0.1

type Acc = { tick: number; nonce: number; store: number; count: number }
type PB = ReturnType<typeof usePlayback.getState>

/**
 * Turns the playback store into motion, every frame and without React renders:
 *  - always keeps `agentLive` (what Follow tracks and the minimap draws) in sync: the rover, or the replayed episode;
 *  - route: reads how far the rover has driven (the rover pauses and speeds up through `playbackLive`), reports the time, ends and seeks;
 *  - run: advances the replay step at the chosen speed and mirrors it into the replay store that the AI Lab panel and ReplayLayer read.
 * Runs before the camera rig (negative priority) so Follow sees this frame's pose.
 */
export function PlaybackDriver() {
  const hooked = useRef(false)
  const acc = useRef<Acc>({ tick: 0, nonce: -1, store: 0, count: -1 })

  useEffect(() => installAgentSync(), [])

  // remember the ONNX file the user drops in Test your AI, so Watch can run it (see intelligence/drive/user-model)
  useEffect(() => captureUserModel(), [])


  useEffect(() => {
    // leaving the Watch stops what it started; a different episode or a closed run ends a run watch
    const unsub = usePlayback.subscribe((s, prev) => {
      if (prev.source && !s.source) {
        if (prev.source === 'route') useRover.getState().stop()
        if (prev.ai) {
          stopAiDrive()
          useDriver.setState({ phase: 'idle', summary: null })
        }
        watchCtx.current = null
        agentLive.kind = 'rover'
      }
    })
    const unsub2 = useReplay.subscribe((s, prev) => {
      if (s.episodeIndex !== prev.episodeIndex && usePlayback.getState().source === 'run') usePlayback.getState().exit()
    })
    return () => {
      unsub()
      unsub2()
    }
  }, [])

  useFrame((_, dtRaw) => {
    if (!hooked.current) {
      // test hook for Playwright (Probes creates window.__marsx after this component mounts): the live agent pose and the stores
      const w = window as unknown as { __marsx?: Record<string, unknown> }
      if (w.__marsx) {
        w.__marsx.agent = { roverLive, agentLive, rover: useRover, playback: usePlayback, driver: useDriver }
        hooked.current = true
      }
    }
    const dt = Math.min(dtRaw, 0.1)
    const pb = usePlayback.getState()
    const ctx = watchCtx.current
    const a = acc.current

    if (!pb.source || !ctx) {
      agentLive.x = roverLive.x
      agentLive.z = roverLive.z
      agentLive.yaw = roverLive.yaw
      agentLive.ready = roverLive.ready
      agentLive.kind = useMission.getState().profile === 'astronaut' ? 'astronaut' : 'rover'
      a.nonce = -1
      return
    }

    if (ctx.kind === 'route') driveRoute(ctx, pb, a, dt)
    else if (ctx.live) driveLive(ctx, ctx.live, pb, a, dt)
    else driveRun(ctx, pb, a, dt)
  }, -10)

  return null
}

/**
 * Route Watch: the agent rides the smoothed arc-length curve (the same object the 3D line draws), advanced EVERY frame by a continuous
 * clock (dt clamped, so a slow frame never jumps), heading = the curve tangent a few metres ahead with frame-rate independent damping.
 * The store only gets the time at 10 Hz, for the scrubber and the clock.
 */
function driveRoute(ctx: RouteCtx, pb: PB, a: Acc, dt: number) {
  if (a.nonce !== pb.seekNonce) {
    a.nonce = pb.seekNonce
    ctx.s = Math.min(ctx.length, Math.max(0, pb.t * ctx.speed))
  }
  if (usePlayback.getState().playing) {
    ctx.s = Math.min(ctx.length, ctx.s + dt * ctx.speed * pb.speed)
    if (ctx.s >= ctx.length) pb.finish()
  }
  const p = curveAt(ctx.curve, ctx.s, ROUTE_POINT)
  ctx.yaw = dampAngle(ctx.yaw, headingAhead(ctx.curve, ctx.s, LOOK_AHEAD_M), dt, YAW_RATE)
  roverLive.x = p.x
  roverLive.z = p.z
  roverLive.yaw = ctx.yaw
  agentLive.x = p.x
  agentLive.z = p.z
  agentLive.yaw = ctx.yaw
  agentLive.ready = true
  a.tick += dt
  if (a.tick >= TICK_S) {
    a.tick = 0
    pb.tick(ctx.s / ctx.speed)
  }
}

const ROUTE_POINT = { x: 0, z: 0, tx: 1, tz: 0 }
/** how far ahead of the agent the heading looks (m) and how fast it settles (1/s) */
const LOOK_AHEAD_M = 4
const YAW_RATE = 6

function driveRun(ctx: RunCtx, pb: PB, a: Acc, dt: number) {
  const rep = useReplay.getState()
  // the AI Lab panel's own play button takes over from the bar's: same intent, one clock
  if (rep.playing) {
    rep.setPlaying(false)
    pb.play()
  }
  if (a.nonce !== pb.seekNonce) {
    a.nonce = pb.seekNonce
    ctx.step = Math.min(ctx.last, Math.max(0, pb.t))
    rep.setStep(ctx.step)
  }
  if (usePlayback.getState().playing) {
    ctx.step = Math.min(ctx.last, ctx.step + dt * RUN_RATE * pb.speed)
    if (ctx.step >= ctx.last) pb.finish()
  }
  const i = Math.min(ctx.last - 1, Math.floor(ctx.step))
  const f = ctx.step - i
  const x0 = ctx.x[i]!
  const z0 = ctx.z[i]!
  agentLive.x = x0 + (ctx.x[i + 1]! - x0) * f
  agentLive.z = z0 + (ctx.z[i + 1]! - z0) * f
  // heading: where the path goes over the next few steps (single steps are one grid cell and jitter)
  const j = Math.min(ctx.last, i + 4)
  const dx = ctx.x[j]! - x0
  const dz = ctx.z[j]! - z0
  if (Math.hypot(dx, dz) > 0.5) ctx.yaw = lerpAngle(ctx.yaw, Math.atan2(dz, dx), 1 - Math.exp(-6 * dt))
  agentLive.yaw = ctx.yaw
  agentLive.ready = true
  a.tick += dt
  a.store += dt
  if (a.tick >= TICK_S) {
    a.tick = 0
    pb.tick(ctx.step)
  }
  if (a.store >= 1 / 15) {
    a.store = 0
    rep.setStep(ctx.step)
  }
}

const LIVE_POINT = { x: 0, z: 0, i: 0 }

/**
 * AI drive replay: the agent covers DISTANCE along the track at the same visual pace as the A* route (rover 3 m/s, astronaut 2 m/s
 * at 1x, times the bar's 0.5x-4x), however fast the policy produced the steps. The playback clock is in seconds like a route's.
 */
function driveLive(ctx: RunCtx, live: NonNullable<RunCtx['live']>, pb: PB, a: Acc, dt: number) {
  const t = live.track
  // convert the steps produced so far to metres
  const from = live.filled
  while (live.filled < t.count) {
    const i = live.filled
    const w = cellToWorld(live.grid, t.rows[i]! * live.grid.n + t.cols[i]!)
    ctx.x[i] = w.x
    ctx.z[i] = w.z
    live.filled++
  }
  if (live.filled > from) extendCum(ctx.x, ctx.z, live.cum, from, live.filled)
  ctx.last = live.filled - 1
  const total = live.cum[ctx.last] ?? 0
  a.store += dt
  const sig = ctx.last + (t.done ? 0.5 : 0)
  if (sig !== a.count && a.store >= TICK_S) {
    a.store = 0
    a.count = sig
    usePlayback.setState({ duration: Math.max(1, total / live.speed), events: liveEvents(t, useDriver.getState().summary, live.cum, live.speed) })
  }
  if (a.nonce !== pb.seekNonce) {
    a.nonce = pb.seekNonce
    ctx.step = Math.min(total, Math.max(0, pb.t * live.speed))
  }
  if (ctx.last < 1) {
    agentLive.x = ctx.x[0]!
    agentLive.z = ctx.z[0]!
    return
  }
  if (usePlayback.getState().playing) {
    ctx.step = Math.min(total, ctx.step + dt * live.speed * pb.speed)
    // at the head of a drive still being computed the agent waits for the next step
    if (ctx.step >= total && t.done) pb.finish()
  }
  const p = poseAt(ctx.x, ctx.z, live.cum, ctx.last, ctx.step, LIVE_POINT)
  // heading: a few metres ahead along the track, damped (cells are 2 m and single steps jitter)
  const q = poseAt(ctx.x, ctx.z, live.cum, ctx.last, ctx.step + 4, { x: 0, z: 0, i: 0 })
  if (Math.hypot(q.x - p.x, q.z - p.z) > 0.5) ctx.yaw = dampAngle(ctx.yaw, Math.atan2(q.z - p.z, q.x - p.x), dt, 6)
  agentLive.x = p.x
  agentLive.z = p.z
  agentLive.yaw = ctx.yaw
  agentLive.ready = true
  // the rover or astronaut model stands where the policy has taken it
  roverLive.x = p.x
  roverLive.z = p.z
  roverLive.yaw = ctx.yaw
  a.tick += dt
  if (a.tick >= TICK_S) {
    a.tick = 0
    pb.tick(ctx.step / live.speed)
  }
}
