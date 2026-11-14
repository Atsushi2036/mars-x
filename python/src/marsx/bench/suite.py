"""Benchmark suite jezero-v1: scenario families, train/test regions and pre-generated episodes.

Composition (T5, PO v0.1):
- L1 Nominal navigation: 600 episodes, terrain only.
- L2 Under Mars conditions: 4 families x 200 (RTG, solar clear, solar dusty, astronaut with SPE rule).
- L3 Consistent across sols & seeds: 6 families (profile x sol) x 100, with hidden rocks and one plan
  per sol; the pass rule is evaluated per family (Wilson 95 % lower bound, n >= 20).

Train/test split by region: the test region is the north-east quadrant of the planning window,
the train region the rest, separated by a guard band. Official (test) episodes have start, goal and
the oracle path inside the test region; the reference policies are trained only on the train region.
Episodes are generated with an oracle (A*) that guarantees feasibility within the step budget.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

import numpy as np

from marsx.contracts.canonical import sha256_bytes, sha256_json
from marsx.contracts.scenario import (
    NASA_BLOG_2026,
    NASA_ROVER,
    Agent,
    CommSpec,
    Conditions,
    Param,
    RockSpec,
    Scenario,
    SpeSpec,
    Window,
)
from marsx.contracts.suite import EpisodeSpec, LevelSpec, Suite
from marsx.nav import NavStatus, astar

SUITE_ID = "jezero-v1"
SUITE_VERSION = "0.1.0"
ROOT_SEED = 20261115
DISTANCE_BANDS_M: tuple[tuple[float, float], ...] = ((50.0, 150.0), (150.0, 400.0), (400.0, 1000.0))
ORACLE_STEP_FRACTION = 0.8  # oracle path must use <= 80 % of the scenario step budget
_LEMMON = "Lemmon et al. 2022, GRL 49(17) e2022GL100126, doi:10.1029/2022GL100126"

# ------------------------------------------------------------------ scenarios
_ROVER_LIMITS = dict(
    max_slope_deg=Param(value=24, unit="deg", provenance="source", ref=NASA_BLOG_2026,
                        note="Perseverance tilt limit raised to 24 deg (Oct 2026)"),
    max_step_m=Param(value=0.525, unit="m", provenance="source", ref=NASA_ROVER, note="wheel diameter"),
    speed_m_s=Param(value=0.042, unit="m/s", provenance="source", ref=NASA_ROVER, note="152 m/h top speed"),
)
_AGENTS = {
    "rtg": Agent(kind="rtg_rover", **_ROVER_LIMITS),
    "solar": Agent(kind="solar_rover", **_ROVER_LIMITS),
    "astronaut": Agent(
        kind="astronaut",
        max_slope_deg=Param(value=15, unit="deg", provenance="assumption", note="PO decision v0.1"),
        max_step_m=Param(value=0.3, unit="m", provenance="assumption"),
        speed_m_s=Param(value=1.0, unit="m/s", provenance="assumption"),
        params={"evaDuration": Param(value=4, unit="h", provenance="assumption", note="PO decision v0.1")},
    ),
}
_SOLS = {
    # Clear: aphelion-season sol with the lowest tau in MEDA, chosen by the data team (tau is an assumption
    # until that sol is pinned). Dusty: regional storm that entered Jezero at the end of sol 313 (Lemmon 2022).
    "clear": dict(meda_sols=[], tau=Param(value=0.4, unit="-", provenance="assumption",
                                          note="clear-season opacity until the MEDA sol is pinned")),
    "dusty": dict(meda_sols=[314], tau=Param(value=2.0, unit="-", provenance="source", ref=_LEMMON,
                                             note="peak visible optical depth of the Jan 2022 regional storm")),
}
_WINDOW = Window(dataset_id="jezero-v1", grid_id="plan", row0=0, col0=0, rows=1024, cols=1024)
_ROCKS = RockSpec(
    enabled=True,
    abundance_k=Param(value=0.05, unit="fraction", provenance="assumption",
                      note="Golombek & Rapp 1997 model, k range 1-10 % at landing sites"),
    sensor_radius_m=Param(value=8, unit="m", provenance="assumption"),
)


def _make(level: str, name: str, profile: str, sol: str | None, *, hidden: bool, spe: bool,
          one_plan: bool, max_steps: int, title: str) -> Scenario:
    sol_kw = _SOLS[sol] if sol else {}
    physics = level != "L1"
    cond = Conditions(
        **sol_kw,
        comm=CommSpec(mode="one_plan_per_sol", uplink_lmst_h=9.0) if one_plan else CommSpec(),
        spe=SpeSpec(enabled=spe),
        hidden_rocks=_ROCKS if hidden else RockSpec(),
        lighting=physics, energy=physics, slip=physics and profile != "astronaut",
    )
    return Scenario(id=f"jezero-v1/{level.lower()}/{name}", title=title, level=level, window=_WINDOW,
                    agent=_AGENTS[profile], conditions=cond, max_steps=max_steps)


def _scenarios() -> dict[str, Scenario]:
    out = [_make("L1", "rtg-geometry", "rtg", None, hidden=False, spe=False, one_plan=False, max_steps=600,
                 title="L1 nominal navigation - RTG rover")]
    l2 = [("rtg-clear", "rtg", "clear", False), ("solar-clear", "solar", "clear", False),
          ("solar-dusty", "solar", "dusty", False), ("astronaut-spe", "astronaut", "clear", True)]
    for name, prof, sol, spe in l2:
        out.append(_make("L2", name, prof, sol, hidden=False, spe=spe, one_plan=False, max_steps=1500,
                         title=f"L2 under Mars conditions - {name}"))
    for prof in ("rtg", "solar", "astronaut"):
        for sol in ("clear", "dusty"):
            out.append(_make("L3", f"{prof}-{sol}", prof, sol, hidden=True, spe=prof == "astronaut",
                             one_plan=prof != "astronaut", max_steps=1500,
                             title=f"L3 consistency - {prof}, {sol} sol, hidden rocks"))
    return {s.id: s for s in out}


SCENARIOS = _scenarios()

LEVEL_PLAN: dict[str, list[tuple[str, int]]] = {
    "L1": [("jezero-v1/l1/rtg-geometry", 600)],
    "L2": [(f"jezero-v1/l2/{n}", 200) for n in ("rtg-clear", "solar-clear", "solar-dusty", "astronaut-spe")],
    "L3": [(f"jezero-v1/l3/{p}-{s}", 100) for p in ("rtg", "solar", "astronaut") for s in ("clear", "dusty")],
}


def scenario(scenario_id: str) -> Scenario:
    try:
        return SCENARIOS[scenario_id]
    except KeyError:
        raise KeyError(f"unknown suite scenario {scenario_id!r}") from None


def scenario_sha256(scenario_id: str) -> str:
    return sha256_json(scenario(scenario_id).model_dump(by_alias=True, mode="json"))


# ------------------------------------------------------------------ regions
def _guard(shape: tuple[int, int]) -> int:
    return max(2, shape[0] // 64)


def region_mask(shape: tuple[int, int], split: str) -> np.ndarray:
    h, w = shape
    g = _guard(shape)
    r, c = np.mgrid[0:h, 0:w]
    if split == "test":
        return (r < h // 2 - g) & (c >= w // 2 + g)
    if split == "train":
        return (r >= h // 2 + g) | (c < w // 2 - g)
    raise ValueError(f"unknown split {split!r}")


# ------------------------------------------------------------------ episodes
def _path_m(path: np.ndarray, res_m: float) -> float:
    d = np.abs(np.diff(path.astype(np.int64), axis=0))
    diag = (d[:, 0] == 1) & (d[:, 1] == 1)
    return float(res_m * (np.count_nonzero(~diag) + np.sqrt(2.0) * np.count_nonzero(diag)))


def generate_episodes(
    cost: np.ndarray,
    scenario_id: str,
    n: int,
    seed: int,
    split: str = "test",
    res_m: float = 2.0,
    bands_m: Sequence[tuple[float, float]] = DISTANCE_BANDS_M,
    max_oracle_steps: int | None = None,
    max_attempts: int = 400,
) -> list[EpisodeSpec]:
    """Episodes cycle through the distance bands; each one is feasible for the oracle inside the region."""
    mask = region_mask(cost.shape, split)
    c = np.where(mask, cost, np.inf).astype(np.float32)
    free = np.argwhere(np.isfinite(c) & (c > 0))
    if free.size == 0:
        raise ValueError("no passable cell in region")
    limit = max_oracle_steps or int(ORACLE_STEP_FRACTION * scenario(scenario_id).max_steps)
    rng = np.random.default_rng(np.random.SeedSequence(seed))
    out: list[EpisodeSpec] = []
    for i in range(n):
        lo, hi = bands_m[i % len(bands_m)]
        for _ in range(max_attempts):
            s = free[rng.integers(len(free))]
            d = rng.uniform(lo, hi) / res_m
            ang = rng.uniform(0.0, 2.0 * np.pi)
            g = np.rint(s + d * np.array([np.sin(ang), np.cos(ang)])).astype(np.int64)
            if not (0 <= g[0] < c.shape[0] and 0 <= g[1] < c.shape[1]) or not np.isfinite(c[g[0], g[1]]):
                continue
            dist_m = res_m * float(np.hypot(*(s - g)))
            if not lo <= dist_m <= hi:
                continue
            res = astar(c, (int(s[0]), int(s[1])), (int(g[0]), int(g[1])))
            if res.status != NavStatus.OK or len(res.path) - 1 > limit:
                continue
            out.append(EpisodeSpec(
                index=i, seed=int(rng.integers(0, 2**63 - 1)), scenario_id=scenario_id,
                start=[int(s[0]), int(s[1])], goal=[int(g[0]), int(g[1])],
                oracle_cost=round(float(res.cost), 6), oracle_path_m=round(_path_m(res.path, res_m), 6),
            ))
            break
        else:
            raise RuntimeError(f"could not place episode {i} of {scenario_id} in band {lo}-{hi} m")
    return out


def build_suite(
    cost_for: Callable[[str], np.ndarray],
    dataset_sha256: str | None,
    plan: Mapping[str, Sequence[tuple[str, int]]] = LEVEL_PLAN,
    split: str = "test",
    res_m: float = 2.0,
    bands_m: Sequence[tuple[float, float]] = DISTANCE_BANDS_M,
    max_oracle_steps: int | None = None,
) -> Suite:
    levels: list[LevelSpec] = []
    episodes: list[EpisodeSpec] = []
    for li, (level, fams) in enumerate(plan.items()):
        levels.append(LevelSpec(level=level, scenario_ids=[sid for sid, _ in fams], episodes=sum(n for _, n in fams)))
        for fi, (sid, n) in enumerate(fams):
            fam_seed = int(np.random.SeedSequence([ROOT_SEED, li, fi]).generate_state(1, np.uint64)[0] >> 1)
            for e in generate_episodes(cost_for(sid), sid, n, fam_seed, split, res_m, bands_m, max_oracle_steps):
                episodes.append(e.model_copy(update={"index": len(episodes)}))
    return Suite(id=SUITE_ID, version=SUITE_VERSION, dataset_sha256=dataset_sha256, root_seed=ROOT_SEED,
                 split=split, levels=levels, episodes=episodes)


def level_episodes(suite: Suite, level: str) -> list[EpisodeSpec]:
    ids = {sid for lv in suite.levels if lv.level == level for sid in lv.scenario_ids}
    return [e for e in suite.episodes or [] if e.scenario_id in ids]


def save_suite(suite: Suite, path: str | Path) -> None:
    doc = suite.model_dump(by_alias=True, mode="json", exclude_none=True)
    Path(path).write_text(json.dumps(doc, indent=1, sort_keys=True) + "\n", encoding="utf-8", newline="\n")


def load_suite(path: str | Path) -> Suite:
    return Suite.model_validate_json(Path(path).read_text(encoding="utf-8"))


def suite_sha256(path: str | Path) -> str:
    return sha256_bytes(Path(path).read_bytes())
