"""Shared constructor arguments for the single env, the vector env and the SB3 adapter."""

from __future__ import annotations

import os
from pathlib import Path

from marsx.contracts.scenario import Scenario
from marsx.env import scenarios
from marsx.env.terrain import Terrain, load_terrain, synthetic_terrain

DEFAULT_SCENARIO = "jezero-v1/l1/rtg-geometry"
SYNTHETIC_SIZE = 128


def resolve_scenario(scenario: str | Scenario | None) -> Scenario:
    if scenario is None:
        return scenarios.get(DEFAULT_SCENARIO)
    return scenarios.get(scenario) if isinstance(scenario, str) else scenario


def fit_window(scenario: Scenario, terrain: Terrain) -> Scenario:
    """Clip the scenario window to the terrain (synthetic maps are smaller than the 1024^2 Jezero grid)."""
    h, w = terrain.shape
    win = scenario.window
    if win.row0 + win.rows <= h and win.col0 + win.cols <= w:
        return scenario
    r0, c0 = min(win.row0, h - 1), min(win.col0, w - 1)
    new = win.model_copy(update={"row0": r0, "col0": c0, "rows": h - r0, "cols": w - c0})
    return scenario.model_copy(update={"window": new})


def resolve_terrain(terrain: str | Path | Terrain | None, seed: int = 0) -> Terrain:
    """``Terrain`` | "synthetic" | path to a processed dataset | None (env MARSX_DATA, then ./data/processed/jezero-v1)."""
    if isinstance(terrain, Terrain):
        return terrain
    if terrain == "synthetic":
        return synthetic_terrain(SYNTHETIC_SIZE, seed=seed)
    candidates = [terrain] if terrain is not None else [os.environ.get("MARSX_DATA"), "data/processed/jezero-v1",
                                                         "../data/processed/jezero-v1"]
    for c in candidates:
        if c and (Path(c) / "manifest.json").exists():
            return load_terrain(c)
    raise FileNotFoundError(
        "No processed Jezero dataset found. Set MARSX_DATA to the folder with manifest.json, "
        "pass terrain=<path>, or use terrain='synthetic' for a test map.")
