import type { PolicyCard } from '@/intelligence'
import { fmtPct } from '../shared/fmt'

/**
 * Result of the reference PPO policy 0.2.0 (sha256 fbb0bdfc86ca…) on the OFFICIAL suite v0.1 (marsx bench evaluate, test split, n = 600 for L1).
 * Measured by the team; kept next to the card on purpose: the card's own number is in-distribution and must never be
 * shown alone.
 */
export const REFERENCE_OFFICIAL = {
  suite: 'jezero-v1 0.1.0',
  level: 'L1',
  n: 600,
  success: 0.605,
  ci95: [0.565335, 0.643329] as const,
  threshold: 0.8,
} as const

export interface HonestSummary {
  inDistribution: string
  official: string
  verdict: string
}

/** The sentence pair the UI shows: in-distribution success next to the official suite result. */
export function honestSummary(card: Pick<PolicyCard, 'metrics'>): HonestSummary {
  const m = card.metrics
  const inDist = m['successTest']
  const low = m['successTestCi95Low']
  const n = m['testEpisodes']
  const o = REFERENCE_OFFICIAL
  return {
    inDistribution: inDist === undefined ? 'No data' : `${fmtPct(inDist)} success on unseen cells of its own training distribution${n !== undefined ? ` (${n} episodes${low !== undefined ? `, 95% lower bound ${fmtPct(low)}` : ''})` : ''}`,
    official: `${fmtPct(o.success)} on the official ${o.level} suite ${o.suite} (n = ${o.n}, 95% CI ${fmtPct(o.ci95[0])} to ${fmtPct(o.ci95[1])})`,
    verdict: `Does not pass ${o.level}: it needs at least ${fmtPct(o.threshold, 0)}.`,
  }
}
