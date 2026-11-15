import { describe, expect, it } from 'vitest'
import { advanceClock, DAY_SPEEDS, SOL_HOURS } from './day-clock'

describe('advanceClock', () => {
  it('moves a full sol in secondsPerSol seconds', () => {
    expect(advanceClock(0, 30, 30)).toBeCloseTo(0, 9) // wraps back to the start
    expect(advanceClock(0, 15, 30)).toBeCloseTo(SOL_HOURS / 2, 9)
  })
  it('wraps past the end of the sol', () => {
    expect(advanceClock(24, 1, 30)).toBeCloseTo(24 + SOL_HOURS / 30 - SOL_HOURS, 9)
  })
  it('ignores invalid input instead of producing NaN', () => {
    expect(advanceClock(5, Number.NaN, 30)).toBe(5)
    expect(advanceClock(5, 1, 0)).toBe(5)
  })
  it('fast is faster than slow', () => {
    expect(DAY_SPEEDS.fast).toBeLessThan(DAY_SPEEDS.slow)
  })
})
