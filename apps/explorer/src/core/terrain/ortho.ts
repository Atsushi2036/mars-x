/**
 * Orthoimage tile pyramid -> per-chunk textures.
 *
 * The manifest describes `levels` (lod 0 = full resolution, each level halves) of square tiles named by
 * `pathTemplate` ({lod},{x},{y}; y counts rows from the NORTH). A terrain chunk asks for the level whose
 * resolution suits its mesh LOD; the covering tiles are composed on a canvas and the texture's
 * offset/repeat select exactly the chunk's rectangle, so chunk UVs stay local (0..1).
 */
import { CanvasTexture, LinearMipmapLinearFilter, LinearFilter, SRGBColorSpace } from 'three'
import type { Layer } from '@/core/data/manifest'

export interface OrthoLevel {
  lod: number
  size: number
  tiles: number
}

export interface OrthoSpec {
  tileSize: number
  levels: OrthoLevel[]
  pathTemplate: string
}

export function orthoSpec(layer: Layer): OrthoSpec | null {
  const t = layer.tiling
  if (!t) return null
  const levels = t.levels
    .map((l) => ({ lod: l.lod ?? 0, size: l.size ?? 0, tiles: l.tiles ?? 1 }))
    .filter((l) => l.size > 0)
    .sort((a, b) => a.lod - b.lod)
  if (levels.length === 0) return null
  return { tileSize: t.tileSize, levels, pathTemplate: t.pathTemplate }
}

/**
 * Finest level whose pixel count across the chunk does not exceed `targetPx`
 * (falls back to the coarsest level). `chunkFraction` = chunk width / full raster width.
 */
export function pickLevel(levels: OrthoLevel[], chunkFraction: number, targetPx: number): OrthoLevel {
  for (const l of levels) if (l.size * chunkFraction <= targetPx) return l
  return levels[levels.length - 1]!
}

export interface TileRange {
  tx0: number
  tx1: number
  ty0: number
  ty1: number
  /** texture offset/repeat so that the composed canvas shows exactly the requested rectangle */
  offset: [number, number]
  repeat: [number, number]
}

/** Tiles covering the normalised rectangle [u0,u1] x [v0,v1] (v from the north) at `level`. */
export function tilesFor(level: OrthoLevel, u0: number, u1: number, v0: number, v1: number): TileRange {
  const n = level.tiles
  const eps = 1e-9
  const tx0 = Math.max(0, Math.min(n - 1, Math.floor(u0 * n + eps)))
  const tx1 = Math.max(tx0, Math.min(n - 1, Math.ceil(u1 * n - eps) - 1))
  const ty0 = Math.max(0, Math.min(n - 1, Math.floor(v0 * n + eps)))
  const ty1 = Math.max(ty0, Math.min(n - 1, Math.ceil(v1 * n - eps) - 1))
  const wx = (tx1 - tx0 + 1) / n
  const wy = (ty1 - ty0 + 1) / n
  return {
    tx0,
    tx1,
    ty0,
    ty1,
    offset: [(u0 - tx0 / n) / wx, (v0 - ty0 / n) / wy],
    repeat: [(u1 - u0) / wx, (v1 - v0) / wy],
  }
}

export function tileUrl(base: string, template: string, lod: number, x: number, y: number): string {
  const rel = template.replace('{lod}', String(lod)).replace('{x}', String(x)).replace('{y}', String(y))
  if (rel.includes('..') || rel.startsWith('/')) throw new Error('Unsafe tile path in manifest')
  return `${base}/${rel}`
}

export class OrthoPyramid {
  private bitmaps = new Map<string, Promise<ImageBitmap>>()
  private cache = new Map<string, Promise<CanvasTexture>>()

  constructor(
    private base: string,
    private spec: OrthoSpec,
    private maxAnisotropy = 4,
  ) {}

  get levels() {
    return this.spec.levels
  }

  private bitmap(url: string): Promise<ImageBitmap> {
    let p = this.bitmaps.get(url)
    if (!p) {
      p = fetch(url)
        .then((r) => {
          if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
          return r.blob()
        })
        .then((b) => createImageBitmap(b, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' }))
      this.bitmaps.set(url, p)
      if (this.bitmaps.size > 160) {
        const oldest = this.bitmaps.keys().next().value
        if (oldest) this.bitmaps.delete(oldest)
      }
    }
    return p
  }

  /** Texture for a chunk given its rectangle in normalised raster coordinates. Cached by (level, rect). */
  chunkTexture(
    u0: number,
    u1: number,
    v0: number,
    v1: number,
    targetPx: number,
  ): { key: string; texture: Promise<CanvasTexture> } {
    const level = pickLevel(this.spec.levels, u1 - u0, targetPx)
    const key = `${level.lod}:${u0.toFixed(6)}:${v0.toFixed(6)}`
    let p = this.cache.get(key)
    if (!p) {
      p = this.compose(level, u0, u1, v0, v1)
      this.cache.set(key, p)
    }
    return { key, texture: p }
  }

  /** Releases a cached texture once the chunk no longer uses it. */
  release(key: string) {
    const p = this.cache.get(key)
    if (p) {
      this.cache.delete(key)
      void p.then((t) => t.dispose())
    }
  }

  levelFor(chunkFraction: number, targetPx: number) {
    return pickLevel(this.spec.levels, chunkFraction, targetPx)
  }

  private async compose(level: OrthoLevel, u0: number, u1: number, v0: number, v1: number) {
    const r = tilesFor(level, u0, u1, v0, v1)
    const dim = Math.min(this.spec.tileSize, level.size)
    const nx = r.tx1 - r.tx0 + 1
    const ny = r.ty1 - r.ty0 + 1
    const jobs: Array<Promise<{ bmp: ImageBitmap; i: number; j: number }>> = []
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const url = tileUrl(this.base, this.spec.pathTemplate, level.lod, r.tx0 + i, r.ty0 + j)
        jobs.push(this.bitmap(url).then((bmp) => ({ bmp, i, j })))
      }
    }
    const tiles = await Promise.all(jobs)
    const canvas = new OffscreenCanvas(nx * dim, ny * dim)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D canvas unavailable')
    for (const t of tiles) ctx.drawImage(t.bmp, t.i * dim, t.j * dim, dim, dim)
    const tex = new CanvasTexture(canvas as unknown as HTMLCanvasElement)
    tex.colorSpace = SRGBColorSpace
    tex.flipY = false
    tex.generateMipmaps = true
    tex.minFilter = LinearMipmapLinearFilter
    tex.magFilter = LinearFilter
    tex.anisotropy = this.maxAnisotropy
    tex.offset.set(r.offset[0], r.offset[1])
    tex.repeat.set(r.repeat[0], r.repeat[1])
    tex.needsUpdate = true
    return tex
  }
}
