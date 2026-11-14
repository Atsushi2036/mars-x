/**
 * 8-connected A* / Dijkstra over a per-cell cost grid (typed arrays + indexed binary heap with
 * decrease-key). Pure and framework-free: runs in a Worker, in Node (tests) and matches the Python
 * oracle `marsx.nav.core` (parity contract: packages/schemas/fixtures/nav/cases.json):
 *
 *  - passable iff cost is finite and > 0; step cost = (1 | sqrt 2) * (c[a] + c[b]) / 2
 *  - no corner cutting; heuristic = octile * min passable cost
 *  - tie-break: lowest f (|df| <= 1e-9), then highest g, then lowest flat index
 *  - neighbour order N, E, S, W, NE, SE, SW, NW; relaxation with strict `<`
 */

export type NoRouteCause = 'out-of-bounds' | 'start-blocked' | 'goal-blocked' | 'disconnected'

export type AStarResult =
  | { status: 'ok'; path: Uint32Array; cost: number; expanded: number }
  | {
      status: 'no-route'
      cause: NoRouteCause
      expanded: number
      /** cells reachable from the start (disconnected only) */
      startRegionCells?: number
      /** cells reachable from the goal (disconnected only) */
      goalRegionCells?: number
    }

const DR = new Int8Array([-1, 0, 1, 0, -1, 1, 1, -1])
const DC = new Int8Array([0, 1, 0, -1, 1, 1, -1, -1])
const SQ2 = Math.SQRT2
const EPS = 1e-9

const passable = (v: number) => Number.isFinite(v) && v > 0

interface Scratch {
  size: number
  g: Float64Array
  f: Float64Array
  parent: Int32Array
  /** -1 never queued, -2 closed, >= 0 heap slot */
  pos: Int32Array
  heap: Int32Array
}
let scratch: Scratch | null = null
function getScratch(size: number): Scratch {
  if (!scratch || scratch.size !== size) {
    scratch = {
      size,
      g: new Float64Array(size),
      f: new Float64Array(size),
      parent: new Int32Array(size),
      pos: new Int32Array(size),
      heap: new Int32Array(size),
    }
  }
  return scratch
}

/** Best-first search into the shared scratch. Returns the expanded count. */
function search(
  cost: Float32Array,
  nr: number,
  nc: number,
  s: number,
  goal: number,
  useH: boolean,
  stopAtGoal: boolean,
  hmin: number,
): number {
  const sc = getScratch(nr * nc)
  const { g, f, parent, pos, heap } = sc
  g.fill(Infinity)
  f.fill(Infinity)
  parent.fill(-1)
  pos.fill(-1)
  const gr = (goal / nc) | 0
  const gc = goal - gr * nc

  const less = (a: number, b: number) => {
    const d = f[a]! - f[b]!
    if (d < -EPS) return true
    if (d > EPS) return false
    if (g[a] !== g[b]) return g[a]! > g[b]!
    return a < b
  }
  const up = (i: number) => {
    const node = heap[i]!
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(node, heap[p]!)) {
        heap[i] = heap[p]!
        pos[heap[i]!] = i
        i = p
      } else break
    }
    heap[i] = node
    pos[node] = i
  }
  const down = (i: number, n: number) => {
    const node = heap[i]!
    for (;;) {
      let c = 2 * i + 1
      if (c >= n) break
      if (c + 1 < n && less(heap[c + 1]!, heap[c]!)) c++
      if (less(heap[c]!, node)) {
        heap[i] = heap[c]!
        pos[heap[i]!] = i
        i = c
      } else break
    }
    heap[i] = node
    pos[node] = i
  }

  const sr = (s / nc) | 0
  const scol = s - sr * nc
  const dr0 = Math.abs(sr - gr)
  const dc0 = Math.abs(scol - gc)
  g[s] = 0
  f[s] = useH ? hmin * (dr0 + dc0 + (SQ2 - 2) * Math.min(dr0, dc0)) : 0
  heap[0] = s
  pos[s] = 0
  let hn = 1
  let expanded = 0
  while (hn > 0) {
    const u = heap[0]!
    hn--
    if (hn > 0) {
      heap[0] = heap[hn]!
      pos[heap[0]!] = 0
      down(0, hn)
    }
    pos[u] = -2
    expanded++
    if (stopAtGoal && u === goal) break
    const ur = (u / nc) | 0
    const uc = u - ur * nc
    const cu = cost[u]!
    for (let k = 0; k < 8; k++) {
      const vr = ur + DR[k]!
      const vc = uc + DC[k]!
      if (vr < 0 || vr >= nr || vc < 0 || vc >= nc) continue
      const v = vr * nc + vc
      const cv = cost[v]!
      if (!passable(cv)) continue
      const diag = k >= 4
      if (diag && (!passable(cost[ur * nc + vc]!) || !passable(cost[vr * nc + uc]!))) continue
      if (pos[v] === -2) continue
      const ng = g[u]! + (diag ? SQ2 : 1) * 0.5 * (cu + cv)
      if (ng < g[v]!) {
        g[v] = ng
        parent[v] = u
        let h = 0
        if (useH) {
          const dr = vr > gr ? vr - gr : gr - vr
          const dc = vc > gc ? vc - gc : gc - vc
          h = hmin * (dr + dc + (SQ2 - 2) * (dr < dc ? dr : dc))
        }
        f[v] = ng + h
        if (pos[v] === -1) {
          heap[hn] = v
          pos[v] = hn
          hn++
          up(hn - 1)
        } else up(pos[v]!)
      }
    }
  }
  return expanded
}

