/** Procedural Mars surface for the loading globe: seamless (wraps in x) value-noise fbm painted once on a small 2D canvas. */

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2246822519) | 0
  h = (h ^ (h >>> 13)) * 1274126177
  h ^= h >>> 16
  return (h >>> 0) / 4294967295
}

const smooth = (t: number) => t * t * (3 - 2 * t)

function vnoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = smooth(x - xi)
  const fy = smooth(y - yi)
  const x0 = ((xi % period) + period) % period
  const x1 = (x0 + 1) % period
  const a = hash(x0, yi, seed)
  const b = hash(x1, yi, seed)
  const c = hash(x0, yi + 1, seed)
  const d = hash(x1, yi + 1, seed)
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy
}

/** fbm in 0..1; `u` wraps around, `v` is the latitude. */
export function fbm(u: number, v: number, seed = 7): number {
  let sum = 0
  let amp = 0.5
  let norm = 0
  let freq = 3
  for (let o = 0; o < 5; o++) {
    sum += amp * vnoise(u * freq, v * freq * 0.5, freq, seed + o * 17)
    norm += amp
    amp *= 0.5
    freq *= 2
  }
  return sum / norm
}

const PALETTE: [number, [number, number, number]][] = [
  [0, [74, 24, 10]],
  [0.32, [128, 44, 16]],
  [0.58, [190, 78, 30]],
  [0.82, [226, 132, 74]],
  [1, [240, 176, 118]],
]

function ramp(t: number): [number, number, number] {
  for (let i = 1; i < PALETTE.length; i++) {
    const [t1, c1] = PALETTE[i]!
    if (t <= t1) {
      const [t0, c0] = PALETTE[i - 1]!
      const k = (t - t0) / (t1 - t0 || 1)
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k]
    }
  }
  return PALETTE[PALETTE.length - 1]![1]
}

/** Paints the surface into a canvas and returns a data URL (null when 2D canvas is unavailable). */
export function marsTexture(w = 512, h = 256): string | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  if (!g) return null
  const img = g.createImageData(w, h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = x / w
      const v = y / h
      // broad dark plains (low frequency) over the fine detail
      const plains = fbm(u, v, 31)
      let t = fbm(u, v, 7) * 0.85 + 0.1
      t -= Math.max(0, 0.5 - plains) * 0.7
      const [r, gr, b] = ramp(Math.min(1, Math.max(0, t)))
      const edge = Math.max(0, Math.abs(v - 0.5) * 2 - 0.9) / 0.1 // pale caps, fading in smoothly
      const polar = edge * edge * (3 - 2 * edge) * 0.5
      const i = (y * w + x) * 4
      img.data[i] = r + (236 - r) * polar
      img.data[i + 1] = gr + (216 - gr) * polar
      img.data[i + 2] = b + (200 - b) * polar
      img.data[i + 3] = 255
    }
  }
  g.putImageData(img, 0, 0)
  return canvas.toDataURL('image/png')
}
