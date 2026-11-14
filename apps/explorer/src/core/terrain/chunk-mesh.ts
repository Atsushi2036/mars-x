/**
 * Pure chunk mesh builder (runs inside the terrain Web Worker, unit-testable in node).
 *
 * The raster is split into square chunks of `chunkPx` vertex intervals. A chunk at LOD `l` uses a
 * vertex stride of 2^l pixels. Vertices sit on pixel centres, so the CPU `sampleHeight` surface and
 * the rendered surface are the same bilinear function at LOD 0. Neighbouring chunks at different LODs
 * are stitched with downward skirts (no T-junction cracks visible from above).
 */
import type { Heightfield } from './heightfield'

export const CHUNK_PX = 256

export interface ChunkLayout {
  chunksX: number
  chunksY: number
  chunkPx: number
  /** number of LOD levels (stride 1,2,4,...) */
  lodCount: number
}

export function chunkLayout(width: number, height: number, chunkPx = CHUNK_PX): ChunkLayout {
  const lodCount = Math.max(1, Math.floor(Math.log2(chunkPx / 8)) + 1) // stride up to chunkPx/8 -> >= 8 intervals
  return {
    chunksX: Math.max(1, Math.ceil((width - 1) / chunkPx)),
    chunksY: Math.max(1, Math.ceil((height - 1) / chunkPx)),
    chunkPx,
    lodCount,
  }
}

/** Pixel index range [start, end] (vertex indices, inclusive) covered by a chunk along one axis. */
export function chunkRange(index: number, chunkPx: number, size: number): [number, number] {
  const start = index * chunkPx
  return [start, Math.min(start + chunkPx, size - 1)]
}

function axisIndices(start: number, end: number, stride: number): number[] {
  const out: number[] = []
  for (let i = start; i < end; i += stride) out.push(i)
  out.push(end)
  return out
}

export interface ChunkMesh {
  positions: Float32Array
  normals: Float32Array
  uvs: Float32Array
  indices: Uint32Array
  /** world-space bounds: [minX,minY,minZ,maxX,maxY,maxZ] */
  bounds: [number, number, number, number, number, number]
  /** world-space extent of the chunk surface: [xMin, zMin, xMax, zMax] (for texture mapping) */
  extent: [number, number, number, number]
}

export function buildChunkMesh(hf: Heightfield, cx: number, cy: number, lod: number, chunkPx = CHUNK_PX): ChunkMesh {
  const stride = 1 << lod
  const [c0, c1] = chunkRange(cx, chunkPx, hf.width)
  const [r0, r1] = chunkRange(cy, chunkPx, hf.height)
  const cols = axisIndices(c0, c1, stride)
  const rows = axisIndices(r0, r1, stride)
  const nc = cols.length
  const nr = rows.length
  const gridCount = nc * nr
  const ringCount = 2 * (nc - 1) + 2 * (nr - 1)
  const vcount = gridCount + ringCount

  const positions = new Float32Array(vcount * 3)
  const normals = new Float32Array(vcount * 3)
  const uvs = new Float32Array(vcount * 2)

  const p00 = hf.pixelToWorld(c0, r0, true)
  const p11 = hf.pixelToWorld(c1, r1, true)
  const spanX = p11.x - p00.x || 1
  const spanZ = p11.z - p00.z || 1
  const nStep = stride * hf.res

  let minY = Infinity
  let maxY = -Infinity
  for (let j = 0; j < nr; j++) {
    for (let i = 0; i < nc; i++) {
      const w = hf.pixelToWorld(cols[i]!, rows[j]!, true)
      const y = hf.heights[rows[j]! * hf.width + cols[i]!]!
      const v = j * nc + i
      positions[v * 3] = w.x
      positions[v * 3 + 1] = y
      positions[v * 3 + 2] = w.z
      const n = hf.normalAt(w.x, w.z, nStep)
      normals[v * 3] = n.x
      normals[v * 3 + 1] = n.y
      normals[v * 3 + 2] = n.z
      uvs[v * 2] = (w.x - p00.x) / spanX
      uvs[v * 2 + 1] = (w.z - p00.z) / spanZ
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  // indices: grid (2 tris per cell, CCW seen from above) + skirts
  const gridQuads = (nc - 1) * (nr - 1)
  const indices = new Uint32Array(gridQuads * 6 + ringCount * 6)
  let k = 0
  for (let j = 0; j < nr - 1; j++) {
    for (let i = 0; i < nc - 1; i++) {
      const a = j * nc + i // p00
      const b = a + 1 // east
      const c = a + nc // south
      const d = c + 1
      indices[k++] = a
      indices[k++] = c
      indices[k++] = b
      indices[k++] = b
      indices[k++] = c
      indices[k++] = d
    }
  }

  // skirts: boundary ring traversed N edge W->E, E edge N->S, S edge E->W, W edge S->N
  const ring: number[] = []
  for (let i = 0; i < nc - 1; i++) ring.push(i)
  for (let j = 0; j < nr - 1; j++) ring.push(j * nc + (nc - 1))
  for (let i = nc - 1; i > 0; i--) ring.push((nr - 1) * nc + i)
  for (let j = nr - 1; j > 0; j--) ring.push(j * nc)
  const skirtDepth = Math.max(3, 3 * nStep)
  for (let s = 0; s < ring.length; s++) {
    const src = ring[s]!
    const dst = gridCount + s
    positions[dst * 3] = positions[src * 3]!
    positions[dst * 3 + 1] = positions[src * 3 + 1]! - skirtDepth
    positions[dst * 3 + 2] = positions[src * 3 + 2]!
    normals[dst * 3] = normals[src * 3]!
    normals[dst * 3 + 1] = normals[src * 3 + 1]!
    normals[dst * 3 + 2] = normals[src * 3 + 2]!
    uvs[dst * 2] = uvs[src * 2]!
    uvs[dst * 2 + 1] = uvs[src * 2 + 1]!
    minY = Math.min(minY, positions[dst * 3 + 1]!)
  }
  for (let s = 0; s < ring.length; s++) {
    const t = (s + 1) % ring.length
    const P = ring[s]!
    const Q = ring[t]!
    const P2 = gridCount + s
    const Q2 = gridCount + t
    indices[k++] = P
    indices[k++] = Q
    indices[k++] = P2
    indices[k++] = Q
    indices[k++] = Q2
    indices[k++] = P2
  }

  return {
    positions,
    normals,
    uvs,
    indices,
    bounds: [p00.x, minY, p00.z, p11.x, maxY, p11.z],
    extent: [p00.x, p00.z, p11.x, p11.z],
  }
}
