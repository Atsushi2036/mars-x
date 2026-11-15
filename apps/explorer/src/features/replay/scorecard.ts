import { computeMetrics, wilsonCi95, type Episode, type Run, type RunLoadResult } from '@/intelligence'
import type { VerificationSummary } from './verify'

/**
 * Scorecard preview computed in the browser from a loaded run.json. It mirrors python/src/marsx/bench/scorecard.py
 * (level thresholds v0.1, wording, limits) and never uses the numbers the file claims about itself: every figure is
 * recomputed from the episodes. The official, fully re-simulated scorecard is `marsx bench scorecard`.
 */
export const PROGRAM = 'MARS-X First Filter (simulation)'
export const LEVELS = ['L1', 'L2', 'L3'] as const
export type LevelId = (typeof LEVELS)[number]
export const LEVEL_NAMES: Record<LevelId, string> = {
  L1: 'Nominal navigation',
  L2: 'Under Mars conditions',
  L3: 'Consistent across sols & seeds',
}
export const STAMP = 'Simulation only — necessary, not sufficient'
export const DISCLAIMER = 'Uses NASA open data. Not affiliated with or endorsed by NASA, JPL or Caltech.'
export const THRESHOLDS_VERSION = 'v0.1'
export const THRESHOLDS = {
  L1: { success: 0.8 },
  L2: { success: 0.7 },
  L3: { wilsonLower: 0.6, minEpisodesPerFamily: 20 },
} as const

/** Text of python `NOT_COVERED` (the PO's fixed list). */
export const NOT_COVERED: readonly string[] = [
  'Wheel-soil interaction (slip, sinkage) beyond a slope and thermal-inertia proxy',
  'Real sensor noise and localisation drift',
  'Sub-metre terrain (only statistical, synthetic rocks)',
  'Thermal and mechanical faults',
  'Flight software and its timing',
  'DSN and relay scheduling',
  'Local weather variability and dust devils',
  'Human factors beyond the EVA budget',
  'Terrain outside the crop',
]

export type Status = 'pass' | 'fail' | 'not-run' | 'unverifiable'

export interface FamilyRow {
  id: string
  n: number
  success: number
  ci: [number, number]
}

/** Critical violation kinds shown in the scorecard (PO: rock collision, battery depleted, shelter rule; plus hazard entry). */
export const VIOLATION_LABEL: Record<string, string> = {
  collision: 'Rock collision',
  battery: 'Battery depleted',
  spe_violation: 'Shelter rule violated (SPE)',
  hazard: 'Hazard entered',
}

/** Which critical violation an episode counts as, or null. An episode that finished but logged rock hits counts as a collision. */
export function violationKind(e: Episode): string | null {
  if (e.outcome in VIOLATION_LABEL) return e.outcome
  return e.violations > 0 ? 'collision' : null
}

export function violationTypes(eps: readonly Episode[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of eps) {
    const k = violationKind(e)
    if (k) out[k] = (out[k] ?? 0) + 1
  }
  return out
}

export interface LevelRow {
  level: LevelId
  name: string
  status: Status
  n: number
  success: number | null
  ci: [number, number] | null
  spl: number | null
  energyRatio: number | null
  /** critical violations: episodes that ended in collision, hazard, battery or shelter failure */
  violations: number | null
  /** episodes with a critical violation, by kind */
  violationTypes: Record<string, number>
  reasons: string[]
  families: FamilyRow[]
}

export interface PrecheckRow {
  passed: boolean
  reasons: string[]
}

export interface Scorecard {
  verified: boolean
  precheck: PrecheckRow
  levels: LevelRow[]
  /** how the episodes were re-simulated; null while pending or when the dataset is not loaded */
  verification: VerificationSummary | null
  /** true while the re-simulation is still running (no seal until it finishes) */
  resimPending: boolean
  /** highest level granted with every level below it passed (needs every lower level to be run too) */
  seal: string | null
  failureTaxonomy: Record<string, number>
  /** the run's own level, to highlight */
  runLevel: LevelId
}

