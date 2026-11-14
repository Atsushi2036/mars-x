import { Heightfield, decodeU16 } from '@/core/terrain/heightfield'
import { parseManifest, type Layer, type Manifest } from './manifest'

export type LoadStage = 'manifest' | 'elevation' | 'ortho' | 'mesh' | 'ready'

export interface LoadProgress {
  stage: LoadStage
  /** 0..1 within the stage */
  fraction: number
}

export interface Dataset {
  /** URL prefix, e.g. `/data/jezero-v1` (no trailing slash) */
  base: string
  manifest: Manifest
  heightfield: Heightfield
  /** raw LE Uint16 elevation, kept so the mesh worker can build its own copy without re-fetching */
  rawU16: Uint16Array
  elevationLayer: Layer
  orthoLayer: Layer | null
  synthetic: boolean
  nodataCount: number
}

const DATASET_NAME = /^[a-z0-9][a-z0-9._-]{0,63}$/i

/** Dataset ids are restricted to simple names so `?data=` can never point outside /data/. */
export function datasetBase(name: string): string {
  if (!DATASET_NAME.test(name)) throw new Error(`Invalid dataset name: ${name}`)
  return `${import.meta.env.BASE_URL.replace(/\/$/, '')}/data/${name}`
}

async function fetchJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new HttpError(url, res.status)
  const type = res.headers.get('content-type') ?? ''
  if (!type.includes('json')) throw new Error(`Expected JSON at ${url}, got ${type || 'unknown type'}`)
  return res.json()
}

export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`HTTP ${status} for ${url}`)
  }
}

async function fetchBytes(url: string, expected: number, onFraction: (f: number) => void, signal?: AbortSignal) {
  const res = await fetch(url, { signal })
  if (!res.ok) throw new HttpError(url, res.status)
  const total = Number(res.headers.get('content-length')) || expected
  if (!res.body) {
    const buf = new Uint8Array(await res.arrayBuffer())
    onFraction(1)
    return buf
  }
  const out = new Uint8Array(expected)
  let got = 0
  const reader = res.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (got + value.length > expected) throw new Error(`${url}: larger than the ${expected} bytes in the manifest`)
    out.set(value, got)
    got += value.length
    onFraction(Math.min(1, got / total))
  }
  if (got !== expected) throw new Error(`${url}: expected ${expected} bytes, got ${got}`)
  onFraction(1)
  return out
}

const HOST_LITTLE_ENDIAN = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1

export function bytesToU16LE(bytes: Uint8Array): Uint16Array {
  if (bytes.byteLength % 2 !== 0) throw new Error('Odd number of bytes for a uint16 raster')
  const out = new Uint16Array(bytes.byteLength / 2)
  if (HOST_LITTLE_ENDIAN) {
    new Uint8Array(out.buffer).set(bytes)
  } else {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    for (let i = 0; i < out.length; i++) out[i] = dv.getUint16(i * 2, true)
  }
  return out
}

export async function loadDataset(
  name: string,
  onProgress: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<Dataset> {
  const base = datasetBase(name)
  onProgress({ stage: 'manifest', fraction: 0 })
  const manifest = parseManifest(await fetchJson(`${base}/manifest.json`, signal))
  onProgress({ stage: 'manifest', fraction: 1 })

  // the render grid is `manifest.grid`; other elevation layers (e.g. the 2 m planning grid) are for planners
  const elevationLayer =
    manifest.layers.find((l) => l.kind === 'elevation' && l.gridId === manifest.grid.id) ??
    manifest.layers.find((l) => l.kind === 'elevation')
  if (!elevationLayer) throw new Error('Manifest has no elevation layer')
  const enc = elevationLayer.encoding
  if (enc.dtype !== 'uint16' || enc.scale == null || enc.offset == null || enc.nodata == null) {
    throw new Error('Elevation layer must be uint16 with scale, offset and nodata')
  }
  const grid = manifest.grids[elevationLayer.gridId]
  if (!grid) throw new Error('Elevation grid missing')
  if (elevationLayer.bytes !== grid.width * grid.height * 2) throw new Error('Elevation byte size does not match its grid')

  const bytes = await fetchBytes(
    `${base}/${elevationLayer.path}`,
    elevationLayer.bytes,
    (f) => onProgress({ stage: 'elevation', fraction: f }),
    signal,
  )
  const rawU16 = bytesToU16LE(bytes)
  const { heights, nodataCount } = decodeU16(rawU16, { scale: enc.scale, offset: enc.offset, nodata: enc.nodata }, grid.width, grid.height)
  const heightfield = new Heightfield(
    { width: grid.width, height: grid.height, res: grid.resM, transform: grid.transform, center: manifest.crs.center },
    heights,
  )
  const orthoLayer = manifest.layers.find((l) => l.kind === 'orthoimage' && l.tiling) ?? null
  return {
    base,
    manifest,
    heightfield,
    rawU16,
    elevationLayer,
    orthoLayer,
    synthetic: manifest.datasetId === 'synthetic' || elevationLayer.origin === 'simulated',
    nodataCount,
  }
}

/** Tries each candidate dataset in order; returns the first that loads and the errors of the failed ones. */
export async function loadFirstAvailable(
  candidates: string[],
  onProgress: (p: LoadProgress) => void,
  signal?: AbortSignal,
): Promise<Dataset> {
  let last: unknown
  for (const c of candidates) {
    try {
      return await loadDataset(c, onProgress, signal)
    } catch (e) {
      if (signal?.aborted) throw e
      // only fall through on "not found"; a corrupt real dataset must surface, not be hidden
      if (!(e instanceof HttpError && e.status === 404) && !(e instanceof Error && e.message.startsWith('Expected JSON'))) throw e
      last = e
    }
  }
  throw last instanceof Error ? last : new Error('No dataset available')
}
