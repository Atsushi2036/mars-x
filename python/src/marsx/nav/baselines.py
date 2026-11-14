"""Navigation baselines for the benchmark (design-intelligence section 3).

- ``oracle_path``: optimal path on the true map (upper bound / SPL denominator).
- ``core.astar``: A* on the known map without replanning.
- ``astar_replan``: A* + replanning when the sensor reveals hidden obstacles.
- ``greedy_path``: myopic goal-seeking (gets stuck in local minima).
- ``random_walk_path``: uniform random valid moves (lower bound).
"""
from __future__ import annotations

import numpy as np

from .core import (
    _SQRT2,
    NEIGHBORS,
    NavResult,
    NavStatus,
    _empty,
    _passable_py,
    _prep,
    astar,
)


def oracle_path(true_cost, start, goal) -> NavResult:
    return astar(true_cost, start, goal)


def _valid_moves(c: np.ndarray, r: int, k: int):
    nr, nc = c.shape
    for dr, dc in NEIGHBORS:
        vr, vc = r + int(dr), k + int(dc)
        if not (0 <= vr < nr and 0 <= vc < nc) or not _passable_py(c[vr, vc]):
            continue
        if dr and dc and not (_passable_py(c[r, vc]) and _passable_py(c[vr, k])):
            continue
        yield vr, vc


def _walk_result(c, pts, status, **kw) -> NavResult:
    path = np.array(pts, dtype=np.int32).reshape(-1, 2)
    cost = 0.0
    for a, b in zip(pts[:-1], pts[1:]):
        diag = a[0] != b[0] and a[1] != b[1]
        cost += (_SQRT2 if diag else 1.0) * 0.5 * (c[a] + c[b])
    return NavResult(status, path, float(cost), **kw)


def _validate(c, start, goal):
    nr, nc = c.shape
    if not all(0 <= p[0] < nr and 0 <= p[1] < nc for p in (start, goal)):
        return NavStatus.OUT_OF_BOUNDS
    if not _passable_py(c[start]):
        return NavStatus.START_BLOCKED
    if not _passable_py(c[goal]):
        return NavStatus.GOAL_BLOCKED
    return None


def random_walk_path(cost, start, goal, max_steps: int = 1000, seed: int = 0) -> NavResult:
    c = _prep(cost)
    start, goal = tuple(map(int, start)), tuple(map(int, goal))
    bad = _validate(c, start, goal)
    if bad is not None:
        return _empty(bad)
    rng = np.random.default_rng(seed)
    pts = [start]
    cur = start
    while len(pts) <= max_steps and cur != goal:
        moves = list(_valid_moves(c, *cur))
        if not moves:
            return _walk_result(c, pts, NavStatus.NO_PATH)
        cur = moves[int(rng.integers(len(moves)))]
        pts.append(cur)
    return _walk_result(c, pts, NavStatus.OK if cur == goal else NavStatus.MAX_STEPS)


def greedy_path(cost, start, goal, max_steps: int = 1000) -> NavResult:
    """Step to the valid, unvisited neighbour that most reduces the Euclidean
    distance to the goal; stop (NO_PATH) at a local minimum."""
    c = _prep(cost)
    start, goal = tuple(map(int, start)), tuple(map(int, goal))
    bad = _validate(c, start, goal)
    if bad is not None:
        return _empty(bad)

    def dist(p):
        return float(np.hypot(p[0] - goal[0], p[1] - goal[1]))

    pts = [start]
    cur = start
    visited = {cur}
    while len(pts) <= max_steps and cur != goal:
        best = None
        for v in _valid_moves(c, *cur):
            if v in visited or dist(v) >= dist(cur) - 1e-12:
                continue
            if best is None or dist(v) < dist(best) - 1e-12:
                best = v
        if best is None:
            return _walk_result(c, pts, NavStatus.NO_PATH)
        cur = best
        visited.add(cur)
        pts.append(cur)
    return _walk_result(c, pts, NavStatus.OK if cur == goal else NavStatus.MAX_STEPS)


def astar_replan(
    true_cost,
    known_cost,
    start,
    goal,
    sensor_radius: float = 4.0,
    max_replans: int = 10_000,
) -> NavResult:
    """Follow A* on the known map. Before each step the sensor reveals the true
    cost of every cell within ``sensor_radius`` cells of the agent; if the next
    step is blocked the agent replans. ``cost`` of the result is on the true map.
    """
    t = _prep(true_cost)
    known = _prep(known_cost).copy()
    start, goal = tuple(map(int, start)), tuple(map(int, goal))
    bad = _validate(t, start, goal)
    if bad is not None:
        return _empty(bad)
    nr, nc = t.shape
    rad = max(1, int(np.ceil(sensor_radius)))  # always see the 8 neighbours
    rr, cc = np.mgrid[-rad : rad + 1, -rad : rad + 1]
    disc = np.hypot(rr, cc) <= max(sensor_radius, 1.5)

    def reveal(r: int, k: int) -> None:
        r0, r1 = max(0, r - rad), min(nr, r + rad + 1)
        c0, c1 = max(0, k - rad), min(nc, k + rad + 1)
        m = disc[r0 - r + rad : r1 - r + rad, c0 - k + rad : c1 - k + rad]
        known[r0:r1, c0:c1][m] = t[r0:r1, c0:c1][m]

    pts = [start]
    cur = start
    replans = 0
    expanded = 0
    reveal(*cur)
    plan = astar(known, cur, goal)
    expanded += plan.expanded
    while cur != goal:
        if plan.status != NavStatus.OK:
            return _walk_result(t, pts, NavStatus.NO_PATH, expanded=expanded, replans=replans)
        blocked = False
        for nxt in map(tuple, plan.path[1:]):
            reveal(*cur)
            if not _passable_py(known[nxt]):
                blocked = True
                break
            cur = nxt
            pts.append(cur)
        if not blocked:
            break
        replans += 1
        if replans > max_replans:
            return _walk_result(t, pts, NavStatus.MAX_STEPS, expanded=expanded, replans=replans)
        plan = astar(known, cur, goal)
        expanded += plan.expanded
    return _walk_result(t, pts, NavStatus.OK, expanded=expanded, replans=replans)
