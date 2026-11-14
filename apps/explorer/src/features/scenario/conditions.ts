import { z } from 'zod'
import { NO_DATA, fmtClock, fmtHoursUntil, fmtNum, fmtOwlt, fmtPressureRange, fmtTempRange } from '../shared/fmt'
import { toProvenance, type Provenance } from '../shared/provenance'
import type { CommMode, ScenarioDef } from './scenarios'

/** Mean solar day in seconds (Mars24 / NSSDC: 24h 39m 35.244s). */
export const SOL_SECONDS = 88775.244

/** Daily MEDA summary the pipeline may publish at `<dataset>/meda/sol-NNNN.json` (subset of python summarize_sol). */
export const medaSummarySchema = z.object({
  sol: z.number().int(),
  season: z.string().nullish(),
  daily: z.object({
    hoursWithData: z.number().int().nullish(),
    temperatureMinK: z.number().nullable(),
    temperatureMaxK: z.number().nullable(),
    pressureMinPa: z.number().nullable(),
    pressureMaxPa: z.number().nullable(),
    windMeanMs: z.number().nullable(),
    windMaxMs: z.number().nullable(),
  }),
  tau: z.number().nullish(),
  tauSource: z.string().nullish(),
  tauProvenance: z.string().nullish(),
  source: z.string().nullish(),
})
export type MedaSummary = z.infer<typeof medaSummarySchema>

export interface SunReading {
  azimuthDeg: number
  elevationDeg: number
}
export interface LinkReading {
  owltS: number
  linkAvailable: boolean
}

export interface ConditionInput {
  scenario: ScenarioDef
  sol: number | null
  /** local mean solar time of the slider, hours */
  lmstH: number
  /** user override of tau; null = use the scenario value */
  tauOverride: number | null
  comm: CommMode
  meda: MedaSummary | null
  sun: SunReading | null
  link: LinkReading | null
}

export interface ConditionRow {
  key: 'temperature' | 'pressure' | 'wind' | 'tau' | 'sun' | 'owlt' | 'uplink'
  label: string
  /** display text; NO_DATA when the value is not available */
  value: string
  /** null exactly when value is NO_DATA */
  provenance: Provenance | null
  /** one short line: where it comes from, or why it is missing */
  note: string
}

const noData = (key: ConditionRow['key'], label: string, note: string): ConditionRow => ({ key, label, value: NO_DATA, provenance: null, note })

/** Hours from `lmstH` to the next uplink at `uplinkH`, wrapping over the sol length (24.66 h). */
export function hoursToUplink(lmstH: number, uplinkH: number): number {
  const solH = SOL_SECONDS / 3600
  const d = (uplinkH - lmstH) % solH
  return d < 0 ? d + solH : d
}

export function buildConditionRows(i: ConditionInput): ConditionRow[] {
  const rows: ConditionRow[] = []
  const medaNote = i.meda?.source ?? 'NASA PDS Atmospheres Node, Perseverance MEDA'
  const noMeda = i.sol === null ? 'This scenario has no atmosphere model.' : `No MEDA summary published for sol ${i.sol}.`

  const d = i.meda?.daily
  rows.push(
    d && d.temperatureMinK !== null && d.temperatureMaxK !== null
      ? { key: 'temperature', label: 'Air temperature', value: fmtTempRange(d.temperatureMinK, d.temperatureMaxK), provenance: 'measured', note: `Sol ${i.meda!.sol} min to max. ${medaNote}` }
      : noData('temperature', 'Air temperature', noMeda),
  )
  rows.push(
    d && d.pressureMinPa !== null && d.pressureMaxPa !== null
      ? { key: 'pressure', label: 'Pressure', value: fmtPressureRange(d.pressureMinPa, d.pressureMaxPa), provenance: 'measured', note: `Sol ${i.meda!.sol} min to max. ${medaNote}` }
      : noData('pressure', 'Pressure', noMeda),
  )
  rows.push(
    d && d.windMeanMs !== null
      ? { key: 'wind', label: 'Wind', value: `${fmtNum(d.windMeanMs, 1)} m/s mean${d.windMaxMs !== null ? `, ${fmtNum(d.windMaxMs, 1)} max` : ''}`, provenance: 'measured', note: `Horizontal wind speed, sol ${i.meda!.sol}. ${medaNote}` }
      : noData('wind', 'Wind', noMeda),
  )

  // tau: user override > published value for the sol > scenario default; never silently invented
  if (i.tauOverride !== null) {
    rows.push({ key: 'tau', label: 'Dust opacity (tau)', value: fmtNum(i.tauOverride, 2), provenance: 'assumption', note: 'Set by you. Overrides the scenario value.' })
  } else if (i.meda?.tau != null) {
    rows.push({ key: 'tau', label: 'Dust opacity (tau)', value: fmtNum(i.meda.tau, 2), provenance: toProvenance(i.meda.tauProvenance), note: i.meda.tauSource ?? 'Published value' })
  } else if (i.scenario.tau) {
    rows.push({ key: 'tau', label: 'Dust opacity (tau)', value: fmtNum(i.scenario.tau.value, 2), provenance: i.scenario.tau.provenance, note: i.scenario.tau.source })
  } else {
    rows.push(noData('tau', 'Dust opacity (tau)', 'MEDA does not measure tau; no published value for this sol.'))
  }

  rows.push(
    i.sun
      ? { key: 'sun', label: 'Sun elevation', value: `${fmtNum(i.sun.elevationDeg, 1)}° · az ${fmtNum(i.sun.azimuthDeg, 0)}°`, provenance: 'modeled', note: `Mars24 algorithm (Allison & McEwen 2000) at ${fmtClock(i.lmstH)} LMST` }
      : noData('sun', 'Sun elevation', i.sol === null ? 'This scenario has no lighting model.' : `No Mars24 sun table for sol ${i.sol} in this dataset.`),
  )

  rows.push(
    i.link
      ? { key: 'owlt', label: 'One-way light time', value: fmtOwlt(i.link.owltS), provenance: 'modeled', note: `${i.link.linkAvailable ? 'Link available' : 'Solar conjunction, no commanding'}. Approximate Keplerian ephemeris (JPL)` }
      : noData('owlt', 'One-way light time', 'No light-time table for this date in this dataset.'),
  )

  if (i.comm === 'one_plan_per_sol' && i.scenario.uplinkLmstH !== null) {
    const h = hoursToUplink(i.lmstH, i.scenario.uplinkLmstH)
    rows.push({ key: 'uplink', label: 'Next uplink window', value: `${fmtClock(i.scenario.uplinkLmstH)} LMST · in ${fmtHoursUntil(h)}`, provenance: 'assumption', note: 'One plan per sol, no corrections inside the sol. Uplink hour is a scenario setting.' })
  } else {
    rows.push(noData('uplink', 'Next uplink window', i.comm === 'none' ? 'Communication mode is free: there is no uplink schedule.' : 'This scenario defines no uplink hour.'))
  }
  return rows
}

/** Table time for a local-mean-solar-time slider value: the sun tables start at LMST midnight. */
export function tableTimeMs(startMs: number, lmstH: number): number {
  return startMs + (lmstH / 24) * SOL_SECONDS * 1000
}
