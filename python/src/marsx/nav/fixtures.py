"""Golden nav cases exported for the TypeScript planner (parity).

Run ``python -m marsx.nav.fixtures`` to regenerate
``packages/schemas/fixtures/nav/cases.json``. ``cost`` is row-major, ``null`` =
blocked. Expected ``path`` is exact (tie-break rules in ``marsx.nav.core``);
``cost`` and ``costToGoal`` compare with tolerance 1e-9. Statuses are the
lower-cased ``NavStatus`` names.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .core import NavStatus, astar, dijkstra_cost_to_goal
from .costmap import cost_from_slope

INF = np.inf


def _flat(n: int, m: int | None = None) -> np.ndarray:
    return np.ones((n, m or n), np.float32)


def _grids() -> list[tuple[str, np.ndarray, tuple, tuple]]:
    out: list[tuple[str, np.ndarray, tuple, tuple]] = []
    out.append(("flat", _flat(8), (0, 0), (7, 7)))
    out.append(("start_equals_goal", _flat(5), (2, 2), (2, 2)))
    g = _flat(7)
    g[:, 3] = INF
    g[6, 3] = 1.0
    out.append(("wall_gap", g.copy(), (0, 0), (0, 6)))
    g[6, 3] = INF
    out.append(("full_wall_no_path", g.copy(), (0, 0), (0, 6)))
    slope = np.zeros((9, 9), np.float32)
    slope[:, 4] = 30.0
    out.append(("ramp_over_limit_no_path", cost_from_slope(slope, 25.0), (4, 0), (4, 8)))
    slope[:, 4] = 20.0
    out.append(("ramp_under_limit", cost_from_slope(slope, 25.0), (4, 0), (4, 8)))
    s = _flat(8)
    s[0, 0] = INF
    out.append(("start_in_obstacle", s, (0, 0), (5, 5)))
    t = _flat(8)
    t[5, 5] = INF
    out.append(("goal_in_obstacle", t, (0, 0), (5, 5)))
    out.append(("out_of_bounds", _flat(8), (0, 0), (8, 0)))
    c = _flat(3)
    c[0, 1] = INF
    c[1, 0] = INF
    out.append(("no_corner_cutting", c, (0, 0), (1, 1)))
    out.append(("tie_2x3", _flat(2, 3), (0, 0), (1, 2)))
    out.append(("tie_open_5x5", _flat(5), (0, 0), (4, 2)))
    w = _flat(5)
    w[2, :] = 50.0
    w[2, 4] = 1.0
    out.append(("weighted_gap", w, (0, 0), (4, 0)))
    rng = np.random.default_rng(2026)
    for i in range(3):
        r = (1 + rng.integers(0, 33, size=(20, 20)) / 8).astype(np.float32)  # exact in float32
        r[rng.random(r.shape) < 0.25] = INF
        r[0, 0] = r[19, 19] = 1.0
        out.append((f"random_20x20_{i}", r, (0, 0), (19, 19)))
    return out


def build_cases() -> dict:
    cases = []
    for name, grid, start, goal in _grids():
        res = astar(grid, start, goal)
        exp: dict = {"status": NavStatus(res.status).name.lower()}
        if res.status == NavStatus.OK:
            exp["path"] = res.path.tolist()
            exp["cost"] = res.cost
        h, w = grid.shape
        if name.startswith(("flat", "wall_gap", "weighted", "random", "full_wall")):
            d = dijkstra_cost_to_goal(grid, goal).ravel()
            exp["costToGoal"] = [None if not np.isfinite(v) else float(v) for v in d]
        cases.append(
            {
                "name": name,
                "rows": h,
                "cols": w,
                "cost": [None if not np.isfinite(v) else float(v) for v in grid.ravel()],
                "start": list(start),
                "goal": list(goal),
                "expected": exp,
            }
        )
    return {
        "specVersion": "nav/1",
        "convention": "cost[row*cols+col]; null=blocked; 8-connected; no corner cutting; "
        "step=dist*(ca+cb)/2; h=octile*minCost; ties: f asc (eps 1e-9), g desc, index asc; "
        "neighbours N,E,S,W,NE,SE,SW,NW",
        "cases": cases,
    }


def main() -> None:
    dest = Path(__file__).resolve().parents[4] / "packages" / "schemas" / "fixtures" / "nav" / "cases.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(build_cases(), indent=1) + "\n", encoding="utf-8")
    print(dest)


if __name__ == "__main__":
    main()
