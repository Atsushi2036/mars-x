import { describe, expect, it } from 'vitest'
import { computeMetrics, diffMetrics, type Episode, type Run, type RunLoadResult } from '@/intelligence'
import { buildScorecard, evaluateLevel, failureLabel, NOT_COVERED, reportJson, STAMP, statusLabel, verificationLabel, violationKind, violationTypes } from './scorecard'
import type { VerificationSummary } from './verify'

const ver = (o: Partial<VerificationSummary> = {}): VerificationSummary => ({ verified: 10, mismatched: 0, notResimulable: 0, total: 10, examples: [], gaps: {}, state: 'verified', ...o })

const ep = (i: number, outcome: Episode['outcome'] = 'success', scenarioId = 'jezero-v1/l1/rtg-geometry', violations = 0): Episode => ({
  index: i,
  seed: i,
  scenarioId,
  start: [0, 0],
  goal: [5, 5],
  outcome,
  steps: 10,
  pathM: 12,
  energyWh: 100,
  oracle: { pathM: 10, cost: 11, energyWh: 90 },
  risk: { timeSlopeGt15S: 0 },
  violations,
  events: [],
})

function mk(eps: Episode[], level: 'L1' | 'L2' | 'L3' = 'L1', tamper?: (r: Run) => void): RunLoadResult {
  const metrics = computeMetrics(eps)
  const run = {
    schemaVersion: 'run/1',
    runId: 'r',
    createdUtc: '2026-11-15T00:00:00Z',
    producer: { marsxVersion: '0.1.0', python: '3.13', platform: 'x' },
    suite: { id: 'jezero-v1', version: '0.1.0', level, split: 'test', rootSeed: 1 },
    dataset: { id: 'jezero-v1', sha256: 'a'.repeat(64), layers: {} },
    scenario: { id: 'jezero-v1/l1/rtg-geometry', sha256: 'b'.repeat(64) },
    policy: { name: 'my-model', kind: 'onnx', sha256: 'c'.repeat(64), contract: 'policy/1', obsSpec: 'obs/1' },
    conditions: { medaSols: [], gravity: 3.69 },
    episodes: eps,
    metrics,
  } as Run
  tamper?.(run)
  const recomputed = computeMetrics(run.episodes)
  return { run, recomputed, metricDiffs: diffMetrics(run.metrics, recomputed), bytes: 1000 }
}

describe('level verdicts (thresholds v0.1)', () => {
  it('L1 passes at 80% success with no critical violation', () => {
    const eps = Array.from({ length: 10 }, (_, i) => ep(i, i < 8 ? 'success' : 'timeout'))
    const c = buildScorecard(mk(eps), true, ver())
    expect(c.levels[0]!.status).toBe('pass')
    expect(c.seal).toContain('Passed MARS-X First Filter · L1')
    expect(c.seal).toContain('necessary, not sufficient')
  })
  it('fails below 80% and says why', () => {
    const eps = Array.from({ length: 10 }, (_, i) => ep(i, i < 7 ? 'success' : 'timeout'))
    const l = buildScorecard(mk(eps)).levels[0]!
    expect(l.status).toBe('fail')
    expect(l.reasons[0]).toContain('below 80%')
  })
  it('any critical violation fails the level even with a high success rate', () => {
    const eps = [...Array.from({ length: 19 }, (_, i) => ep(i)), ep(19, 'collision')]
    const l = buildScorecard(mk(eps)).levels[0]!
    expect(l.status).toBe('fail')
    expect(l.violations).toBe(1)
    expect(l.reasons.join(' ')).toContain('critical violation')
  })
  it('L2 needs 70%', () => {
    const eps = Array.from({ length: 10 }, (_, i) => ep(i, i < 7 ? 'success' : 'timeout', 'jezero-v1/l2/solar-clear'))
    expect(buildScorecard(mk(eps, 'L2')).levels[1]!.status).toBe('pass')
  })
  it('L3 requires 20 episodes and a 60% Wilson lower bound in EVERY family', () => {
    const small = Array.from({ length: 10 }, (_, i) => ep(i, 'success', 'jezero-v1/l3/rtg-onesol'))
    const a = buildScorecard(mk(small, 'L3')).levels[2]!
    expect(a.status).toBe('fail')
    expect(a.reasons.join(' ')).toContain('20 needed')
    const ok = Array.from({ length: 40 }, (_, i) => ep(i, 'success', 'jezero-v1/l3/rtg-onesol'))
    expect(buildScorecard(mk(ok, 'L3')).levels[2]!.status).toBe('pass')
    const mixed = [...ok, ...Array.from({ length: 40 }, (_, i) => ep(100 + i, i < 10 ? 'success' : 'timeout', 'jezero-v1/l3/rtg-hidden-rocks'))]
    const m = buildScorecard(mk(mixed, 'L3')).levels[2]!
    expect(m.status).toBe('fail')
    expect(m.reasons.join(' ')).toContain('rtg-hidden-rocks')
  })
  it('levels that were not run say so', () => {
    const c = buildScorecard(mk([ep(0)]))
    expect(c.levels.map((l) => l.status)).toEqual(['pass', 'not-run', 'not-run'])
  })
})

