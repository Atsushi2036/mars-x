import {
  Box3,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  Group,
  Mesh,
  RedFormat,
  Sphere,
  UnsignedByteType,
  Vector3,
  type Texture,
} from 'three'
import type { Dataset } from '@/core/data/loader'
import { chunkLayout, chunkRange, CHUNK_PX, type ChunkLayout } from '@/core/terrain/chunk-mesh'
import { OrthoPyramid, orthoSpec } from '@/core/terrain/ortho'
import { createTerrainWorker, type TerrainWorker } from '@/core/terrain/worker-client'
import { createTerrainMaterial } from './terrain-material'

/** Distance (m, to the chunk's bounding box) below which a chunk uses LOD 0, 1, 2; beyond the last it uses LOD 3. */
const LOD_DISTANCES = [260, 620, 1500]
const MAX_LOD = LOD_DISTANCES.length
/** ortho pixels across a chunk, by mesh LOD */
const ORTHO_TARGET_PX = [1024, 512, 256, 256]
const MAX_IN_FLIGHT = 2

interface Chunk {
  cx: number
  cy: number
  lod: number
  mesh: Mesh | null
  pending: boolean
  texKey: string | null
  /** normalised rect in the raster: u0,u1,v0,v1 */
  rect: [number, number, number, number]
  /** world AABB used for distance tests */
  box: Box3
  wantLod: number
}

export interface ChunkProgress {
  mesh: number
  ortho: number
}

export class ChunkManager {
  readonly group = new Group()
  private chunks: Chunk[] = []
  private layout: ChunkLayout
  private worker: TerrainWorker | null = null
  private pyramid: OrthoPyramid | null = null
  private placeholder: Texture
  private acc = 0
  private disposed = false
  private inFlight = 0
  private cam = new Vector3()
  meshesReady = 0
  orthoReady = 0
  /** triangles currently resident (diagnostics) */
  triangles = 0

  constructor(
    private ds: Dataset,
    private onProgress: (p: ChunkProgress) => void,
    anisotropy: number,
  ) {
    const hf = ds.heightfield
    this.layout = chunkLayout(hf.width, hf.height, CHUNK_PX)
    const spec = ds.orthoLayer ? orthoSpec(ds.orthoLayer) : null
    if (spec) this.pyramid = new OrthoPyramid(ds.base, spec, anisotropy)
    this.placeholder = new DataTexture(new Uint8Array([120]), 1, 1, RedFormat, UnsignedByteType)
    this.placeholder.needsUpdate = true
    this.group.name = 'terrain'

    const ext = hf.extent
    const extW = ext.xMax - ext.xMin
    const extH = ext.zMax - ext.zMin
    for (let cy = 0; cy < this.layout.chunksY; cy++) {
      for (let cx = 0; cx < this.layout.chunksX; cx++) {
        const [c0, c1] = chunkRange(cx, this.layout.chunkPx, hf.width)
        const [r0, r1] = chunkRange(cy, this.layout.chunkPx, hf.height)
        const a = hf.pixelToWorld(c0, r0, true)
        const b = hf.pixelToWorld(c1, r1, true)
        this.chunks.push({
          cx,
          cy,
          lod: -1,
          mesh: null,
          pending: false,
          texKey: null,
          rect: [(a.x - ext.xMin) / extW, (b.x - ext.xMin) / extW, (a.z - ext.zMin) / extH, (b.z - ext.zMin) / extH],
          box: new Box3(new Vector3(a.x, hf.zMin, a.z), new Vector3(b.x, hf.zMax, b.z)),
          wantLod: MAX_LOD,
        })
      }
    }
  }

  get total() {
    return this.chunks.length
  }

  async start() {
    this.worker = await createTerrainWorker(this.ds)
    if (this.disposed) {
      this.worker.dispose()
      return
    }
    this.pump()
  }

  /** Call every frame with the camera position; LOD decisions are throttled to ~7 Hz. */
  update(camPos: Vector3, dt: number) {
    this.acc += dt
    if (this.acc < 0.14 && this.meshesReady >= this.chunks.length) return
    this.acc = 0
    this.cam.copy(camPos)
    for (const c of this.chunks) {
      const d = c.box.distanceToPoint(this.cam)
      let want = MAX_LOD
      for (let i = 0; i < LOD_DISTANCES.length; i++) {
        if (d < LOD_DISTANCES[i]!) {
          want = i
          break
        }
      }
      // hysteresis: only go coarser once clearly past the threshold
      if (c.lod >= 0 && want > c.lod && d < LOD_DISTANCES[Math.min(c.lod, MAX_LOD - 1)]! * 1.12) want = c.lod
      c.wantLod = c.mesh ? want : MAX_LOD // first pass: everything coarse, fast
      if (c.mesh && c.lod === MAX_LOD && want < MAX_LOD) c.wantLod = want
    }
    this.pump()
  }

