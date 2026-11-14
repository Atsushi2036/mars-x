"""Batch evaluation of a policy on NavBatch episodes, compared against the Dijkstra oracle (marsx.nav)."""

from __future__ import annotations

import math
from collections.abc import Callable

import numpy as np

from marsx.contracts import obs as spec
from marsx.env.core import NavBatch
from marsx.nav.core import dijkstra_cost_to_goal


def wilson95(k: int, n: int) -> tuple[float, float]:
    if n == 0:
        return 0.0, 1.0
    z, p = 1.959964, k / n
    den = 1 + z * z / n
    mid = (p + z * z / (2 * n)) / den
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / den
    return max(0.0, mid - half), min(1.0, mid + half)


def evaluate_policy(act: Callable[[np.ndarray], np.ndarray], engine: NavBatch, episodes: int, seed: int = 0) -> dict:
    """Run ``episodes`` random episodes (engine must have autoreset=False). Oracle = cost on the true map."""
    if engine.autoreset:
        raise ValueError("use an engine with autoreset=False")
    true_cost = np.where(engine.rocks, np.inf, engine.cost)
    engine.seed(seed)
    rows, done_total = [], 0
    while done_total < episodes:
        o = engine.reset()
        active = np.ones(engine.N, bool)
        while active.any():
            a = np.where(active, np.asarray(act(o)).reshape(-1), spec.WAIT)
            o, _, term, trunc, info = engine.step(a, active=active)
            ended = active & (term | trunc)
            for i in np.flatnonzero(ended):
                rows.append({"start": tuple(engine.start_cells()[i]), "goal": tuple(engine.goal_cells()[i]),
                             "outcome": info["outcome"][i], "cost": float(info["pathCost"][i]),
                             "pathM": float(info["pathM"][i]), "steps": int(info["steps"][i])})
            active &= ~ended
        done_total = len(rows)
    rows = rows[:episodes]
    ratios, spl = [], []
    for r in rows:
        opt = float(dijkstra_cost_to_goal(true_cost, r["goal"])[r["start"]])
        ok = r["outcome"] == "success"
        if ok and np.isfinite(opt) and opt > 0:
            ratios.append(r["cost"] / opt)
        spl.append(opt / max(opt, r["cost"]) if ok and np.isfinite(opt) and opt > 0 else 0.0)
    k = sum(r["outcome"] == "success" for r in rows)
    lo, hi = wilson95(k, len(rows))
    return {"n": len(rows), "success": k / len(rows), "successCi95": [lo, hi], "splCost": float(np.mean(spl)),
            "costRatios": ratios, "medianCostRatio": float(np.median(ratios)) if ratios else float("nan"),
            "outcomes": {o: sum(r["outcome"] == o for r in rows) for o in {r["outcome"] for r in rows}}}
