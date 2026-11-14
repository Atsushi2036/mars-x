export * from './search'

// ---------------------------------------------------------------- cost layers

export interface CostLayers {
  /** degrees; non-finite marks "no estimate" */
  slope: Float32Array
  /** metres, |h - mean3x3| */
  rough: Float32Array
}

export interface CostWeights {
  /** cost = 1 + ws * (slope / maxSlope)^2 + wr * rough (wr = 0 reproduces python marsx.nav.costmap.cost_from_slope) */
  ws: number
  wr: number
  /** cells steeper than this (deg) are blocked */
  maxSlope: number
}

/** Slope (central differences) and roughness from a height grid. `resM` = metres per cell. */
export function costLayers(h: Float32Array, n: number, resM = 1): CostLayers {
  const slope = new Float32Array(n * n)
  const rough = new Float32Array(n * n)
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x
      const dx = (h[i + 1]! - h[i - 1]!) / (2 * resM)
      const dy = (h[i + n]! - h[i - n]!) / (2 * resM)
      slope[i] = Math.atan(Math.hypot(dx, dy)) * 57.29578
      let m = 0
      for (let yy = -1; yy <= 1; yy++) for (let xx = -1; xx <= 1; xx++) m += h[i + yy * n + xx]!
      rough[i] = Math.abs(h[i]! - m / 9)
    }
  }
  return { slope, rough }
}

/** Live re-weighting (lab sliders). The 1-cell border has no valid slope and is a no-go margin. */
export function combineCost(L: CostLayers, n: number, w: CostWeights, out: Float32Array): Float32Array {
  const N = n * n
  for (let i = 0; i < N; i++) {
    const s = L.slope[i]!
    out[i] = s > w.maxSlope || !Number.isFinite(s) ? Infinity : 1 + w.ws * (s / w.maxSlope) ** 2 + w.wr * L.rough[i]!
  }
  for (let k = 0; k < n; k++) {
    out[k] = Infinity
    out[(n - 1) * n + k] = Infinity
    out[k * n] = Infinity
    out[k * n + n - 1] = Infinity
  }
  return out
}

/** Deterministic synthetic terrain (sines + LCG noise) for tests and benchmarks. */
export function makeSyntheticTerrain(n: number, seed = 42): Float32Array {
  const h = new Float32Array(n * n)
  let s = seed >>> 0
  const rnd = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  const comps = Array.from({ length: 6 }, (_, k) => ({
    a: 6 / (k + 1),
    fx: (rnd() + 0.2) * 0.02 * (k + 1),
    fy: (rnd() + 0.2) * 0.02 * (k + 1),
    p: rnd() * 6.28,
  }))
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let v = 0
      for (const c of comps) v += c.a * Math.sin(c.fx * x + c.fy * y + c.p)
      h[y * n + x] = v + rnd() * 0.15
    }
  }
  return h
}
