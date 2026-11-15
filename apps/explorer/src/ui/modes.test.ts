import { describe, expect, it } from 'vitest'
import { MODES, RAIL_MODES, SUBTITLE_MAX, railIdFor } from './modes'

describe('modes', () => {
  it('keeps every panel subtitle within 60 characters', () => {
    for (const m of MODES) expect(m.subtitle.length, m.id).toBeLessThanOrEqual(SUBTITLE_MAX)
  })
  it('names the rail after tasks', () => {
    expect(RAIL_MODES.map((m) => m.label)).toEqual(['Explore', 'Plan a route', 'Test your AI', 'Data'])
    expect(RAIL_MODES.map((m) => m.shortLabel)).toEqual(['Explore', 'Plan', 'Test AI', 'Data'])
  })
  it('lights Explore while the Layers panel is open', () => {
    expect(railIdFor('layers')).toBe('explore')
    expect(railIdFor('mission')).toBe('mission')
  })
})