/** Flood fill (8-connected, no corner cutting) region size around `from`; `from` must be free. */
function regionSize(cost: Float32Array, nr: number, nc: number, from: number): number {
  const seen = new Uint8Array(nr * nc)
  const stack = new Int32Array(nr * nc)
  let sp = 0
  stack[sp++] = from
  seen[from] = 1
  let count = 0
  while (sp > 0) {
    const u = stack[--sp]!
    count++
    const ur = (u / nc) | 0
    const uc = u - ur * nc
    for (let k = 0; k < 8; k++) {
      const vr = ur + DR[k]!
      const vc = uc + DC[k]!
      if (vr < 0 || vr >= nr || vc < 0 || vc >= nc) continue
      const v = vr * nc + vc
      if (seen[v] || !passable(cost[v]!)) continue
      if (k >= 4 && (!passable(cost[ur * nc + vc]!) || !passable(cost[vr * nc + uc]!))) continue
      seen[v] = 1
      stack[sp++] = v
    }
  }
  return count
}

function minPassable(cost: Float32Array): number {
  let m = Infinity
  for (let i = 0; i < cost.length; i++) {
    const v = cost[i]!
    if (v > 0 && v < m) m = v
  }
  return Number.isFinite(m) ? m : 1
}

/** Optimal A* between flat cell indices (row * nc + col). Square grids: nr = nc = n. */
export function astar(cost: Float32Array, nr: number, nc: number, start: number, goal: number): AStarResult {
  const N = nr * nc
  if (!Number.isInteger(start) || !Number.isInteger(goal) || start < 0 || start >= N || goal < 0 || goal >= N) {
    return { status: 'no-route', cause: 'out-of-bounds', expanded: 0 }
  }
  if (!passable(cost[start]!)) return { status: 'no-route', cause: 'start-blocked', expanded: 0 }
  if (!passable(cost[goal]!)) return { status: 'no-route', cause: 'goal-blocked', expanded: 0 }
  const expanded = search(cost, nr, nc, start, goal, true, true, minPassable(cost))
  const { g, parent } = scratch!
  if (g[goal] === Infinity) {
    return {
      status: 'no-route',
      cause: 'disconnected',
      expanded,
      startRegionCells: regionSize(cost, nr, nc, start),
      goalRegionCells: regionSize(cost, nr, nc, goal),
    }
  }
  let len = 0
  for (let v = goal; v !== -1; v = parent[v]!) len++
  const path = new Uint32Array(len)
  for (let v = goal, i = len - 1; v !== -1; v = parent[v]!, i--) path[i] = v
  return { status: 'ok', path, cost: g[goal]!, expanded }
}

/** Cost-to-go field to `goal` (Infinity where unreachable or blocked): the lab's value-map overlay. */
export function dijkstraCostToGoal(cost: Float32Array, nr: number, nc: number, goal: number): Float64Array {
  if (!Number.isInteger(goal) || goal < 0 || goal >= nr * nc || !passable(cost[goal]!)) {
    return new Float64Array(nr * nc).fill(Infinity)
  }
  search(cost, nr, nc, goal, goal, false, false, 1)
  return scratch!.g.slice(0, nr * nc)
}

/**
 * Minimum slope limit (deg) that would connect start and goal: minimax path over the slope layer
 * (cells with non-finite slope are impassable). Used to explain "no route" ("needs >= 27.3 deg").
 * Returns Infinity when even an unlimited slope cannot connect them.
 */
export function bottleneckSlope(slope: Float32Array, nr: number, nc: number, start: number, goal: number): number {
  const N = nr * nc
  const ok = (i: number) => Number.isFinite(slope[i]!)
  if (!(start >= 0 && start < N && goal >= 0 && goal < N) || !ok(start) || !ok(goal)) return Infinity
  const best = new Float64Array(N).fill(Infinity)
  const hk: number[] = []
  const hv: number[] = []
  const push = (k: number, v: number) => {
    let i = hk.length
    hk.push(k)
    hv.push(v)
    while (i > 0) {
      const p = (i - 1) >> 1
      if (hk[p]! <= k) break
      hk[i] = hk[p]!
      hv[i] = hv[p]!
      i = p
    }
    hk[i] = k
    hv[i] = v
  }
  const pop = (): [number, number] => {
    const rk = hk[0]!
    const rv = hv[0]!
    const lk = hk.pop()!
    const lv = hv.pop()!
    const n = hk.length
    if (n > 0) {
      let i = 0
      for (;;) {
        let c = 2 * i + 1
        if (c >= n) break
        if (c + 1 < n && hk[c + 1]! < hk[c]!) c++
        if (hk[c]! >= lk) break
        hk[i] = hk[c]!
        hv[i] = hv[c]!
        i = c
      }
      hk[i] = lk
      hv[i] = lv
    }
    return [rk, rv]
  }
  best[start] = slope[start]!
  push(best[start]!, start)
  while (hk.length > 0) {
    const [k, u] = pop()
    if (k > best[u]!) continue
    if (u === goal) return k
    const ur = (u / nc) | 0
    const uc = u - ur * nc
    for (let d = 0; d < 8; d++) {
      const vr = ur + DR[d]!
      const vc = uc + DC[d]!
      if (vr < 0 || vr >= nr || vc < 0 || vc >= nc) continue
      const v = vr * nc + vc
      if (!ok(v)) continue
      if (d >= 4 && (!ok(ur * nc + vc) || !ok(vr * nc + uc))) continue
      const b = Math.max(k, slope[v]!)
      if (b < best[v]!) {
        best[v] = b
        push(b, v)
      }
    }
  }
  return Infinity
}
