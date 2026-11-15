import { describe, expect, it } from 'vitest'
import { SCENARIOS, scenarioLabel } from './scenarios'

describe('scenarioLabel', () => {
  it('never repeats the level code (regression: "L1L1 geometry, RTG rover")', () => {
    for (const s of SCENARIOS) {
      const label = scenarioLabel(s)
      expect(label).not.toMatch(/^L[123]\b/)
      expect(`${s.level} ${label}`.match(/L[123]/g)).toHaveLength(1)
    }
  })
  it('keeps the rest of the title and starts with a capital', () => {
    const s = SCENARIOS.find((x) => x.id === 'jezero-v1/l1/rtg-geometry')!
    expect(scenarioLabel(s)).toBe('Geometry, RTG rover')
  })
})
