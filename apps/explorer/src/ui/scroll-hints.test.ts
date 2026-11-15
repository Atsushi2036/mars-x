import { describe, expect, it } from 'vitest'
import { nextSectionTitle, pageDownTarget, pillLabel, scrollHints } from './scroll-hints'

describe('scrollHints', () => {
  it('shows nothing when the content fits', () => {
    expect(scrollHints(0, 500, 500)).toEqual({ above: false, below: false })
    expect(scrollHints(0, 500, 504)).toEqual({ above: false, below: false })
  })
  it('shows only the bottom cue at the start of a long panel', () => {
    expect(scrollHints(0, 500, 1200)).toEqual({ above: false, below: true })
  })
  it('shows both cues in the middle', () => {
    expect(scrollHints(300, 500, 1200)).toEqual({ above: true, below: true })
  })
  it('shows only the top cue at the end (with sub-pixel slack)', () => {
    expect(scrollHints(700, 500, 1200)).toEqual({ above: true, below: false })
    expect(scrollHints(695.5, 500, 1200).below).toBe(false)
  })
  it('ignores an unmeasured container', () => {
    expect(scrollHints(0, 0, 900)).toEqual({ above: false, below: false })
  })
})

describe('pageDownTarget', () => {
  it('moves about 80 % of the visible height', () => {
    expect(pageDownTarget(0, 500, 2000)).toBe(400)
  })
  it('stops at the end', () => {
    expect(pageDownTarget(650, 500, 1200)).toBe(700)
  })
})

describe('next section', () => {
  const items = [
    { title: 'Route', top: 100 },
    { title: 'EVA budget', top: 640 },
    { title: 'Details', top: 900 },
  ]
  it('names the first heading below the fold', () => {
    expect(nextSectionTitle(items, 500)).toBe('EVA budget')
  })
  it('is null when everything is visible', () => {
    expect(nextSectionTitle(items, 1000)).toBeNull()
  })
  it('falls back to a generic label for long or missing names', () => {
    expect(pillLabel(null)).toBe('More below')
    expect(pillLabel('A very long section title that does not fit')).toBe('More below')
    expect(pillLabel('EVA budget')).toBe('EVA budget')
  })
})