/** Families are the scenario ids; episodes without one fall back to the run's scenario. */
export function byFamily(run: Run): Map<string, Episode[]> {
  const m = new Map<string, Episode[]>()
  for (const e of run.episodes) {
    const id = e.scenarioId ?? run.scenario.id
    m.set(id, [...(m.get(id) ?? []), e])
  }
  return m
}

export function evaluateLevel(level: LevelId, run: Run, verified: boolean): Omit<LevelRow, 'name' | 'level'> {
  const eps = run.episodes
  const met = computeMetrics(eps)
  const fams = byFamily(run)
  const reasons: string[] = []
  if (!verified) reasons.push('Not verifiable: the numbers in the file do not match the episodes')
  if (eps.length === 0) reasons.push('No episodes')
  if (met.violations) reasons.push(`${met.violations} critical violation${met.violations === 1 ? '' : 's'} (any one fails the level)`)
  const families: FamilyRow[] = []
  for (const [id, list] of fams) {
    const m = computeMetrics(list)
    families.push({ id, n: m.n, success: m.success, ci: m.successCi95 })
  }
  if (level === 'L1' || level === 'L2') {
    const t = THRESHOLDS[level].success
    if (met.success < t) reasons.push(`Success ${(met.success * 100).toFixed(1)}% is below ${(t * 100).toFixed(0)}%`)
  } else {
    for (const f of families) {
      if (f.n < THRESHOLDS.L3.minEpisodesPerFamily) reasons.push(`Family ${f.id}: ${f.n} episodes, ${THRESHOLDS.L3.minEpisodesPerFamily} needed`)
      if (f.ci[0] < THRESHOLDS.L3.wilsonLower) reasons.push(`Family ${f.id}: Wilson lower bound ${(f.ci[0] * 100).toFixed(1)}% is below ${(THRESHOLDS.L3.wilsonLower * 100).toFixed(0)}%`)
    }
  }
  const status: Status = !verified ? 'unverifiable' : reasons.length === 0 ? 'pass' : 'fail'
  return { status, n: met.n, success: met.success, ci: met.successCi95, spl: met.spl ?? null, energyRatio: met.energyRatio ?? null, violations: met.violations, violationTypes: violationTypes(eps), reasons, families }
}

/** `datasetMatches`: the run was made on the dataset loaded in the page (null = unknown). */
/** One line on how much of the run was replayed, used in the header and the report. */
export function verificationLabel(v: VerificationSummary | null, pending: boolean): string {
  if (pending) return 'Re-simulating the episodes…'
  if (!v) return 'Not re-simulated (the dataset is not loaded)'
  if (v.state === 'mismatch') return `Not verifiable: ${v.mismatched} episode${v.mismatched === 1 ? '' : 's'} do not replay to the recorded result`
  if (v.state === 'not-resimulated') return 'Not verified by re-simulation: no episode could be replayed in the browser'
  if (v.notResimulable === 0) return `Verified by re-simulation: ${v.verified} of ${v.total} episodes replay exactly`
  return `Verified by re-simulation: ${v.verified} of ${v.total} episodes replay exactly; ${v.notResimulable} could not be replayed in the browser`
}

/**
 * `datasetMatches`: the run was made on the dataset loaded in the page (null = unknown).
 * `verification`: result of replaying the episodes with env-lite (null = not run yet); `pending` while it runs.
 */
