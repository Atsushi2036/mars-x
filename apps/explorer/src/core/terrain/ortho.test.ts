import { describe, expect, it } from 'vitest'
import { pickLevel, tileUrl, tilesFor, type OrthoLevel } from './ortho'

const levels: OrthoLevel[] = [
  { lod: 0, size: 8192, tiles: 16 },
  { lod: 1, size: 4096, tiles: 8 },
  { lod: 2, size: 2048, tiles: 4 },
  { lod: 3, size: 1024, tiles: 2 },
  { lod: 4, size: 512, tiles: 1 },
]

describe('ortho pyramid maths', () => {
  it('picks the finest level that fits the pixel budget for a chunk (1/8 of the raster)', () => {
    expect(pickLevel(levels, 1 / 8, 1024).lod).toBe(0) // 8192/8 = 1024 px
    expect(pickLevel(levels, 1 / 8, 512).lod).toBe(1)
    expect(pickLevel(levels, 1 / 8, 256).lod).toBe(2)
    expect(pickLevel(levels, 1 / 8, 8).lod).toBe(4) // falls back to the coarsest
  })

  it('a chunk aligned to the tile grid maps to exact tiles with identity-like offset/repeat', () => {
    const r = tilesFor(levels[1]!, 0.25, 0.375, 0.5, 0.625) // lod1: 8 tiles, chunk = exactly tile (2,4)
    expect([r.tx0, r.tx1, r.ty0, r.ty1]).toEqual([2, 2, 4, 4])
    expect(r.offset[0]).toBeCloseTo(0)
    expect(r.repeat[0]).toBeCloseTo(1)
  })

  it('a chunk spanning several tiles gets a sub-rectangle of the composed canvas', () => {
    const r = tilesFor(levels[0]!, 0, 0.125, 0, 0.125) // 16 tiles: chunk covers tiles 0..1
    expect([r.tx0, r.tx1]).toEqual([0, 1])
    expect(r.repeat[0]).toBeCloseTo(1)
    const half = tilesFor(levels[4]!, 0.25, 0.375, 0.5, 0.625) // single 512 tile holds the whole raster
    expect(half.tx0).toBe(0)
    expect(half.repeat[0]).toBeCloseTo(0.125)
    expect(half.offset[0]).toBeCloseTo(0.25)
  })

  it('tile urls use the template and reject path escapes', () => {
    expect(tileUrl('/data/x', 'ortho/{lod}/{x}_{y}.webp', 2, 3, 1)).toBe('/data/x/ortho/2/3_1.webp')
    expect(() => tileUrl('/data/x', '../{lod}', 0, 0, 0)).toThrow()
  })
})
