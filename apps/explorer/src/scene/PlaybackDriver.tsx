import { useFrame } from '@react-three/fiber'
import { useEffect, useRef } from 'react'
import { agentLive } from '@/store/camera'
import { lerpAngle } from '@/store/camera-math'
import { pointAlong, playbackLive, usePlayback } from '@/store/playback'
import { useMission } from '@/store/mission'
import { roverLive, useRover } from '@/store/rover'
import { installAgentSync, RUN_RATE, watchCtx, type RouteCtx, type RunCtx } from '@/store/watch'
import { useReplay } from '@/features/replay/store'

const TICK_S = 0.1

type Acc = { tick: number; nonce: number; store: number }
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
  const acc = useRef<Acc>({ tick: 0, nonce: -1, store: 0 })

  useEffect(() => installAgentSync(), [])


  useEffect(() => {
    // leaving the Watch stops what it started; a different episode or a closed run ends a run watch
    const unsub = usePlayback.subscribe((s, prev) => {
      if (prev.source && !s.source) {
        if (prev.source === 'route') useRover.getState().stop()
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
        w.__marsx.agent = { roverLive, agentLive, rover: useRover, playback: usePlayback }
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
    else driveRun(ctx, pb, a, dt)
  }, -10)

  return null
}

function driveRoute(ctx: RouteCtx, pb: PB, a: Acc, dt: number) {
  agentLive.x = roverLive.x
  agentLive.z = roverLive.z
  agentLive.yaw = roverLive.yaw
  agentLive.ready = true
  if (a.nonce !== pb.seekNonce) {
    a.nonce = pb.seekNonce
    const want = pb.t * ctx.speed
    const have = ctx.base + playbackLive.travelled
    if (Math.abs(want - have) > 0.75) {
      const p = pointAlong(ctx.path, want)
      roverLive.x = p.x
      roverLive.z = p.z
      const nx = p.rest[0]!
      if (Math.hypot(nx.x - p.x, nx.z - p.z) > 0.01) roverLive.yaw = Math.atan2(nx.z - p.z, nx.x - p.x)
      ctx.base = want
      ctx.settle = 3
      playbackLive.travelled = 0
      useRover.getState().followPath(p.rest, ctx.speed)
      ctx.routeId = useRover.getState().route?.id ?? -1
    }
  }
  if (ctx.settle > 0) {
    ctx.settle--
    return
  }
  a.tick += dt
  if (useRover.getState().status === 'arrived' && pb.playing) {
    pb.finish()
    return
  }
  if (a.tick >= TICK_S) {
    a.tick = 0
    pb.tick((ctx.base + playbackLive.travelled) / ctx.speed)
  }
}

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
