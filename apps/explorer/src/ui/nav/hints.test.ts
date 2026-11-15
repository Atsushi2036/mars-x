import { describe, expect, it } from 'vitest'
import { bumpCount, hintFor, MAX_SHOWS, shouldShow } from './hints'

describe('control hints', () => {
  it('shows at most 3 times per mode', () => {
    let c = {}
    for (let i = 0; i < MAX_SHOWS; i++) {
      expect(shouldShow(c, 'orbit')).toBe(true)
      c = bumpCount(c, 'orbit')
    }
    expect(shouldShow(c, 'orbit')).toBe(false)
    expect(shouldShow(c, 'fpv')).toBe(true)
  })
  it('has a mouse and a touch text for every camera', () => {
    for (const m of ['orbit', 'fpv', 'chase'] as const) {
      expect(hintFor(m, false).length).toBeGreaterThan(5)
      expect(hintFor(m, true).length).toBeGreaterThan(5)
    }
    expect(hintFor('orbit', true)).toContain('Pinch')
  })
})
