import { describe, expect, it } from 'vitest'
import { layerAvailability, LAYER_DEFS, ORDERED_LAYERS } from './layer-defs'

const manifest = (ids: string[]) => ({ layers: ids.map((id) => ({ id })) })

describe('layer availability', () => {
  it('slope and none need nothing from the manifest', () => {
    expect(layerAvailability('slope', manifest([]))).toEqual({ ok: true })
    expect(layerAvailability('none', manifest([]))).toEqual({ ok: true })
  })
  it('data layers are available only when the manifest ships their file', () => {
    expect(layerAvailability('hazard', manifest(['plan_hazard'])).ok).toBe(true)
    const miss = layerAvailability('crism', manifest(['plan_hazard']))
    expect(miss.ok).toBe(false)
    expect(miss.ok === false && miss.reason).toMatch(/not in this dataset/i)
  })
  it('every layer has a distinct shader id and a source line', () => {
    const ids = ORDERED_LAYERS.map((l) => LAYER_DEFS[l].shaderId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const l of ORDERED_LAYERS) if (l !== 'none') expect(LAYER_DEFS[l].sourceNote.length).toBeGreaterThan(5)
  })
  it('never uses a red ramp for continuous layers', () => {
    for (const l of ORDERED_LAYERS) {
      const d = LAYER_DEFS[l]
      if (d.legend.kind === 'ramp') expect(['viridis', 'cividis']).toContain(d.legend.ramp)
    }
  })
})
