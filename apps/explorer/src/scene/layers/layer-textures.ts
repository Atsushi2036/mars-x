import {
  ClampToEdgeWrapping,
  DataArrayTexture,
  DataTexture,
  LinearFilter,
  NearestFilter,
  RedFormat,
  RGBAFormat,
  Texture,
  UnsignedByteType,
} from 'three'
import type { Dataset } from '@/core/data/loader'
import type { Layer } from '@/core/data/manifest'
import type { LayerId } from '@/store/app'
import { LAYER_DEFS } from './layer-defs'

/**
 * GPU textures for the data overlays. They are fetched lazily the first time a layer is chosen and
 * cached per dataset. Every raster covers the same window as the elevation grid, so the shader finds
 * the texel from the world position alone (see terrain-material.ts).
 */
const cache = new Map<string, Promise<Texture>>()

async function fetchChecked(url: string, expected: number): Promise<Uint8Array> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  const buf = new Uint8Array(await res.arrayBuffer())
  if (buf.byteLength !== expected) throw new Error(`${url}: expected ${expected} bytes, got ${buf.byteLength}`)
  return buf
}

function gridOf(ds: Dataset, layer: Layer) {
  const g = layer.gridId ? ds.manifest.grids[layer.gridId] : undefined
  if (!g) throw new Error(`Layer ${layer.id} has no grid`)
  return g
}

function r8(bytes: Uint8Array, w: number, h: number, linear: boolean): DataTexture {
  const t = new DataTexture(bytes as unknown as BufferSource as Uint8Array<ArrayBuffer>, w, h, RedFormat, UnsignedByteType)
  t.unpackAlignment = 1
  t.minFilter = t.magFilter = linear ? LinearFilter : NearestFilter
  t.wrapS = t.wrapT = ClampToEdgeWrapping
  t.generateMipmaps = false
  t.needsUpdate = true
  return t
}

async function build(ds: Dataset, id: LayerId): Promise<Texture> {
  const def = LAYER_DEFS[id]
  const layer = ds.manifest.layers.find((l) => l.id === def.manifestId)
  if (!layer) throw new Error(`Layer ${id} is not in this dataset`)
  const g = gridOf(ds, layer)
  const url = `${ds.base}/${layer.path}`
  if (id === 'hazard') return r8(await fetchChecked(url, layer.bytes), g.width, g.height, true)
  if (id === 'slip') return r8(await fetchChecked(url, layer.bytes), g.width, g.height, false)
  if (id === 'illum') {
    const bytes = await fetchChecked(url, layer.bytes)
    const depth = 16
    if (bytes.byteLength !== depth * g.width * g.height) throw new Error('Horizon maps: unexpected size')
    const t = new DataArrayTexture(bytes as unknown as Uint8Array<ArrayBuffer>, g.width, g.height, depth)
    t.format = RedFormat
    t.type = UnsignedByteType
    t.unpackAlignment = 1
    t.minFilter = t.magFilter = LinearFilter
    t.wrapS = t.wrapT = ClampToEdgeWrapping
    t.generateMipmaps = false
    t.needsUpdate = true
    return t
  }
  if (id === 'crism') {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    const bmp = await createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' })
    const t = new Texture(bmp)
    t.format = RGBAFormat
    t.minFilter = t.magFilter = NearestFilter // classes are never blended
    t.flipY = false
    t.generateMipmaps = false
    t.premultiplyAlpha = false
    t.needsUpdate = true
    return t
  }
  throw new Error(`No texture for layer ${id}`)
}

/** Loads (once per dataset) the texture of a data layer. */
export function loadLayerTexture(ds: Dataset, id: LayerId): Promise<Texture> {
  const key = `${ds.base}|${id}`
  let p = cache.get(key)
  if (!p) {
    p = build(ds, id)
    p.catch(() => cache.delete(key))
    cache.set(key, p)
  }
  return p
}
