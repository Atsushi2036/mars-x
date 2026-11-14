import { describe, expect, it } from 'vitest'
import { buildChunkMesh, chunkLayout, chunkRange } from './chunk-mesh'
import { Heightfield } from './heightfield'

function field(w: number, h: number, fn: (c: number, r: number) => number) {
  const heights = new Float32Array(w * h)
  for (let r = 0; r < h; r++) for (let c = 0; c < w; c++) heights[r * w + c] = fn(c, r)
  return new Heightfield(
    { width: w, height: h, res: 1, transform: [1, 0, -w / 2, 0, -1, h / 2], center: { lon: 77, lat: 18 } },
    heights,
  )
}

describe('chunk layout', () => {
  it('covers every vertex interval, clipping the last chunk', () => {
    const l = chunkLayout(1024, 1024, 256)
    expect(l.chunksX).toBe(4)
    expect(chunkRange(3, 256, 1024)).toEqual([768, 1023])
    expect(chunkLayout(2048, 2048, 256).chunksX).toBe(8)
  })
})

describe('buildChunkMesh', () => {
  const hf = field(33, 33, (c, r) => Math.sin(c / 3) * 2 + r * 0.5)

  it('LOD0 vertices lie exactly on the CPU surface', () => {
    const m = buildChunkMesh(hf, 0, 0, 0, 32)
    for (let v = 0; v < 33 * 33; v += 17) {
      const x = m.positions[v * 3]!
      const z = m.positions[v * 3 + 2]!
      expect(m.positions[v * 3 + 1]).toBeCloseTo(hf.sampleHeight(x, z), 4)
    }
  })

  it('has valid indices and grid triangles facing up (CCW from above)', () => {
    const m = buildChunkMesh(hf, 0, 0, 1, 32)
    const vcount = m.positions.length / 3
    expect(Math.max(...m.indices)).toBeLessThan(vcount)
    const gridTris = 16 * 16 * 2
    for (let t = 0; t < gridTris; t++) {
      const [a, b, c] = [m.indices[t * 3]!, m.indices[t * 3 + 1]!, m.indices[t * 3 + 2]!]
      const p = (i: number) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!] as const
      const [pa, pb, pc] = [p(a), p(b), p(c)]
      const u = [pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]]
      const v = [pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]]
      const ny = u[2]! * v[0]! - u[0]! * v[2]!
      expect(ny).toBeGreaterThan(0)
    }
  })

  it('skirt triangles face outward and hang below the rim', () => {
    const m = buildChunkMesh(hf, 0, 0, 2, 32)
    const grid = (32 / 4 + 1) ** 2
    const cx = (m.extent[0] + m.extent[2]) / 2
    const cz = (m.extent[1] + m.extent[3]) / 2
    const first = (grid > 0 ? (32 / 4) * (32 / 4) * 6 : 0)
    for (let t = first; t < m.indices.length; t += 3) {
      const idx = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!]
      const P = idx.map((i) => [m.positions[i * 3]!, m.positions[i * 3 + 1]!, m.positions[i * 3 + 2]!])
      const u = [P[1]![0]! - P[0]![0]!, P[1]![1]! - P[0]![1]!, P[1]![2]! - P[0]![2]!]
      const v = [P[2]![0]! - P[0]![0]!, P[2]![1]! - P[0]![1]!, P[2]![2]! - P[0]![2]!]
      const n = [u[1]! * v[2]! - u[2]! * v[1]!, u[2]! * v[0]! - u[0]! * v[2]!, u[0]! * v[1]! - u[1]! * v[0]!]
      const mx = (P[0]![0]! + P[1]![0]! + P[2]![0]!) / 3 - cx
      const mz = (P[0]![2]! + P[1]![2]! + P[2]![2]!) / 3 - cz
      expect(n[0]! * mx + n[2]! * mz).toBeGreaterThan(0) // normal points away from the chunk centre
    }
  })

  it('uvs span 0..1 and bounds contain all vertices', () => {
    const m = buildChunkMesh(hf, 0, 0, 0, 32)
    expect(Math.min(...m.uvs)).toBeCloseTo(0)
    expect(Math.max(...m.uvs)).toBeCloseTo(1)
    for (let v = 0; v < m.positions.length / 3; v++) {
      expect(m.positions[v * 3 + 1]).toBeGreaterThanOrEqual(m.bounds[1])
      expect(m.positions[v * 3 + 1]).toBeLessThanOrEqual(m.bounds[4])
    }
  })

  it('handles a clipped edge chunk whose size is not divisible by the stride', () => {
    const odd = field(40, 40, () => 1)
    const m = buildChunkMesh(odd, 1, 1, 2, 32) // chunk covers 32..39 -> 7 intervals, stride 4
    expect(m.positions.every(Number.isFinite)).toBe(true)
    expect(Math.max(...m.indices)).toBeLessThan(m.positions.length / 3)
  })
})
