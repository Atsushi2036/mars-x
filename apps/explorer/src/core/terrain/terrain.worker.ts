/// <reference lib="webworker" />
import * as Comlink from 'comlink'
import { buildChunkMesh, type ChunkMesh } from './chunk-mesh'
import { Heightfield, decodeU16, type HeightfieldParams, type U16Encoding } from './heightfield'

let hf: Heightfield | null = null

const api = {
  /** Receives the raw LE Uint16 raster (transferred, not copied) and builds the worker-side heightfield. */
  init(raw: Uint16Array, enc: U16Encoding, params: HeightfieldParams) {
    const { heights } = decodeU16(raw, enc, params.width, params.height)
    hf = new Heightfield(params, heights)
  },
  /** Builds one chunk mesh; the typed arrays are transferred back to the main thread. */
  build(cx: number, cy: number, lod: number, chunkPx: number): ChunkMesh {
    if (!hf) throw new Error('terrain worker not initialised')
    const mesh = buildChunkMesh(hf, cx, cy, lod, chunkPx)
    return Comlink.transfer(mesh, [mesh.positions.buffer, mesh.normals.buffer, mesh.uvs.buffer, mesh.indices.buffer])
  },
}

export type TerrainWorkerApi = typeof api
Comlink.expose(api)
