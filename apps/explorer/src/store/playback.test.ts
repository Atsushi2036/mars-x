import { beforeEach, describe, expect, it } from 'vitest'
import { useCamera } from './camera'
import { eventKind, fmtClock, pathLength, pointAlong, playbackLive, usePlayback } from './playback'

const reset = () => {
  usePlayback.getState().exit()
  useCamera.setState({ mode: 'orbit' })
}

describe('playback store', () => {
  beforeEach(reset)

  it('begin enters Follow, remembers the previous camera and starts playing at 1x', () => {
    useCamera.setState({ mode: 'fpv' })
    usePlayback.getState().begin({ source: 'route', duration: 120, label: (t) => fmtClock(t) })
    const s = usePlayback.getState()
    expect(s.source).toBe('route')
    expect(s.playing).toBe(true)
    expect(s.speed).toBe(1)
    expect(s.t).toBe(0)
    expect(useCamera.getState().mode).toBe('chase')
    expect(s.prevMode).toBe('fpv')
  })

  it('exit restores the previous camera and clears the source', () => {
    useCamera.setState({ mode: 'orbit' })
    usePlayback.getState().begin({ source: 'run', duration: 10, label: String })
    usePlayback.getState().exit()
    expect(useCamera.getState().mode).toBe('orbit')
    expect(usePlayback.getState().source).toBeNull()
    expect(usePlayback.getState().playing).toBe(false)
  })

  it('toggle pauses and resumes; the live flag the rover reads follows', () => {
    usePlayback.getState().begin({ source: 'route', duration: 60, label: String })
    expect(playbackLive.paused).toBe(false)
    usePlayback.getState().toggle()
    expect(usePlayback.getState().playing).toBe(false)
    expect(playbackLive.paused).toBe(true)
    usePlayback.getState().toggle()
    expect(playbackLive.paused).toBe(false)
  })

  it('speed changes the live rate (1x, 4x, 16x only)', () => {
    usePlayback.getState().begin({ source: 'route', duration: 60, label: String })
    usePlayback.getState().setSpeed(16)
    expect(usePlayback.getState().speed).toBe(16)
    expect(playbackLive.rate).toBe(16)
    usePlayback.getState().setSpeed(3 as never)
    expect(usePlayback.getState().speed).toBe(16)
  })

  it('seek clamps to [0, duration] and bumps the seek counter', () => {
    usePlayback.getState().begin({ source: 'route', duration: 60, label: String })
    const n = usePlayback.getState().seekNonce
    usePlayback.getState().seek(999)
    expect(usePlayback.getState().t).toBe(60)
    usePlayback.getState().seek(-5)
    expect(usePlayback.getState().t).toBe(0)
    expect(usePlayback.getState().seekNonce).toBe(n + 2)
  })

  it('finish stops at the end; play from the end restarts from zero', () => {
    usePlayback.getState().begin({ source: 'route', duration: 60, label: String })
    usePlayback.getState().finish()
    expect(usePlayback.getState().t).toBe(60)
    expect(usePlayback.getState().playing).toBe(false)
    usePlayback.getState().toggle()
    expect(usePlayback.getState().t).toBe(0)
    expect(usePlayback.getState().playing).toBe(true)
  })

  it('does nothing without a source', () => {
    usePlayback.getState().toggle()
    usePlayback.getState().seek(5)
    expect(usePlayback.getState().playing).toBe(false)
    expect(usePlayback.getState().t).toBe(0)
  })
})

describe('playback helpers', () => {
  it('formats drive time as m:ss', () => {
    expect(fmtClock(0)).toBe('0:00')
    expect(fmtClock(65.4)).toBe('1:05')
    expect(fmtClock(3600)).toBe('60:00')
  })
  it('maps replay event types to marker kinds', () => {
    expect(eventKind('rockRevealed')).toBe('rock')
    expect(eventKind('speAlert')).toBe('spe')
    expect(eventKind('batteryLow')).toBe('low-energy')
    expect(eventKind('stuck')).toBe('stuck')
    expect(eventKind('shelterReached')).toBe('end')
    expect(eventKind('whatever')).toBeNull()
  })
  it('measures a path and cuts it at a distance', () => {
    const path = [
      { x: 0, z: 0 },
      { x: 10, z: 0 },
      { x: 10, z: 10 },
    ]
    expect(pathLength(path)).toBe(20)
    const cut = pointAlong(path, 15)
    expect(cut.x).toBeCloseTo(10)
    expect(cut.z).toBeCloseTo(5)
    expect(cut.rest).toEqual([{ x: 10, z: 10 }])
    expect(pointAlong(path, 0).rest).toHaveLength(2)
    expect(pointAlong(path, 99).rest).toEqual([{ x: 10, z: 10 }])
  })
})