describe('verification', () => {
  it('a file whose claimed metrics differ from its episodes is Not verifiable and gets no level or seal', () => {
    const r = mk(
      Array.from({ length: 10 }, (_, i) => ep(i)),
      'L1',
      (run) => {
        run.metrics = { ...run.metrics, success: 0.5 }
      },
    )
    const c = buildScorecard(r)
    expect(c.verified).toBe(false)
    expect(c.precheck.passed).toBe(false)
    expect(c.levels[0]!.status).toBe('unverifiable')
    expect(c.seal).toBeNull()
    expect(statusLabel(c.levels[0]!.status)).toBe('Not verifiable')
  })
  it('a run made on another dataset version fails the integration check and gets no seal', () => {
    const c = buildScorecard(mk([ep(0)]), false)
    expect(c.precheck.passed).toBe(false)
    expect(c.seal).toBeNull()
  })
  it('uses recomputed figures, never the claimed ones', () => {
    const l = evaluateLevel('L1', mk([ep(0), ep(1, 'timeout')]).run, true)
    expect(l.success).toBe(0.5)
  })
})

describe('re-simulation of the episodes', () => {
  const eps = Array.from({ length: 10 }, (_, i) => ep(i))
  it('no seal until the replay has finished and matched', () => {
    expect(buildScorecard(mk(eps), true, null).seal).toBeNull()
    expect(buildScorecard(mk(eps), true, null, true).seal).toBeNull()
    expect(buildScorecard(mk(eps), true, ver()).seal).not.toBeNull()
  })
  it('an episode that does not replay makes the run Not verifiable: no level, no seal', () => {
    const v = ver({ verified: 9, mismatched: 1, state: 'mismatch', examples: [{ index: 3, reason: 'outcome: file says success, dynamics give collision' }] })
    const c = buildScorecard(mk(eps), true, v)
    expect(c.verified).toBe(false)
    expect(c.levels[0]!.status).toBe('unverifiable')
    expect(c.seal).toBeNull()
    expect(c.precheck.reasons.join(' ')).toContain('Episode #3')
  })
  it('nothing re-simulated means nothing verified', () => {
    const c = buildScorecard(mk(eps), true, ver({ verified: 0, notResimulable: 10, state: 'not-resimulated' }))
    expect(c.precheck.passed).toBe(false)
    expect(c.seal).toBeNull()
  })
  it('says exactly how much was replayed', () => {
    expect(verificationLabel(ver(), false)).toBe('Verified by re-simulation: 10 of 10 episodes replay exactly')
    expect(verificationLabel(ver({ verified: 6, notResimulable: 4 }), false)).toContain('4 could not be replayed in the browser')
    expect(verificationLabel(null, true)).toContain('Re-simulating')
    expect(verificationLabel(ver({ mismatched: 2, state: 'mismatch' }), false)).toContain('Not verifiable')
  })
})

describe('critical violations by kind', () => {
  it('maps outcomes to violation kinds', () => {
    expect(violationKind(ep(0, 'collision'))).toBe('collision')
    expect(violationKind(ep(0, 'battery'))).toBe('battery')
    expect(violationKind(ep(0, 'spe_violation'))).toBe('spe_violation')
    expect(violationKind(ep(0, 'hazard'))).toBe('hazard')
    expect(violationKind(ep(0, 'timeout'))).toBeNull()
    expect(violationKind(ep(0, 'stuck'))).toBeNull()
    expect(violationKind(ep(0, 'success', undefined, 2))).toBe('collision')
  })
  it('counts episodes per kind', () => {
    expect(violationTypes([ep(0, 'collision'), ep(1, 'collision'), ep(2, 'battery'), ep(3)])).toEqual({ collision: 2, battery: 1 })
  })
  it('lands in the level row', () => {
    const l = buildScorecard(mk([ep(0), ep(1, 'battery')])).levels[0]!
    expect(l.violationTypes).toEqual({ battery: 1 })
  })
})

describe('report and wording', () => {
  it('the download carries the stamp, the limits and no verdict for unrun levels', () => {
    const r = mk([ep(0)])
    const rep = reportJson(r, buildScorecard(r), { generatedUtc: '2026-11-15T00:00:00Z', datasetSha256: null })
    expect(rep.stamp).toBe(STAMP)
    expect(rep.notCovered).toEqual(NOT_COVERED)
    expect(rep.verdict.levels[1]!.status).toBe('Not run')
    expect(JSON.stringify(rep)).not.toMatch(/certified|validated|flight-ready|TRL/i)
  })
  it('names failures in plain words', () => {
    expect(failureLabel('collision')).toBe('Hit a hidden rock')
    expect(failureLabel('spe_violation')).toBe('Shelter rule violated')
  })
})
