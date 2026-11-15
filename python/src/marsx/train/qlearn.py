"""Tabular Q-learning on a cost grid (reference for the in-browser AI Lab; same rules as marsx.nav).

Real learning, fixed start and goal: the Q-table does not generalise to other goals (that is what PPO is for).
Lessons applied: half of the episodes start at the real start cell (rarely-visited starts keep optimistic
zero values and the greedy policy walks into a wall), rewards scaled by 1/10, gamma = 1 for episodic tasks.
"""

from __future__ import annotations

import math

import numpy as np
from numba import njit

_DR = np.array([-1, 1, 0, 0, -1, -1, 1, 1], np.int64)
_DC = np.array([0, 0, 1, -1, 1, -1, 1, -1], np.int64)
_D = np.array([1, 1, 1, 1, math.sqrt(2), math.sqrt(2), math.sqrt(2), math.sqrt(2)])


@njit(cache=True)
def _move(cost, r, c, a):
    nr, nc = r + _DR[a], c + _DC[a]
    H, W = cost.shape
    if nr < 0 or nc < 0 or nr >= H or nc >= W or not np.isfinite(cost[nr, nc]):
        return r, c, -1.0
    if _DR[a] != 0 and _DC[a] != 0 and (not np.isfinite(cost[r + _DR[a], c]) or not np.isfinite(cost[r, c + _DC[a]])):
        return r, c, -1.0
    return nr, nc, _D[a] * 0.5 * (cost[r, c] + cost[nr, nc])


@njit(cache=True)
def _train(cost, sr, sc, gr, gc, episodes, alpha, gamma, p_start, seed, eval_every):
    np.random.seed(seed)
    H, W = cost.shape
    q = np.zeros((H, W, 8))
    free_r, free_c = np.nonzero(np.isfinite(cost))
    eps = 1.0
    n_eval = episodes // eval_every
    curve = np.full(n_eval, np.inf)
    for ep in range(episodes):
        if np.random.random() < p_start:
            r, c = sr, sc
        else:
            k = np.random.randint(free_r.size)
            r, c = free_r[k], free_c[k]
        for _t in range(4 * (H + W)):
            if r == gr and c == gc:
                break
            if np.random.random() < eps:
                a = np.random.randint(8)
            else:
                a = np.argmax(q[r, c])
            nr, nc, sc_ = _move(cost, r, c, a)
            rew = -5.0 / 10.0 if sc_ < 0 else -sc_ / 10.0
            if nr == gr and nc == gc:
                rew += 10.0
                target = rew
            else:
                target = rew + gamma * q[nr, nc].max()
            q[r, c, a] += alpha * (target - q[r, c, a])
            r, c = nr, nc
        eps = max(0.05, eps * 0.9995)
        if (ep + 1) % eval_every == 0:
            curve[(ep + 1) // eval_every - 1] = _greedy(q, cost, sr, sc, gr, gc)
    return q, curve


@njit(cache=True)
def _greedy(q, cost, sr, sc, gr, gc):
    H, W = cost.shape
    seen = np.zeros((H, W), np.bool_)
    r, c, total = sr, sc, 0.0
    for _t in range(H * W):
        if r == gr and c == gc:
            return total
        if seen[r, c]:
            return np.inf
        seen[r, c] = True
        a = np.argmax(q[r, c])
        nr, nc, s = _move(cost, r, c, a)
        if s < 0:
            return np.inf
        total += s
        r, c = nr, nc
    return np.inf


def train(cost: np.ndarray, start, goal, episodes: int = 20000, alpha: float = 0.2, gamma: float = 1.0,
          p_start: float = 0.5, seed: int = 0, eval_every: int = 500):
    """Returns (Q[H, W, 8], curve of greedy path cost every ``eval_every`` episodes; inf = does not reach)."""
    c = np.ascontiguousarray(cost, dtype=np.float64)
    return _train(c, int(start[0]), int(start[1]), int(goal[0]), int(goal[1]), int(episodes), float(alpha),
                  float(gamma), float(p_start), int(seed), int(eval_every))


def greedy_cost(q: np.ndarray, cost: np.ndarray, start, goal) -> float:
    return float(_greedy(q, np.ascontiguousarray(cost, dtype=np.float64), int(start[0]), int(start[1]),
                         int(goal[0]), int(goal[1])))


def greedy_path(q: np.ndarray, cost: np.ndarray, start, goal) -> np.ndarray | None:
    """Cells (row, col) of the greedy policy from start to goal, or None if it loops / hits a wall / never arrives."""
    c = np.ascontiguousarray(cost, dtype=np.float64)
    r, col = int(start[0]), int(start[1])
    out, seen = [(r, col)], {(r, col)}
    for _ in range(c.size):
        if (r, col) == (int(goal[0]), int(goal[1])):
            return np.array(out, np.int64)
        a = int(np.argmax(q[r, col]))
        nr, nc, s = _move(c, r, col, a)
        if s < 0 or (nr, nc) in seen:
            return None
        r, col = int(nr), int(nc)
        out.append((r, col))
        seen.add((r, col))
    return None