export function buildScorecard(result: RunLoadResult, datasetMatches: boolean | null = null, verification: VerificationSummary | null = null, pending = false): Scorecard {
  const { run, metricDiffs } = result
  const pre: string[] = []
  if (verification?.state === 'mismatch') pre.push(...verification.examples.slice(0, 3).map((x) => `Episode #${x.index} does not replay to the recorded result: ${x.reason}`))
  if (verification?.state === 'not-resimulated') pre.push('No episode of this run could be re-simulated in the browser, so nothing was verified')
  if (metricDiffs.length) pre.push(`The file reports different ${metricDiffs.map((d) => d.field).join(', ')} than its episodes give`)
  if (datasetMatches === false) pre.push('The run was made on a different dataset version than the one loaded here')
  const verified = metricDiffs.length === 0 && verification?.state !== 'mismatch' && verification?.state !== 'not-resimulated'
  const level = run.suite.level
  const levels: LevelRow[] = LEVELS.map((l) =>
    l === level
      ? { level: l, name: LEVEL_NAMES[l], ...evaluateLevel(l, run, verified) }
      : { level: l, name: LEVEL_NAMES[l], status: 'not-run', n: 0, success: null, ci: null, spl: null, energyRatio: null, violations: null, violationTypes: {}, reasons: ['Not run'], families: [] },
  )
  const taxonomy: Record<string, number> = {}
  for (const e of run.episodes) if (!(e.outcome === 'success' && e.violations === 0)) taxonomy[e.outcome] = (taxonomy[e.outcome] ?? 0) + 1
  let best: LevelId | null = null
  for (const l of levels) {
    if (l.status === 'pass') best = l.level
    else break
  }
  const seal = best && pre.length === 0 && verification?.state === 'verified' && !pending ? `Passed MARS-X First Filter · ${best} · suite ${run.suite.version} · ${STAMP.toLowerCase()}.` : null
  return { verified, precheck: { passed: pre.length === 0, reasons: pre }, levels, verification, resimPending: pending, seal, failureTaxonomy: taxonomy, runLevel: level }
}

export function failureLabel(outcome: string): string {
  switch (outcome) {
    case 'collision':
      return 'Hit a hidden rock'
    case 'hazard':
      return 'Entered a hazard'
    case 'battery':
      return 'Ran out of energy'
    case 'stuck':
      return 'Got stuck'
    case 'spe_violation':
      return 'Shelter rule violated'
    case 'timeout':
      return 'Timed out'
    default:
      return outcome
  }
}

/** Plain-text status line for a level row. */
export function statusLabel(s: Status): string {
  return s === 'pass' ? 'Pass' : s === 'fail' ? 'Does not pass' : s === 'unverifiable' ? 'Not verifiable' : 'Not run'
}

/** JSON report the user downloads. Contains recomputed figures only plus the provenance of the run. */
export function reportJson(result: RunLoadResult, card: Scorecard, extra: { datasetSha256?: string | null; generatedUtc: string }) {
  const r = result.run
  return {
    schemaVersion: 'scorecard-web/1',
    program: PROGRAM,
    stamp: STAMP,
    disclaimer: DISCLAIMER,
    generatedUtc: extra.generatedUtc,
    note: 'Computed in the browser: every figure is recomputed from the episodes, and the episodes the browser can reproduce are replayed step by step. The official scorecard is produced by `marsx bench scorecard` with full re-simulation.',
    resimulation: card.verification,
    header: {
      model: r.policy.name,
      modelSha256: r.policy.sha256 ?? null,
      via: r.policy.kind,
      suite: { id: r.suite.id, version: r.suite.version, level: r.suite.level, split: r.suite.split, rootSeed: r.suite.rootSeed },
      marsx: { version: r.producer.marsxVersion, gitSha: r.producer.gitSha ?? null },
      runId: r.runId,
      runCreatedUtc: r.createdUtc,
      dataset: { id: r.dataset.id, sha256: r.dataset.sha256, loadedSha256: extra.datasetSha256 ?? null },
      scenario: r.scenario,
      status: card.verified ? 'Verified' : 'Not verifiable',
      verification: verificationLabel(card.verification, card.resimPending),
    },
    verdict: { precheck: { name: 'Integration check', ...card.precheck }, levels: card.levels.map((l) => ({ ...l, status: statusLabel(l.status) })), seal: card.seal, thresholdsVersion: THRESHOLDS_VERSION },
    conditions: r.conditions,
    failureTaxonomy: card.failureTaxonomy,
    notCovered: NOT_COVERED,
  }
}

export { wilsonCi95 }
