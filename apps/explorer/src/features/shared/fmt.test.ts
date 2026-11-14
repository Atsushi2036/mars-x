import { describe, expect, it } from 'vitest'
import { fmtCi, fmtClock, fmtHoursUntil, fmtNum, fmtOwlt, fmtPct, fmtPressureRange, fmtTempRange, NO_DATA } from './fmt'
import { toProvenance } from './provenance'

describe('formatting', () => {
  it('never invents a number for missing values', () => {
    expect(fmtNum(null)).toBe(NO_DATA)
    expect(fmtNum(Number.NaN)).toBe(NO_DATA)
    expect(fmtTempRange(null, 250)).toBe(NO_DATA)
    expect(fmtPressureRange(undefined, undefined)).toBe(NO_DATA)
    expect(fmtOwlt(undefined)).toBe(NO_DATA)
    expect(fmtCi(0.5, null)).toBe(NO_DATA)
  })
  it('converts kelvin to a Celsius range with a true minus sign', () => {
    expect(fmtTempRange(190, 268)).toBe('−83 to −5 °C')
  })
  it('formats clock, light time and percentages', () => {
    expect(fmtClock(9)).toBe('09:00')
    expect(fmtClock(13.5)).toBe('13:30')
    expect(fmtOwlt(744)).toBe('12.4 min')
    expect(fmtHoursUntil(0.5)).toBe('30 min')
    expect(fmtHoursUntil(3.25)).toBe('3.3 h')
    expect(fmtPct(0.8421)).toBe('84.2%')
    expect(fmtCi(0.84, [0.81, 0.87])).toBe('84.0% (81.0 to 87.0)')
  })
})

describe('provenance mapping', () => {
  it('maps python and manifest vocabularies', () => {
    expect(toProvenance('source')).toBe('derived')
    expect(toProvenance('computed')).toBe('derived')
    expect(toProvenance('observed')).toBe('measured')
    expect(toProvenance('simulated')).toBe('modeled')
    expect(toProvenance('assumption')).toBe('assumption')
  })
  it('falls back to the most cautious label', () => {
    expect(toProvenance('whatever')).toBe('assumption')
    expect(toProvenance(undefined)).toBe('assumption')
  })
})
