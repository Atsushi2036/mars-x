"""Grid navigation core: A*, Dijkstra cost-to-goal, line of sight, smoothing.

Specification shared with the TypeScript planner (parity contract, see
``packages/schemas/fixtures/nav/``). Everything here is deterministic.

Grid: 2-D array ``cost[row, col]``. A cell is *passable* iff its cost is finite
and > 0; ``inf``/``nan``/<=0 are blocked (obstacle, over the slope limit, nodata).
Moves: 8-connected. Step cost = distance * (cost[a] + cost[b]) / 2 with
distance 1 (cardinal) or sqrt(2) (diagonal). Diagonal moves are forbidden when
either of the two orthogonal neighbours is blocked (no corner cutting).

Heuristic: octile distance * min passable cost (admissible and consistent).
Tie-breaking in A*: lowest f; if |f1 - f2| <= 1e-9, highest g; then lowest flat
index (row * ncols + col). Neighbour expansion order (``NEIGHBORS``) is fixed:
N, E, S, W, NE, SE, SW, NW as (d_row, d_col). Relaxation uses strict ``<``.

Sources: Hart, Nilsson & Raphael 1968 (A*); Dijkstra 1959; octile heuristic for
8-connected grids (Harabor & Grastien 2011, "Online graph pruning for pathfinding
on grid maps").
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import IntEnum

import numpy as np
from numba import njit

NEIGHBORS = np.array(
    [(-1, 0), (0, 1), (1, 0), (0, -1), (-1, 1), (1, 1), (1, -1), (-1, -1)], dtype=np.int64
)
_SQRT2 = float(np.sqrt(2.0))
_EPS = 1e-9


class NavStatus(IntEnum):
    OK = 0
    NO_PATH = 1
    START_BLOCKED = 2
    GOAL_BLOCKED = 3
    OUT_OF_BOUNDS = 4
    MAX_STEPS = 5


@dataclass
class NavResult:
    status: NavStatus
    path: np.ndarray  # (n, 2) int32 of (row, col); empty if no path
    cost: float  # inf if no path
    expanded: int = 0
    replans: int = 0
    meta: dict = field(default_factory=dict)


def _empty(status: NavStatus, expanded: int = 0) -> NavResult:
    return NavResult(status, np.zeros((0, 2), np.int32), float("inf"), expanded)


# ----------------------------------------------------------------- heap ----
# Indexed binary heap with decrease-key. Order: (f asc, g desc, idx asc).
@njit(cache=True)
def _less(f, g, a, b):
    d = f[a] - f[b]
    if d < -_EPS:
        return True
    if d > _EPS:
        return False
    if g[a] != g[b]:
        return g[a] > g[b]
    return a < b


@njit(cache=True)
def _sift_up(heap, pos, f, g, i):
    node = heap[i]
    while i > 0:
        p = (i - 1) >> 1
        if _less(f, g, node, heap[p]):
            heap[i] = heap[p]
            pos[heap[i]] = i
            i = p
        else:
            break
    heap[i] = node
    pos[node] = i


@njit(cache=True)
def _sift_down(heap, pos, f, g, i, n):
    node = heap[i]
    while True:
        c = 2 * i + 1
        if c >= n:
            break
        if c + 1 < n and _less(f, g, heap[c + 1], heap[c]):
            c += 1
        if _less(f, g, heap[c], node):
            heap[i] = heap[c]
            pos[heap[i]] = i
            i = c
        else:
            break
    heap[i] = node
    pos[node] = i


@njit(cache=True)
def _passable(v):
    return np.isfinite(v) and v > 0.0


@njit(cache=True)
def _search(cost, sr, sc, gr, gc, use_h, stop_at_goal, hmin, nbrs):
    """Best-first search. Returns (g, parent, expanded). Costs as float64."""
    nr, nc = cost.shape
    n = nr * nc
    inf = np.inf
    g = np.full(n, inf)
    f = np.full(n, inf)
    parent = np.full(n, -1, np.int64)
    pos = np.full(n, -1, np.int64)  # -1 never queued, -2 closed, >=0 heap slot
    heap = np.empty(n, np.int64)
    s = sr * nc + sc
    g[s] = 0.0
    f[s] = 0.0
    if use_h:
        dr = abs(sr - gr)
        dc = abs(sc - gc)
        f[s] = hmin * ((dr + dc) + (_SQRT2 - 2.0) * min(dr, dc))
    heap[0] = s
    pos[s] = 0
    hn = 1
    expanded = 0
    goal = gr * nc + gc
    while hn > 0:
        u = heap[0]
        hn -= 1
        if hn > 0:
            heap[0] = heap[hn]
            pos[heap[0]] = 0
            _sift_down(heap, pos, f, g, 0, hn)
        pos[u] = -2
        expanded += 1
        if stop_at_goal and u == goal:
            break
        ur = u // nc
        uc = u - ur * nc
        cu = cost[ur, uc]
        for k in range(8):
            vr = ur + nbrs[k, 0]
            vc = uc + nbrs[k, 1]
            if vr < 0 or vr >= nr or vc < 0 or vc >= nc:
                continue
            cv = cost[vr, vc]
            if not _passable(cv):
                continue
            diag = nbrs[k, 0] != 0 and nbrs[k, 1] != 0
            if diag:
                if not _passable(cost[ur, vc]) or not _passable(cost[vr, uc]):
                    continue
            v = vr * nc + vc
            if pos[v] == -2:
                continue
            step = (_SQRT2 if diag else 1.0) * 0.5 * (cu + cv)
            ng = g[u] + step
            if ng < g[v]:
                g[v] = ng
                parent[v] = u
                h = 0.0
                if use_h:
                    dr = abs(vr - gr)
                    dc = abs(vc - gc)
                    h = hmin * ((dr + dc) + (_SQRT2 - 2.0) * min(dr, dc))
                f[v] = ng + h
                if pos[v] == -1:
                    heap[hn] = v
                    pos[v] = hn
                    hn += 1
                    _sift_up(heap, pos, f, g, hn - 1)
                else:
                    _sift_up(heap, pos, f, g, pos[v])
    return g, parent, expanded


def _prep(cost) -> np.ndarray:
    a = np.ascontiguousarray(cost, dtype=np.float64)
    if a.ndim != 2:
        raise ValueError("cost must be 2-D")
    return a


def _passable_py(v) -> bool:
    return bool(np.isfinite(v) and v > 0)


def _min_passable(c: np.ndarray) -> float:
    ok = np.isfinite(c) & (c > 0)
    return float(c[ok].min()) if ok.any() else 1.0


def _check(c: np.ndarray, start, goal) -> NavStatus | None:
    nr, nc = c.shape
    for r, k in (start, goal):
        if not (0 <= r < nr and 0 <= k < nc):
            return NavStatus.OUT_OF_BOUNDS
    if not _passable_py(c[start]):
        return NavStatus.START_BLOCKED
    if not _passable_py(c[goal]):
        return NavStatus.GOAL_BLOCKED
    return None


def astar(cost, start: tuple[int, int], goal: tuple[int, int]) -> NavResult:
    """Optimal 8-connected A* path from ``start`` to ``goal`` ((row, col))."""
    c = _prep(cost)
    start = (int(start[0]), int(start[1]))
    goal = (int(goal[0]), int(goal[1]))
    bad = _check(c, start, goal)
    if bad is not None:
        return _empty(bad)
    g, parent, expanded = _search(
        c, start[0], start[1], goal[0], goal[1], True, True, _min_passable(c), NEIGHBORS
    )
    nc = c.shape[1]
    t = goal[0] * nc + goal[1]
    if not np.isfinite(g[t]):
        return _empty(NavStatus.NO_PATH, int(expanded))
    total = float(g[t])
    out = []
    while t != -1:
        out.append((t // nc, t % nc))
        t = parent[t]
    path = np.array(out[::-1], dtype=np.int32)
    return NavResult(NavStatus.OK, path, total, int(expanded))


def dijkstra_cost_to_goal(cost, goal: tuple[int, int]) -> np.ndarray:
    """Cost-to-go field (float64, inf where unreachable or blocked)."""
    c = _prep(cost)
    goal = (int(goal[0]), int(goal[1]))
    nr, nc = c.shape
    if not (0 <= goal[0] < nr and 0 <= goal[1] < nc) or not _passable_py(c[goal]):
        return np.full(c.shape, np.inf)
    g, _, _ = _search(c, goal[0], goal[1], goal[0], goal[1], False, False, 1.0, NEIGHBORS)
    return g.reshape(c.shape)


# -------------------------------------------------- line of sight / smooth --
@njit(cache=True)
def _los(cost, r0, c0, r1, c1):
    """Supercover walk. Returns (visible, mean cost over visited cells).

    An exact corner crossing also visits the two side cells (no corner cutting).
    """
    dx = c1 - c0
    dy = r1 - r0
    nx = abs(dx)
    ny = abs(dy)
    sx = 1 if dx > 0 else -1
    sy = 1 if dy > 0 else -1
    r = r0
    c = c0
    total = 0.0
    cnt = 0
    if not _passable(cost[r, c]):
        return False, 0.0
    total += cost[r, c]
    cnt += 1
    ix = 0
    iy = 0
    while ix < nx or iy < ny:
        d = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx
        if d == 0:
            a = cost[r, c + sx]
            b = cost[r + sy, c]
            if not (_passable(a) and _passable(b)):
                return False, 0.0
            total += a + b
            cnt += 2
            c += sx
            r += sy
            ix += 1
            iy += 1
        elif d < 0:
            c += sx
            ix += 1
        else:
            r += sy
            iy += 1
        v = cost[r, c]
        if not _passable(v):
            return False, 0.0
        total += v
        cnt += 1
    return True, total / cnt


def line_of_sight(cost, a: tuple[int, int], b: tuple[int, int]) -> bool:
    c = _prep(cost)
    return bool(_los(c, int(a[0]), int(a[1]), int(b[0]), int(b[1]))[0])


def _seg_cost(c: np.ndarray, a, b) -> float:
    dr = abs(int(b[0]) - int(a[0]))
    dc = abs(int(b[1]) - int(a[1]))
    if dr <= 1 and dc <= 1:  # lattice edge: same formula as the search
        return (_SQRT2 if (dr and dc) else 1.0) * 0.5 * (c[tuple(a)] + c[tuple(b)])
    ok, mean = _los(c, int(a[0]), int(a[1]), int(b[0]), int(b[1]))
    return float(np.hypot(dr, dc) * mean) if ok else float("inf")


def path_cost(cost, path) -> float:
    """Cost of a polyline of grid points (lattice edges or straight segments)."""
    c = _prep(cost)
    p = np.asarray(path)
    return float(sum(_seg_cost(c, p[i], p[i + 1]) for i in range(len(p) - 1)))


def smooth_path(cost, path) -> np.ndarray:
    """Greedy string-pulling: keep the farthest visible waypoint whose straight
    segment is passable and not costlier than the original sub-path, so the
    total cost never increases."""
    c = _prep(cost)
    p = np.asarray(path, dtype=np.int32)
    if len(p) <= 2:
        return p.copy()
    cum = np.concatenate(
        [[0.0], np.cumsum([_seg_cost(c, p[i], p[i + 1]) for i in range(len(p) - 1)])]
    )
    out = [p[0]]
    i = 0
    n = len(p)
    while i < n - 1:
        j = n - 1
        while j > i + 1:
            if _seg_cost(c, p[i], p[j]) <= (cum[j] - cum[i]) + _EPS:
                break
            j -= 1
        out.append(p[j])
        i = j
    return np.array(out, dtype=np.int32)
