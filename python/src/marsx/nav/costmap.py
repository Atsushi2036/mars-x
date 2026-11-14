"""Slope -> traversal cost helper (shared by planner, baselines and env)."""
from __future__ import annotations

import numpy as np


def cost_from_slope(
    slope_deg, max_slope_deg: float, slope_weight: float = 4.0, blocked_mask=None
) -> np.ndarray:
    """cost = 1 + slope_weight * (slope / max)^2; inf above the limit or on nodata.

    ``max_slope_deg`` is per agent profile (rover: 24 deg, limit raised by NASA
    in Oct-2026, design-intelligence.md [F13]; astronaut: assumption).
    ``slope_weight`` is an ``assumption`` (cost range 1..1+weight, matching the
    obs/v1 normalisation).
    """
    s = np.asarray(slope_deg, dtype=np.float64)
    cost = 1.0 + slope_weight * (s / max_slope_deg) ** 2
    cost[~np.isfinite(s) | (s > max_slope_deg)] = np.inf
    if blocked_mask is not None:
        cost[np.asarray(blocked_mask, dtype=bool)] = np.inf
    return cost.astype(np.float32)


def path_to_actions(path) -> np.ndarray:
    """Convert a polyline of adjacent cells (row, col) to act/1 indices
    (N=0 S=1 E=2 W=3 NE=4 NW=5 SE=6 SW=7 WAIT=8; rows grow south).

    Raises ValueError if two consecutive points are not adjacent (smoothed
    paths must be re-densified before conversion).
    """
    from marsx.contracts.obs import ACTIONS

    lut = {(a.drow, a.dcol): a.index for a in ACTIONS}
    p = np.asarray(path, dtype=np.int64)
    out = []
    for a, b in zip(p[:-1], p[1:]):
        key = (int(b[0] - a[0]), int(b[1] - a[1]))
        if key not in lut:
            raise ValueError(f"non-adjacent step {key}")
        out.append(lut[key])
    return np.array(out, dtype=np.uint8)
