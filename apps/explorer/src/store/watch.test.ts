import { beforeEach, describe, expect, it } from 'vitest'
import { agentLive } from './camera'
import { useMission, type ProfileOutcome } from './mission'
import { usePlayback } from './playback'
import { roverLive, useRover } from './rover'
import { installAgentSync, startJourney, startRouteWatch, watchCtx } from './watch'

const ok = (path: { x: number; z: number }[]): ProfileOutcome => ({ status: 'ok', path, stats: { lengthM: 0, maxSlopeDeg: 0, meanSlopeDeg: 0, climbM: 0 }, expanded: 0, ms: 0 })
const P1 = [
  { x: 100, z: 50 },
  { x: 130, z: 50 },
  { x: 130, z: 90 },
]
const P2 = [
  { x: -80, z: 10 },
  { x: -80, z: 60 },
]

describe('agent follows the plan', () => {
  let off: () => void
  beforeEach(() => {
    off?.()
    usePlayback.getState().exit()
    useRover.getState().stop()
    roverLive.x = 0
    roverLive.z = 0
    roverLive.yaw = 0
    roverLive.ready = true
    useMission.setState({ outcomes: {}, profile: 'rover-rtg' })
    off = installAgentSync()
  })

  it('a finished plan parks the agent on the origin, facing the first leg, without Watch, and stops the demo loop', () => {
    useRover.getState().followPath([{ x: 40, z: 0 }], 2, true)
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1) } })
    expect(roverLive.x).toBe(100)
    expect(roverLive.z).toBe(50)
    expect(roverLive.yaw).toBeCloseTo(0) // first leg points east
    expect(useRover.getState().status).toBe('idle')
    expect(useRover.getState().route).toBeNull()
    expect(usePlayback.getState().source).toBeNull()
  })

  it('changing the profile moves the agent to that profile\'s origin and tags its kind', () => {
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1), astronaut: ok(P2) } })
    expect(roverLive.x).toBe(100)
    useMission.setState({ profile: 'astronaut' })
    expect(roverLive.x).toBe(-80)
    expect(roverLive.z).toBe(10)
    expect(agentLive.kind).toBe('astronaut')
  })

  it('Watch starts at t=0 on the origin and drives exactly the polyline of the active profile', () => {
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1) } })
    expect(startJourney()).toBe(true)
    const ctx = watchCtx.current
    expect(ctx?.kind).toBe('route')
    if (ctx?.kind !== 'route') throw new Error('route expected')
    expect(ctx.path).toEqual(P1)
    expect(roverLive.x).toBe(100)
    expect(useRover.getState().route?.waypoints).toEqual(P1.slice(1))
    expect(usePlayback.getState().t).toBe(0)
    expect(usePlayback.getState().source).toBe('route')
  })

  it('replanning while watching restarts the Watch on the new route', () => {
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1) } })
    startRouteWatch()
    useMission.setState({ outcomes: { 'rover-rtg': ok(P2) } })
    expect(usePlayback.getState().source).toBe('route')
    expect(roverLive.x).toBe(-80)
    expect(useRover.getState().route?.waypoints).toEqual(P2.slice(1))
  })

  it('a plan that disappears while watching ends the Watch', () => {
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1) } })
    startRouteWatch()
    useMission.setState({ outcomes: {} })
    expect(usePlayback.getState().source).toBeNull()
  })

  it('another route (the Explore demo loop) cannot hijack the rover during Watch: the Watch ends', () => {
    useMission.setState({ outcomes: { 'rover-rtg': ok(P1) } })
    startRouteWatch()
    useRover.getState().followPath([{ x: 0, z: 0 }, { x: 10, z: 10 }], 2, true)
    expect(usePlayback.getState().source).toBeNull()
  })
})

describe('fitSpeed', () => {
  it('shows a long route in about 30 s, never slower than the vehicle base pace', async () => {
    const { fitSpeed } = await import('./watch')
    expect(300 / fitSpeed(300, 1.5)).toBeCloseTo(30, 0)
    expect(20 / fitSpeed(20, 1.5)).toBeCloseTo(20 / 1.5, 5) // short route keeps the base pace
  })
})
