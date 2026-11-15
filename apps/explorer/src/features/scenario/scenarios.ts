import type { Provenance } from '../shared/provenance'

/**
 * Built-in scenarios, mirroring python/src/marsx/env/scenarios.py (the ids are the contract; the web
 * never invents one). Defaults below are the python Param values with their provenance.
 */
export type Level = 'L1' | 'L2' | 'L3'
export type CommMode = 'none' | 'delayed' | 'one_plan_per_sol'

export interface ScenarioDef {
  id: string
  title: string
  level: Level
  agent: 'RTG rover' | 'Solar rover' | 'Astronaut'
  /** default MEDA sol; null = geometry-only scenario (no atmosphere) */
  sol: number | null
  /** default dust optical depth and where it comes from; null = not modelled */
  tau: { value: number; provenance: Provenance; source: string } | null
  comm: CommMode
  /** uplink LMST hour for one-plan-per-sol, from the scenario */
  uplinkLmstH: number | null
  /** default local mean solar time, hours */
  lmstH: number
}

const LEMMON = 'Lemmon et al. 2022, doi:10.1029/2022GL100126'
const CLEAR_TAU = { value: 0.5, provenance: 'assumption' as const, source: 'Typical aphelion-season value; no per-sol measurement' }
const STORM_TAU = { value: 2.0, provenance: 'derived' as const, source: `${LEMMON} (storm peak, not a per-sol value)` }

export const SCENARIOS: readonly ScenarioDef[] = [
  { id: 'jezero-v1/l1/rtg-geometry', title: 'L1 geometry, RTG rover', level: 'L1', agent: 'RTG rover', sol: null, tau: null, comm: 'none', uplinkLmstH: null, lmstH: 12 },
  { id: 'jezero-v1/l1/astronaut-geometry', title: 'L1 geometry, astronaut', level: 'L1', agent: 'Astronaut', sol: null, tau: null, comm: 'none', uplinkLmstH: null, lmstH: 12 },
  { id: 'jezero-v1/l2/solar-clear', title: 'L2 solar rover, clear sol', level: 'L2', agent: 'Solar rover', sol: 148, tau: CLEAR_TAU, comm: 'none', uplinkLmstH: null, lmstH: 9 },
  { id: 'jezero-v1/l2/solar-storm', title: 'L2 solar rover, dust storm', level: 'L2', agent: 'Solar rover', sol: 315, tau: STORM_TAU, comm: 'none', uplinkLmstH: null, lmstH: 9 },
  { id: 'jezero-v1/l2/rtg-storm', title: 'L2 RTG rover, dust storm', level: 'L2', agent: 'RTG rover', sol: 315, tau: STORM_TAU, comm: 'none', uplinkLmstH: null, lmstH: 9 },
  { id: 'jezero-v1/l2/astronaut-clear', title: 'L2 astronaut, space-weather alert', level: 'L2', agent: 'Astronaut', sol: 148, tau: CLEAR_TAU, comm: 'none', uplinkLmstH: null, lmstH: 9 },
  { id: 'jezero-v1/l3/rtg-hidden-rocks', title: 'L3 RTG rover, hidden rocks', level: 'L3', agent: 'RTG rover', sol: null, tau: null, comm: 'none', uplinkLmstH: null, lmstH: 12 },
  { id: 'jezero-v1/l3/rtg-onesol', title: 'L3 hidden rocks, one plan per sol', level: 'L3', agent: 'RTG rover', sol: 148, tau: CLEAR_TAU, comm: 'one_plan_per_sol', uplinkLmstH: 9, lmstH: 9 },
]

export const DEFAULT_SCENARIO_ID = 'jezero-v1/l2/solar-storm'

export function scenarioById(id: string): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS.find((s) => s.id === DEFAULT_SCENARIO_ID)!
}

/** Sols with MEDA products in the benchmark lock (python/src/marsx/conditions/meda.py). */
export const MEDA_SOLS: ReadonlyArray<{ sol: number; season: 'clear' | 'dust storm' }> = [
  { sol: 148, season: 'clear' },
  { sol: 151, season: 'clear' },
  { sol: 160, season: 'clear' },
  { sol: 170, season: 'clear' },
  { sol: 313, season: 'dust storm' },
  { sol: 314, season: 'dust storm' },
  { sol: 315, season: 'dust storm' },
]

export const COMM_LABEL: Record<CommMode, string> = {
  none: 'Free',
  delayed: 'Delayed',
  one_plan_per_sol: '1 plan / sol',
}

/** Title without the level prefix: the level is shown once, as its own chip ("L1" + "Geometry, RTG rover"). */
export function scenarioLabel(s: ScenarioDef): string {
  const t = s.title.replace(/^L[123]\s+/, '')
  return t.charAt(0).toUpperCase() + t.slice(1)
}