  private pump() {
    if (!this.worker || this.disposed) return
    while (this.inFlight < MAX_IN_FLIGHT) {
      let best: Chunk | null = null
      let bestScore = Infinity
      for (const c of this.chunks) {
        if (c.pending || c.lod === c.wantLod) continue
        // empty chunks first, then nearest
        const score = (c.mesh ? 1e6 : 0) + c.box.distanceToPoint(this.cam)
        if (score < bestScore) {
          bestScore = score
          best = c
        }
      }
      if (!best) return
      void this.build(best)
    }
  }

  private async build(c: Chunk) {
    const worker = this.worker
    if (!worker) return
    c.pending = true
    this.inFlight++
    const lod = c.wantLod
    try {
      const m = await worker.api.build(c.cx, c.cy, lod, this.layout.chunkPx)
      if (this.disposed) return
      const geom = new BufferGeometry()
      geom.setAttribute('position', new BufferAttribute(m.positions, 3))
      geom.setAttribute('normal', new BufferAttribute(m.normals, 3))
      geom.setAttribute('uv', new BufferAttribute(m.uvs, 2))
      geom.setIndex(new BufferAttribute(m.indices, 1))
      const box = new Box3(new Vector3(m.bounds[0], m.bounds[1], m.bounds[2]), new Vector3(m.bounds[3], m.bounds[4], m.bounds[5]))
      geom.boundingBox = box
      geom.boundingSphere = box.getBoundingSphere(new Sphere())

      let tex: Texture = this.placeholder
      let key: string | null = null
      let pendingTex: Promise<Texture> | null = null
      if (this.pyramid) {
        const r = this.pyramid.chunkTexture(c.rect[0], c.rect[1], c.rect[2], c.rect[3], ORTHO_TARGET_PX[lod] ?? 256)
        key = r.key
        if (c.mesh) {
          // swapping an existing mesh: wait for the texture so the surface never flashes grey
          tex = await r.texture
          if (this.disposed) return
        } else pendingTex = r.texture
      }

      const mat = createTerrainMaterial(tex)
      const mesh = new Mesh(geom, mat)
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.matrixAutoUpdate = false
      mesh.updateMatrix()
      mesh.name = `chunk-${c.cx}-${c.cy}-lod${lod}`

      const old = c.mesh
      const oldKey = c.texKey
      this.group.add(mesh)
      if (old) this.disposeMesh(old, oldKey && oldKey !== key ? oldKey : null)
      else this.meshesReady++
      this.triangles += m.indices.length / 3 - (old ? old.geometry.index!.count / 3 : 0)
      c.mesh = mesh
      c.lod = lod
      c.texKey = key
      this.report()

      if (pendingTex) {
        void pendingTex
          .then((t) => {
            if (this.disposed || c.mesh !== mesh) return
            mat.map = t
            this.orthoReady++
            this.report()
          })
          .catch((e: unknown) => {
            console.warn('ortho tile failed', e)
            this.orthoReady++
            this.report()
          })
      } else if (!this.pyramid && !old) {
        this.orthoReady++
        this.report()
      }
    } catch (e) {
      console.error('chunk build failed', e)
      c.wantLod = c.lod // do not retry in a hot loop
    } finally {
      c.pending = false
      this.inFlight--
      this.pump()
    }
  }

  private disposeMesh(m: Mesh, texKey: string | null) {
    this.group.remove(m)
    m.geometry.dispose()
    ;(m.material as { dispose(): void }).dispose()
    if (texKey && this.pyramid) this.pyramid.release(texKey)
  }

  private report() {
    this.onProgress({ mesh: this.meshesReady / this.chunks.length, ortho: this.orthoReady / this.chunks.length })
  }

  dispose() {
    this.disposed = true
    for (const c of this.chunks) if (c.mesh) this.disposeMesh(c.mesh, c.texKey)
    this.worker?.dispose()
    this.placeholder.dispose()
  }
}
