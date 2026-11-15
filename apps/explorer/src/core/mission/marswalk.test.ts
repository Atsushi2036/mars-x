import { describe, expect, it } from 'vitest'
import { astronautStepEnergyWh, ENERGY } from '@/intelligence/sim/energy'
import { compareRoutes, DEFAULT_WALK, marswalkReport } from './marswalk'

const flat = () => 0
const line = (len: number, step = 10) => Array.from({ length: Math.round(len / step) + 1 }, (_, i) => ({ x: i * step, z: 0 }))

describe('marswalkReport', () => {
  it('round trip time = out + back + stop, margin against the 4 h EVA', () => {
    const r = marswalkReport(line(1000), flat)
    expect(r.distanceM).toBeCloseTo(1000, 6)
    expect(r.outboundS).toBeCloseTo(1000, 6) // 1 m/s
    expect(r.roundTripS).toBeCloseTo(2000 + 30 * 60, 6)
    expect(r.marginS).toBeCloseTo(4 * 3600 - r.roundTripS, 6)
    expect(r.withinBudget).toBe(true)
  })
  it('flags a route that does not fit the EVA budget', () => {
    const r = marswalkReport(line(8000, 100), flat)
    expect(r.withinBudget).toBe(false)
    expect(r.marginS).toBeLessThan(0)
  })
  it('energy uses the existing metabolic model, symmetric on flat ground', () => {
    const r = marswalkReport(line(600), flat)
    const once = astronautStepEnergyWh(600, 0)
    expect(r.energyOutWh).toBeCloseTo(once, 6)
    expect(r.energyBackWh).toBeCloseTo(once, 6)
    expect(r.consumablesWh).toBeCloseTo(ENERGY.evaDurationH * ENERGY.metRateHighW, 6)
  })
  it('going up costs more than coming down', () => {
    const ramp = (x: number) => x * Math.tan((15 * Math.PI) / 180)
    const r = marswalkReport(line(200), ramp)
    expect(r.energyOutWh).toBeGreaterThan(r.energyBackWh)
  })
  it('shelter rule: nothing unsafe inside the window, the far part is flagged beyond it', () => {
    const ok = marswalkReport(line(1500), flat)
    expect(ok.shelter.unsafeFromM).toBeNull()
    expect(ok.shelter.maxSafeM).toBeCloseTo(1800, 6)
    const far = marswalkReport(line(2600, 100), flat)
    expect(far.shelter.unsafeFromM).toBeCloseTo(1800, 6)
    expect(far.shelter.unsafeM).toBeCloseTo(800, 6)
    expect(far.shelter.boundary?.x).toBeCloseTo(1800, 6)
    expect(far.shelter.unsafePath[0]!.x).toBeCloseTo(1800, 6)
    expect(far.shelter.unsafePath.at(-1)!.x).toBeCloseTo(2600, 6)
  })
  it('a shorter window shrinks the safe distance', () => {
    const r = marswalkReport(line(1000), flat, { ...DEFAULT_WALK, shelterMin: 10 })
    expect(r.shelter.maxSafeM).toBeCloseTo(600, 6)
    expect(r.shelter.unsafeM).toBeCloseTo(400, 6)
  })
})

describe('compareRoutes', () => {
  it('identical routes overlap fully', () => {
    const d = compareRoutes(line(200), line(200), () => 5, 15)
    expect(d.overlapPct).toBe(100)
    expect(d.roverMetresAboveLimit).toBe(0)
  })
  it('counts rover metres above the astronaut slope limit', () => {
    const d = compareRoutes(line(200), line(200), (x) => (x > 100 ? 20 : 5), 15)
    expect(d.roverMetresAboveLimit).toBeCloseTo(100, 6)
  })
})
