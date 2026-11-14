/**
 * Generates a SYNTHETIC dataset with exactly the same format as the real pipeline output
 * (manifest.json + height.u16 + WebP ortho pyramid) so the Explorer can be developed and deployed
 * before the real Jezero data exists. It is NOT real Mars data and is labelled as such in the manifest.
 *
 * Usage: node scripts/make-synthetic-dataset.mjs [--if-missing]
 * Output: apps/explorer/public/data/synthetic/
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const here = path.dirname(fileURLToPath(import.meta.url))
const out = path.resolve(here, '../public/data/synthetic')
if (process.argv.includes('--if-missing') && fs.existsSync(path.join(out, 'manifest.json'))) {
  console.log('synthetic dataset already present')
  process.exit(0)
}

const N = 1024 // DEM pixels per side, 1 m/px
const ORTHO = 4 * N // 25 cm/px
const TILE = 512
const CENTER = { lon: 77.4035, lat: 18.4845 }
const R = 3396190

// ---- deterministic value noise -------------------------------------------------------------
function hash2(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295
}
const smooth = (t) => t * t * (3 - 2 * t)
function vnoise(x, y, s) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const tx = smooth(x - xi)
  const ty = smooth(y - yi)
  const a = hash2(xi, yi, s)
  const b = hash2(xi + 1, yi, s)
  const c = hash2(xi, yi + 1, s)
  const d = hash2(xi + 1, yi + 1, s)
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty
}
function fbm(x, y, oct, s) {
  let v = 0
  let a = 0.5
  let f = 1
  for (let i = 0; i < oct; i++) {
    v += a * vnoise(x * f, y * f, s + i * 17)
    f *= 2
    a *= 0.5
  }
  return v
}

// ---- terrain: crater bowl + rim + delta fan + ridges + fBm ---------------------------------
function terrainAt(u, v) {
  // u, v in [0,1] across the window (v grows south)
  const x = u - 0.5
  const y = v - 0.5
  const rad = Math.hypot(x - 0.12, y + 0.08)
  const bowl = -90 * Math.exp(-Math.pow(rad / 0.38, 2)) // main depression
  const rim = 45 * Math.exp(-Math.pow((rad - 0.43) / 0.07, 2))
  // delta fan: a lobe fanning from the north-west, with channels
  const dx = x + 0.28
  const dy = y + 0.3
  const dr = Math.hypot(dx, dy)
  const ang = Math.atan2(dy, dx)
  const fan = 55 * Math.exp(-Math.pow(dr / 0.42, 2)) * (0.6 + 0.4 * Math.cos(ang * 6 + dr * 18))
  const mesa = 38 * smoothstep(0.0, 0.05, 0.16 - Math.hypot(x - 0.08, y - 0.22))
  const ridge = 14 * Math.sin((x * 2.2 + y * 1.1) * 14 + fbm(u * 6, v * 6, 3, 5) * 5)
  const relief = 70 * (fbm(u * 5, v * 5, 6, 1) - 0.5) + 14 * (fbm(u * 40, v * 40, 4, 9) - 0.5)
  // small craters
  let craters = 0
  for (let i = 0; i < 26; i++) {
    const cx = hash2(i, 1, 77)
    const cy = hash2(i, 2, 77)
    const cr = 0.012 + hash2(i, 3, 77) * 0.03
    const dd = Math.hypot(u - cx, v - cy)
    craters -= 14 * cr * 30 * Math.exp(-Math.pow(dd / cr, 2)) - 5 * cr * 30 * Math.exp(-Math.pow((dd - cr * 1.1) / (cr * 0.3), 2))
  }
  return -2600 + bowl + rim + fan + mesa + ridge + relief + craters
}
function smoothstep(a, b, t) {
  const x = Math.min(1, Math.max(0, (t - a) / (b - a)))
  return x * x * (3 - 2 * x)
}

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(out, { recursive: true })

// ---- DEM ----------------------------------------------------------------------------------
const dem = new Float32Array(N * N)
let lo = Infinity
let hi = -Infinity
for (let r = 0; r < N; r++) {
  for (let c = 0; c < N; c++) {
    const z = terrainAt((c + 0.5) / N, (r + 0.5) / N)
    dem[r * N + c] = z
    if (z < lo) lo = z
    if (z > hi) hi = z
  }
}
const scale = (hi - lo) / 65534
const q = new Uint16Array(N * N)
for (let i = 0; i < q.length; i++) q[i] = Math.round((dem[i] - lo) / scale)
const heightBytes = Buffer.alloc(q.length * 2)
for (let i = 0; i < q.length; i++) heightBytes.writeUInt16LE(q[i], i * 2) // explicit LE
fs.writeFileSync(path.join(out, 'height.u16'), heightBytes)

// ---- Ortho pyramid (grey, shaded relief + albedo noise; real data is a monochrome RED band) ----
function shade(c, r) {
  // c, r in DEM pixel units (float). Lambert shading from the NW at 35 deg
  const e = (cc, rr) => dem[Math.min(N - 1, Math.max(0, Math.round(rr))) * N + Math.min(N - 1, Math.max(0, Math.round(cc)))]
  const dzdx = (e(c + 1, r) - e(c - 1, r)) / 2
  const dzdy = (e(c, r + 1) - e(c, r - 1)) / 2
  const nx = -dzdx
  const ny = -dzdy
  const nz = 1
  const inv = 1 / Math.hypot(nx, ny, nz)
  const lx = -0.5
  const ly = -0.5
  const lz = 0.7
  const l = Math.hypot(lx, ly, lz)
  return Math.max(0, (nx * lx + ny * ly + nz * lz) * inv / l)
}
const fullSize = ORTHO
const full = Buffer.alloc(fullSize * fullSize)
for (let r = 0; r < fullSize; r++) {
  for (let c = 0; c < fullSize; c++) {
    const dc = c / 4
    const dr = r / 4
    const alb = 0.78 + 0.34 * fbm(c / 90, r / 90, 4, 21) + 0.12 * (fbm(c / 6, r / 6, 2, 33) - 0.5)
    const s = 0.35 + 0.75 * shade(dc, dr)
    full[r * fullSize + c] = Math.max(0, Math.min(255, Math.round(255 * 0.55 * s * alb)))
  }
}

const levels = []
let level = 0
let size = fullSize
let buf = full
const layerBytes = []
let totalOrtho = 0
for (;;) {
  const tiles = Math.max(1, size / TILE)
  levels.push({ lod: level, size, tiles })
  const dir = path.join(out, 'ortho', String(level))
  fs.mkdirSync(dir, { recursive: true })
  for (let ty = 0; ty < tiles; ty++) {
    for (let tx = 0; tx < tiles; tx++) {
      const w = Math.min(TILE, size)
      const tileBuf = Buffer.alloc(w * w)
      for (let r = 0; r < w; r++) buf.copy(tileBuf, r * w, (ty * w + r) * size + tx * w, (ty * w + r) * size + tx * w + w)
      const img = await sharp(tileBuf, { raw: { width: w, height: w, channels: 1 } }).webp({ quality: 72 }).toBuffer()
      fs.writeFileSync(path.join(dir, `${tx}_${ty}.webp`), img)
      totalOrtho += img.length
      layerBytes.push(createHash('sha256').update(img).digest('hex'))
    }
  }
  if (size <= TILE) break
  const half = size / 2
  const next = Buffer.alloc(half * half)
  for (let r = 0; r < half; r++)
    for (let c = 0; c < half; c++)
      next[r * half + c] = (buf[2 * r * size + 2 * c] + buf[2 * r * size + 2 * c + 1] + buf[(2 * r + 1) * size + 2 * c] + buf[(2 * r + 1) * size + 2 * c + 1]) >> 2
  buf = next
  size = half
  level++
}

// ---- manifest ------------------------------------------------------------------------------
const sha = (b) => createHash('sha256').update(b).digest('hex')
const half = N / 2
const bbox = [-half, -half, half, half]
const synthSource = (title) => ({
  title,
  license: 'Synthetic (generated, not real Mars data)',
  attribution: 'MARS-X synthetic test dataset. Not real Mars data.',
  retrievedAt: new Date().toISOString(),
})
const dlat = (half / R) * (180 / Math.PI)
const dlon = (half / (R * Math.cos((CENTER.lat * Math.PI) / 180))) * (180 / Math.PI)
const manifest = {
  schemaVersion: '1.0.0',
  datasetId: 'synthetic',
  version: '0.0.0-synthetic',
  contentHash: sha(Buffer.from(sha(heightBytes) + layerBytes.join(''))),
  generatedAt: new Date().toISOString(),
  pipeline: { gitCommit: null, paramsHash: sha(Buffer.from('synthetic')), tools: { generator: 'scripts/make-synthetic-dataset.mjs' } },
  crs: {
    geographic: `+proj=longlat +R=${R} +no_defs +type=crs`,
    sourceProj4: `+proj=eqc +lat_ts=0 +lon_0=0 +R=${R} +units=m +no_defs +type=crs`,
    localProj4: `+proj=eqc +lat_ts=${CENTER.lat} +lon_0=${CENTER.lon} +x_0=0 +y_0=${(-R * (CENTER.lat * Math.PI)) / 180} +R=${R} +units=m +no_defs +type=crs`,
    localWkt2: 'SYNTHETIC',
    verticalDatum: 'synthetic',
    center: CENTER,
    localOrigin: 'window centre',
  },
  grid: { id: 'dem', width: N, height: N, resM: 1, transform: [1, 0, -half, 0, -1, half], bbox, pixelIs: 'area', northUp: true },
  grids: {
    dem: { id: 'dem', width: N, height: N, resM: 1, transform: [1, 0, -half, 0, -1, half], bbox, pixelIs: 'area', northUp: true },
    ortho: { id: 'ortho', width: ORTHO, height: ORTHO, resM: 0.25, transform: [0.25, 0, -half, 0, -0.25, half], bbox, pixelIs: 'area', northUp: true },
  },
  bboxLonLat: [CENTER.lon - dlon, CENTER.lat - dlat, CENTER.lon + dlon, CENTER.lat + dlat],
  layers: [
    {
      id: 'elevation',
      kind: 'elevation',
      gridId: 'dem',
      path: 'height.u16',
      sha256: sha(heightBytes),
      bytes: heightBytes.length,
      shape: [N, N],
      axes: 'yx',
      encoding: { dtype: 'uint16', endian: 'little', scale, offset: lo, nodata: 65535 },
      stats: { min: lo, max: hi, mean: null, validFraction: 1 },
      origin: 'simulated',
      source: synthSource('Synthetic terrain'),
    },
    {
      id: 'ortho',
      kind: 'orthoimage',
      gridId: 'ortho',
      path: 'ortho/',
      sha256: sha(Buffer.from(layerBytes.join(''))),
      bytes: totalOrtho,
      encoding: { dtype: 'image/webp', endian: 'n/a' },
      tiling: { tileSize: TILE, format: 'webp', levels, pathTemplate: 'ortho/{lod}/{x}_{y}.webp' },
      origin: 'simulated',
      source: synthSource('Synthetic orthoimage'),
    },
  ],
  extras: { note: 'Synthetic dataset for development. Not real Mars data.' },
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`synthetic dataset -> ${out}  (DEM ${N}^2, ortho ${ORTHO}^2, ${(totalOrtho / 1e6).toFixed(1)} MB tiles)`)
