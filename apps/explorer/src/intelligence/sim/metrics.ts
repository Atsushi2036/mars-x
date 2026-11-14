import type { Episode, Run } from '../contracts'

/**
 * Scorecard metrics recomputed from episode results, never trusted from the file. Port of
 * python/src/marsx/bench/metrics.py (Wilson CI, SPL, energy ratio, critical violations), rounded to 6
 * decimals so values compare bit-for-bit with Python.
 */
export type Metrics = Run['metrics']

const Z95 = 1.959963984540054
const CRITICAL = new Set(['collision', 'hazard', 'battery', 'spe_violation'])
const r6 = (x: number) => Number(x.toFixed(6))

export function wilsonCi95(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 1]
  const p = successes / n
  const z2 = Z95 * Z95
  const denom = 1 + z2 / n
  const centre = (p + z2 / (2 * n)) / denom
  const half = (Z95 / denom) * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))
  return [r6(Math.max(0, centre - half)), r6(Math.min(1, centre + half))]
}

export const isSuccess = (e: Episode) => e.outcome === 'success' && e.violations === 0
export const isCritical = (e: Episode) => CRITICAL.has(e.outcome) || e.violations > 0

export function spl(eps: readonly Episode[]): number | null {
  if (eps.length === 0 || eps.some((e) => !e.oracle)) return null
  let total = 0
  for (const e of eps) {
    if (!isSuccess(e)) continue
    const l = e.oracle!.pathM
    const denom = Math.max(e.pathM, l)
    total += denom === 0 ? 1 : l / denom
  }
  return r6(total / eps.length)
}

export function energyRatio(eps: readonly Episode[]): number | null {
  const ratios: number[] = []
  for (const e of eps) {
    const o = e.oracle?.energyWh
    if (isSuccess(e) && e.energyWh != null && o != null && o > 0) ratios.push(e.energyWh / o)
  }
  return ratios.length ? r6(ratios.reduce((a, b) => a + b, 0) / ratios.length) : null
}

export function alertCompliance(eps: readonly Episode[]): number | null {
  const alerted = eps.filter((e) => e.events.some((ev) => ev.type === 'speAlert'))
  if (alerted.length === 0) return null
  return r6(alerted.filter((e) => e.outcome !== 'spe_violation').length / alerted.length)
}

export function failureTaxonomy(eps: readonly Episode[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of eps) if (!isSuccess(e)) out[e.outcome] = (out[e.outcome] ?? 0) + 1
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)))
}

export function computeMetrics(eps: readonly Episode[]): Metrics {
  const n = eps.length
  const s = eps.filter(isSuccess).length
  const okPaths = eps.filter(isSuccess).map((e) => e.pathM)
  return {
    n,
    success: n ? r6(s / n) : 0,
    successCi95: wilsonCi95(s, n),
    spl: spl(eps),
    energyRatio: energyRatio(eps),
    violations: eps.filter(isCritical).length,
    meanPathM: okPaths.length ? r6(okPaths.reduce((a, b) => a + b, 0) / okPaths.length) : null,
  }
}

export interface MetricDiff {
  field: keyof Metrics
  claimed: unknown
  recomputed: unknown
}

/** Compare claimed vs recomputed metrics (tolerance on numbers). Fields the file does not claim are skipped. Empty array = consistent. */
export function diffMetrics(claimed: Metrics, recomputed: Metrics, tol = 1e-6): MetricDiff[] {
  const out: MetricDiff[] = []
  const same = (a: unknown, b: unknown): boolean => {
    if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]))
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= tol
    return (a ?? null) === (b ?? null)
  }
  for (const k of Object.keys(recomputed) as (keyof Metrics)[]) {
    if (claimed[k] === undefined) continue
    if (!same(claimed[k], recomputed[k])) out.push({ field: k, claimed: claimed[k], recomputed: recomputed[k] })
  }
  return out
}
