import { describe, expect, it } from 'vitest'
import { NO_DATA } from '../shared/fmt'
import { buildConditionRows, hoursToUplink, medaSummarySchema, tableTimeMs, type ConditionInput } from './conditions'
import { scenarioById, SCENARIOS } from './scenarios'

const base = (over: Partial<ConditionInput> = {}): ConditionInput => ({
  scenario: scenarioById('jezero-v1/l2/solar-clear'),
  sol: 148,
  lmstH: 9,
  tauOverride: null,
  comm: 'none',
  meda: null,
  sun: null,
  link: null,
  ...over,
})
const row = (rows: ReturnType<typeof buildConditionRows>, key: string) => rows.find((r) => r.key === key)!

describe('current conditions', () => {
  it('says No data and gives no provenance when nothing is available', () => {
    const rows = buildConditionRows(base())
    for (const k of ['temperature', 'pressure', 'wind', 'sun', 'owlt', 'uplink']) {
      expect(row(rows, k).value).toBe(NO_DATA)
      expect(row(rows, k).provenance).toBeNull()
    }
  })
  it('keeps the scenario tau with its own provenance (assumption on the clear sol)', () => {
    const t = row(buildConditionRows(base()), 'tau')
    expect(t.value).toBe('0.50')
    expect(t.provenance).toBe('assumption')
    expect(row(buildConditionRows(base({ scenario: scenarioById('jezero-v1/l2/solar-storm'), sol: 315 })), 'tau').provenance).toBe('derived')
  })
  it('a user override is always an assumption', () => {
    const t = row(buildConditionRows(base({ tauOverride: 1.25 })), 'tau')
    expect(t.value).toBe('1.25')
    expect(t.provenance).toBe('assumption')
  })
  it('MEDA values are measured; modelled values are modeled', () => {
    const meda = medaSummarySchema.parse({
      sol: 148,
      daily: { temperatureMinK: 190, temperatureMaxK: 268, pressureMinPa: 700, pressureMaxPa: 760, windMeanMs: 4, windMaxMs: 11 },
    })
    const rows = buildConditionRows(base({ meda, sun: { azimuthDeg: 120, elevationDeg: 33.3 }, link: { owltS: 744, linkAvailable: true } }))
    expect(row(rows, 'temperature').provenance).toBe('measured')
    expect(row(rows, 'temperature').value).toBe('−83 to −5 °C')
    expect(row(rows, 'wind').value).toBe('4.0 m/s mean, 11.0 max')
    expect(row(rows, 'sun').provenance).toBe('modeled')
    expect(row(rows, 'owlt').value).toBe('12.4 min')
  })
  it('flags solar conjunction', () => {
    const r = row(buildConditionRows(base({ link: { owltS: 1200, linkAvailable: false } })), 'owlt')
    expect(r.note).toContain('conjunction')
  })
  it('uplink only exists for one plan per sol', () => {
    const s = scenarioById('jezero-v1/l3/rtg-onesol')
    const r = row(buildConditionRows(base({ scenario: s, comm: 'one_plan_per_sol', lmstH: 7 })), 'uplink')
    expect(r.value).toBe('09:00 LMST · in 2.0 h')
    expect(r.provenance).toBe('assumption')
  })
})

describe('time helpers', () => {
  it('wraps the uplink over the sol length', () => {
    expect(hoursToUplink(10, 9)).toBeCloseTo(24.6597 - 1, 3)
    expect(hoursToUplink(9, 9)).toBe(0)
  })
  it('maps LMST to the table clock (sol = 88775.244 s)', () => {
    expect(tableTimeMs(0, 12)).toBeCloseTo((88775.244 / 2) * 1000, 3)
  })
})

describe('scenario list', () => {
  it('uses the python ids and unique ids', () => {
    const ids = SCENARIOS.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('jezero-v1/l2/astronaut-clear')
    expect(ids.every((i) => i.startsWith('jezero-v1/l'))).toBe(true)
  })
})
