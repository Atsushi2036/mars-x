"""Benchmark suite jezero-v1: scenario families, train/test regions and pre-generated episodes.

Composition (T5, PO v0.1):
- L1 Nominal navigation: 600 episodes, terrain only.
- L2 Under Mars conditions: 4 families x 200 (RTG storm, solar clear, solar storm, astronaut with SPE rule).
- L3 Consistent across sols & seeds: 6 families (profile x sol) x 100, with hidden rocks and one plan
  per sol; the pass rule is evaluated per family (Wilson 95 % lower bound, n >= 20).

Train/test split by region: the test region is the north-east quadrant of the planning window,
the train region the rest, separated by a guard band. Official (test) episodes have start and goal in
the test region (the oracle is optimal on the full map the agent can drive); the reference policies are
trained only on episodes of the train region.
Episodes are generated with an oracle (A*) that guarantees feasibility within the step budget.
"""

from __future__ import annotations

import json
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path

import numpy as np

from marsx.contracts.canonical import sha256_json
from marsx.contracts.scenario import CommSpec, Scenario, SpeSpec
from marsx.contracts.suite import MAX_SEED, EpisodeSpec, LevelSpec, Suite
from marsx.env import scenarios as env_scenarios
from marsx.nav import NavStatus, astar

SUITE_ID = "jezero-v1"
SUITE_VERSION = "0.1.0"
ROOT_SEED = 20261115
DISTANCE_BANDS_M: tuple[tuple[float, float], ...] = ((50.0, 150.0), (150.0, 400.0), (400.0, 1000.0))
ORACLE_STEP_FRACTION = 0.8  # oracle path must use <= 80 % of the scenario step budget

# ------------------------------------------------------------------ scenarios
# Single source of truth: L1/L2 families are the env's built-in scenarios; L3 families are the L2 sols
# (clear aphelion sol, Jan-2022 storm) for each profile, plus hidden rocks and one plan per sol (rovers).
_L3_ROCKS = "jezero-v1/l3/rtg-hidden-rocks"
_L3_BASES = {
    "rtg-clear": "jezero-v1/l3/rtg-onesol", "rtg-storm": "jezero-v1/l2/rtg-storm",
    "solar-clear": "jezero-v1/l2/solar-clear", "solar-storm": "jezero-v1/l2/solar-storm",
    "astronaut-clear": "jezero-v1/l2/astronaut-clear", "astronaut-storm": "jezero-v1/l2/astronaut-clear",
}
_STORM_FROM = "jezero-v1/l2/solar-storm"


def _l3(name: str) -> Scenario:
    base = env_scenarios.get(_L3_BASES[name])
    storm = env_scenarios.get(_STORM_FROM)
    rocks = env_scenarios.get(_L3_ROCKS).conditions.hidden_rocks
    cond = base.conditions.model_copy(update={"hidden_rocks": rocks})
    time = base.time
    if name.endswith("storm"):
        cond = cond.model_copy(update={"tau": storm.conditions.tau, "meda_sols": storm.conditions.meda_sols})
        time = storm.time
    if base.agent.kind != "astronaut":
        cond = cond.model_copy(update={"comm": CommSpec(mode="one_plan_per_sol", uplink_lmst_h=9.0)})
    else:
        cond = cond.model_copy(update={"spe": SpeSpec(enabled=True)})
    return base.model_copy(update={
        "id": f"jezero-v1/l3/{name}", "level": "L3", "conditions": cond, "time": time,
        "title": f"L3 consistency - {name.replace('-', ', ')} sol, hidden rocks",
    })


def _scenarios() -> dict[str, Scenario]:
    out = [env_scenarios.get(sid) for sid in (
        "jezero-v1/l1/rtg-geometry", "jezero-v1/l2/rtg-storm", "jezero-v1/l2/solar-clear",
        "jezero-v1/l2/solar-storm", "jezero-v1/l2/astronaut-clear")]
    out += [_l3(n) for n in _L3_BASES]
    return {s.id: s for s in out}


SCENARIOS = _scenarios()

LEVEL_PLAN: dict[str, list[tuple[str, int]]] = {
    "L1": [("jezero-v1/l1/rtg-geometry", 600)],
    "L2": [(f"jezero-v1/l2/{n}", 200) for n in ("rtg-storm", "solar-clear", "solar-storm", "astronaut-clear")],
    "L3": [(f"jezero-v1/l3/{n}", 100) for n in _L3_BASES],
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
    c = np.asarray(cost, dtype=np.float32)
    free = np.argwhere(mask & np.isfinite(c) & (c > 0))
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
            if not (0 <= g[0] < c.shape[0] and 0 <= g[1] < c.shape[1]) or not mask[g[0], g[1]]                     or not np.isfinite(c[g[0], g[1]]):
                continue
            dist_m = res_m * float(np.hypot(*(s - g)))
            if not lo <= dist_m <= hi:
                continue
            res = astar(c, (int(s[0]), int(s[1])), (int(g[0]), int(g[1])))
            if res.status != NavStatus.OK or len(res.path) - 1 > limit:
                continue
            out.append(EpisodeSpec(
                index=i, seed=int(rng.integers(0, 2**63 - 1)) & MAX_SEED, scenario_id=scenario_id,  # JSON-safe
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
    """Canonical-JSON hash of the suite content (stable across CRLF/LF checkouts and formatting)."""
    return sha256_json(load_suite(path).model_dump(by_alias=True, mode="json", exclude_none=True))
