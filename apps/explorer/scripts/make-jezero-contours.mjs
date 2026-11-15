/**
 * One-off: isolines of the real Jezero DEM for the loading screen.
 *   node scripts/make-jezero-contours.mjs [path/to/height.u16]   (default: ../../data/processed/jezero-v1/height.u16)
 * Reads the 2048 x 2048 uint16 heights, averages them down to N x N, runs marching squares at a few levels and writes
 * src/ui/loading/jezero-contours.json: { size, levels: [ [ [x0,y0,x1,y1,...] ... ] ... ] } with integer coordinates 0..1000.
 * The file is small (< 30 KB) and ships with the app; the DEM itself is not needed at run time.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const src = process.argv[2] ?? path.resolve(here, '../../../data/processed/jezero-v1/height.u16')
const out = path.resolve(here, '../src/ui/loading/jezero-contours.json')
const W = 2048
const N = 128
const LEVELS = 8

const buf = fs.readFileSync(src)
const h16 = new Uint16Array(buf.buffer, buf.byteOffset, buf.byteLength / 2)
const block = W / N
const g = new Float64Array(N * N)
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) {
    let s = 0
    for (let y = 0; y < block; y++) for (let x = 0; x < block; x++) s += h16[(j * block + y) * W + i * block + x]
    g[j * N + i] = s / (block * block)
  }
const sorted = [...g].sort((a, b) => a - b)
const q = (p) => sorted[Math.floor(p * (sorted.length - 1))]
const levels = Array.from({ length: LEVELS }, (_, k) => q(0.06 + (0.88 * k) / (LEVELS - 1)))

const P = 1000 / (N - 1)
const key = (x, y) => `${Math.round(x * 4)},${Math.round(y * 4)}`
const result = []
for (const L of levels) {
  const segs = []
  const lerp = (a, b, va, vb) => (L - va) / (vb - va || 1e-9) * (b - a) + a
  for (let j = 0; j < N - 1; j++)
    for (let i = 0; i < N - 1; i++) {
      const v = [g[j * N + i], g[j * N + i + 1], g[(j + 1) * N + i + 1], g[(j + 1) * N + i]]
      let c = 0
      for (let k = 0; k < 4; k++) if (v[k] > L) c |= 1 << k
      if (c === 0 || c === 15) continue
      const pt = [
        [lerp(i, i + 1, v[0], v[1]), j],
        [i + 1, lerp(j, j + 1, v[1], v[2])],
        [lerp(i, i + 1, v[3], v[2]), j + 1],
        [i, lerp(j, j + 1, v[0], v[3])],
      ]
      const T = { 1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 0], [1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]], 9: [[0, 2]], 10: [[0, 1], [2, 3]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]] }[c]
      for (const [a, b] of T) segs.push([pt[a], pt[b]])
    }
  // chain segments into polylines
  const ends = new Map()
  segs.forEach((s, idx) => {
    for (const e of [0, 1]) {
      const k = key(...s[e])
      if (!ends.has(k)) ends.set(k, [])
      ends.get(k).push([idx, e])
    }
  })
  const used = new Array(segs.length).fill(false)
  const lines = []
  for (let s0 = 0; s0 < segs.length; s0++) {
    if (used[s0]) continue
    used[s0] = true
    let line = [segs[s0][0], segs[s0][1]]
    for (const dir of [1, 0]) {
      for (;;) {
        const tail = dir === 1 ? line[line.length - 1] : line[0]
        const next = (ends.get(key(...tail)) ?? []).find(([i]) => !used[i])
        if (!next) break
        used[next[0]] = true
        const [a, b] = segs[next[0]]
        const p = next[1] === 0 ? b : a
        if (dir === 1) line.push(p)
        else line.unshift(p)
      }
    }
    if (line.length >= 6) lines.push(line)
  }
  // thin out (every 2nd point) and quantise
  const flat = lines.map((l) => {
    const o = []
    for (let k = 0; k < l.length; k += 2) o.push(Math.round(l[k][0] * P), Math.round(l[k][1] * P))
    const last = l[l.length - 1]
    o.push(Math.round(last[0] * P), Math.round(last[1] * P))
    return o
  })
  result.push(flat)
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ size: 1000, levels: result }))
console.log(out, fs.statSync(out).size, 'bytes', result.map((l) => l.length).join(','))
