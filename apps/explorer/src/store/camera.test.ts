import { beforeEach, describe, expect, it } from 'vitest'
import { cameraRig, flyTo, focusBounds, resetNorth, useCamera, zoomBy } from './camera'

describe('focusBounds', () => {
  beforeEach(() => {
    cameraRig.focusRequest = null
    useCamera.setState({ mode: 'fpv' })
  })
  it('normalises the box and switches to the orbit camera', () => {
    focusBounds({ minX: 10, maxX: -10, minZ: 5, maxZ: -5 })
    expect(cameraRig.focusRequest).toEqual({ minX: -10, maxX: 10, minZ: -5, maxZ: 5 })
    expect(useCamera.getState().mode).toBe('orbit')
  })
  it('ignores non-finite boxes', () => {
    focusBounds({ minX: Number.NaN, maxX: 1, minZ: 0, maxZ: 1 })
    expect(cameraRig.focusRequest).toBeNull()
    expect(useCamera.getState().mode).toBe('fpv')
  })
})

describe('camera commands', () => {
  beforeEach(() => {
    cameraRig.flyRequest = null
    cameraRig.homePose = { x: 0, z: 0, yaw: 0.3, pitch: 0.9, dist: 700 }
    useCamera.setState({ mode: 'orbit' })
  })
  it('flyTo queues a request with a default duration and keeps the mode', () => {
    flyTo({ x: 10, z: -20, dist: 80 })
    expect(cameraRig.flyRequest).toMatchObject({ x: 10, z: -20, dist: 80, ms: 900 })
    expect(useCamera.getState().mode).toBe('orbit')
  })
  it('flyTo ignores non-finite targets', () => {
    flyTo({ x: Number.NaN, z: 1 })
    expect(cameraRig.flyRequest).toBeNull()
  })
  it('resetNorth asks for yaw 0 only', () => {
    resetNorth()
    expect(cameraRig.flyRequest).toMatchObject({ yaw: 0, ms: 350 })
    expect(cameraRig.flyRequest?.x).toBeUndefined()
  })
  it('zoomBy queues a relative distance factor, clamped to a sane range', () => {
    zoomBy(0.75)
    expect(cameraRig.flyRequest).toMatchObject({ distFactor: 0.75, ms: 200 })
    zoomBy(100)
    expect(cameraRig.flyRequest?.distFactor).toBe(4)
  })
  it('home returns to orbit and flies to the stored pose', () => {
    useCamera.setState({ mode: 'chase' })
    cameraRig.home()
    expect(useCamera.getState().mode).toBe('orbit')
    expect(cameraRig.flyRequest).toMatchObject({ x: 0, z: 0, yaw: 0.3, pitch: 0.9, dist: 700 })
  })
})
