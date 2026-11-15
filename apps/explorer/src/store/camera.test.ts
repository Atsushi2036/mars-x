import { beforeEach, describe, expect, it } from 'vitest'
import { cameraRig, focusBounds, useCamera } from './camera'

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
