import { describe, expect, it } from 'vitest'
import { computeCover } from './cover'

const view = { top: 0, right: 1440 - 88, bottom: 900 }

describe('computeCover', () => {
  it('desktop, inspector open: right = card width + gap, bottom = telemetry', () => {
    const c = computeCover(view, { bottom: 56 }, { left: view.right - 396 }, [{ top: 868 }])
    expect(c).toEqual({ top: 56, left: 0, right: 396, bottom: 32 })
  })
  it('desktop, inspector closed: nothing on the right', () => {
    expect(computeCover(view, { bottom: 56 }, null, [{ top: 868 }]).right).toBe(0)
  })
  it('phone: bottom is measured to the highest chrome (sheet above telemetry above nav)', () => {
    const c = computeCover({ top: 0, right: 390, bottom: 844 }, { bottom: 52 }, null, [{ top: 748 }, { top: 716 }, { top: 604 }])
    expect(c.bottom).toBe(240)
  })
  it('falls back to the spec defaults before the chrome is mounted', () => {
    expect(computeCover(view, null, null, [])).toEqual({ top: 56, left: 0, right: 0, bottom: 32 })
  })
})
