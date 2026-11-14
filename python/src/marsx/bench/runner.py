"""Benchmark runner: plays suite episodes with a policy on the vectorised env and writes run/1.

Env surface (JezeroVecEnv, gymnasium VectorEnv, autoreset NEXT_STEP):
``reset(seed=list[int], options={"episodes": specs, "scenario": Scenario})`` and per-step ``info`` arrays
``cell``, ``tS``, ``soc``, ``energyWh``, ``pathM``, ``outcome`` ("" while running), ``violations``,
``timeSlopeGt15S``. ``make_env(scenario, num_envs)`` builds one env per scenario family.

traj/1 convention: entry k = state before action k (cell, t, soc) and the action taken there; the last
entry is the terminal state with WAIT (8) as sentinel, so ``trajectory.steps == steps + 1``.
"""

from __future__ import annotations

import platform
import subprocess
import sys
import uuid
from collections import defaultdict
from collections.abc import Callable, Sequence
from datetime import UTC, datetime
from typing import Any

import numpy as np

from marsx.bench import metrics as m
from marsx.bench import scorecard as sc
from marsx.bench import suite as S
from marsx.bench.policies import Policy
from marsx.contracts import obs as obs_spec
from marsx.contracts import traj
from marsx.contracts.canonical import sha256_json
from marsx.contracts.run import (
    ConditionsSummary,
    DatasetRef,
    EpisodeResult,
    Oracle,
    PolicyRef,
    Producer,
    Risk,
    Run,
    ScenarioRef,
    SuiteRef,
)
from marsx.contracts.scenario import Scenario
from marsx.contracts.suite import EpisodeSpec, Suite

EnvFactory = Callable[[Scenario, int], Any]
DEFAULT_BATCH = 1024
_STEP_MARGIN = 2  # extra steps beyond max_steps before the runner force-stops a batch


def _run_batch(specs: Sequence[EpisodeSpec], scenario: Scenario, policy: Policy, env: Any) -> list[EpisodeResult]:
    n_real, n = len(specs), env.num_envs
    padded = list(specs) + [specs[-1]] * (n - n_real)
    obs, info = env.reset(seed=[s.seed for s in padded], options={"episodes": padded, "scenario": scenario})
    policy.begin(padded, env)
    rows: list[list[int]] = [[] for _ in range(n)]
    cols: list[list[int]] = [[] for _ in range(n)]
    ts: list[list[float]] = [[] for _ in range(n)]
    socs: list[list[float]] = [[] for _ in range(n)]
    acts: list[list[int]] = [[] for _ in range(n)]
    final: dict[int, dict[str, Any]] = {}
    done = np.zeros(n, bool)
    done[n_real:] = True

    def record(idx: np.ndarray, inf: dict[str, Any]) -> None:
        cell = np.asarray(inf["cell"])
        for i in idx:
            rows[i].append(int(cell[i, 0]))
            cols[i].append(int(cell[i, 1]))
            ts[i].append(float(inf["tS"][i]))
            socs[i].append(float(inf["soc"][i]))

    record(np.arange(n_real), info)
    for _ in range(scenario.max_steps + _STEP_MARGIN):
        if done.all():
            break
        a = np.asarray(policy.act(obs, info), dtype=np.int64).reshape(n)
        a = np.where((a >= 0) & (a < obs_spec.N_ACTIONS), a, obs_spec.WAIT)
        a[done] = obs_spec.WAIT
        active = np.flatnonzero(~done)
        obs, _, term, trunc, info = env.step(a)
        for i in active:
            acts[i].append(int(a[i]))
        record(active, info)
        ended = active[(np.asarray(term) | np.asarray(trunc))[active]]
        for i in ended:
            final[int(i)] = {
                "outcome": str(info["outcome"][i]) or "timeout",
                "pathM": float(info["pathM"][i]),
                "energyWh": float(info["energyWh"][i]) if "energyWh" in info else None,
                "violations": int(info["violations"][i]) if "violations" in info else 0,
                "slope15": float(info["timeSlopeGt15S"][i]) if "timeSlopeGt15S" in info else 0.0,
            }
        done[ended] = True
    for i in np.flatnonzero(~done):  # safety net: env never ended the episode
        final[int(i)] = {"outcome": "timeout", "pathM": float(info["pathM"][i]),
                         "energyWh": float(info["energyWh"][i]) if "energyWh" in info else None,
                         "violations": int(info["violations"][i]) if "violations" in info else 0,
                         "slope15": float(info["timeSlopeGt15S"][i]) if "timeSlopeGt15S" in info else 0.0}

    out = []
    for i, spec in enumerate(specs):
        f = final[i]
        arrays = traj.TrajArrays(
            row=np.array(rows[i], np.uint16), col=np.array(cols[i], np.uint16),
            t_s=np.rint(np.array(ts[i])).astype(np.uint32), soc=np.array(socs[i], np.float16),
            action=np.array(acts[i] + [obs_spec.WAIT], np.uint8),
        )
        oracle = None
        if spec.oracle_path_m is not None and spec.oracle_cost is not None:
            oracle = Oracle(path_m=spec.oracle_path_m, cost=spec.oracle_cost)
        out.append(EpisodeResult(
            index=spec.index, seed=spec.seed, scenario_id=spec.scenario_id, start=spec.start, goal=spec.goal,
            outcome=f["outcome"], steps=len(acts[i]), path_m=round(f["pathM"], 6),
            energy_wh=None if f["energyWh"] is None else round(f["energyWh"], 6), oracle=oracle,
            risk=Risk(time_slope_gt15_s=round(f["slope15"], 6)), violations=f["violations"],
            trajectory=traj.encode(arrays),
        ))
    return out


def run_episodes(
    specs: Sequence[EpisodeSpec], policy: Policy, make_env: EnvFactory, batch_size: int = DEFAULT_BATCH,
    oracle_energy: bool = True,
) -> list[EpisodeResult]:
    """Run every spec (grouped by scenario family, in batches) and return results in spec order.

    With ``oracle_energy`` the oracle (A* on the env's map) is replayed in the same env and its measured
    energy becomes ``oracle.energyWh`` (denominator of the energy ratio; recomputed again on verification).
    """
    by_family: dict[str, list[EpisodeSpec]] = defaultdict(list)
    for s in specs:
        by_family[s.scenario_id].append(s)
    results: dict[int, EpisodeResult] = {}
    for sid, fam in by_family.items():
        scenario = S.scenario(sid)
        size = min(batch_size, len(fam))
        env = make_env(scenario, size)
        for k in range(0, len(fam), size):
            for r in _run_batch(fam[k:k + size], scenario, policy, env):
                results[r.index] = r
    out = [results[s.index] for s in specs]
    return _attach_oracle_energy(specs, out, make_env, batch_size) if oracle_energy else out


def _attach_oracle_energy(
    specs: Sequence[EpisodeSpec], results: list[EpisodeResult], make_env: EnvFactory, batch_size: int
) -> list[EpisodeResult]:
    from marsx.bench.policies import AStarPolicy

    ref = run_episodes(specs, AStarPolicy(), make_env, batch_size, oracle_energy=False)
    out = []
    for r, o in zip(results, ref):
        if r.oracle is not None and o.outcome == "success" and o.energy_wh is not None:
            r = r.model_copy(update={"oracle": r.oracle.model_copy(update={"energy_wh": o.energy_wh})})
        out.append(r)
    return out


def _git_sha() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], capture_output=True, text=True, timeout=5, check=False)
        return out.stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def _producer() -> Producer:
    try:
        from importlib.metadata import version

        mv = version("marsx")
    except Exception:  # noqa: BLE001 - running from a source tree
        mv = "0.1.0"
    return Producer(marsx_version=mv, git_sha=_git_sha(), python=platform.python_version(),
                    platform=f"{sys.platform}-{platform.machine().lower()}")


def scenario_ref(scenario_ids: Sequence[str], level: str) -> ScenarioRef:
    if len(scenario_ids) == 1:
        return ScenarioRef(id=scenario_ids[0], sha256=S.scenario_sha256(scenario_ids[0]))
    docs = [S.scenario(s).model_dump(by_alias=True, mode="json") for s in scenario_ids]
    return ScenarioRef(id=f"{S.SUITE_ID}/{level.lower()}", sha256=sha256_json(docs))


def conditions_summary(scenario_ids: Sequence[str]) -> ConditionsSummary:
    scs = [S.scenario(s) for s in scenario_ids]
    sols = sorted({sol for s in scs for sol in s.conditions.meda_sols})
    taus = [s.conditions.tau.value for s in scs if s.conditions.tau is not None]
    return ConditionsSummary(meda_sols=sols, tau=max(taus) if taus else None,
                             gravity=scs[0].conditions.gravity.value)


def evaluate(
    suite: Suite,
    level: str,
    policy: Policy,
    make_env: EnvFactory,
    policy_name: str = "policy",
    policy_kind: str = "python",
    policy_sha256: str | None = None,
    batch_size: int = DEFAULT_BATCH,
    dataset_sha256: str | None = None,
) -> Run:
    """``dataset_sha256``: hash of the dataset actually loaded (defaults to the suite's pinned dataset)."""
    specs = S.level_episodes(suite, level)
    if not specs:
        raise ValueError(f"suite {suite.id} has no episodes for level {level}")
    episodes = run_episodes(specs, policy, make_env, batch_size)
    sids = [sid for lv in suite.levels if lv.level == level for sid in lv.scenario_ids]
    verdict = sc.evaluate_level(level, episodes, suite.pass_criteria, verified=True)
    thresholds = next((c.version for c in suite.pass_criteria if c.level == level), "v0.1")
    return Run(
        run_id=str(uuid.uuid4()),
        created_utc=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        producer=_producer(),
        suite=SuiteRef(id=suite.id, version=suite.version, level=level, split=suite.split, root_seed=suite.root_seed),
        dataset=DatasetRef(id=S.SUITE_ID, sha256=dataset_sha256 or suite.dataset_sha256 or "0" * 64),
        scenario=scenario_ref(sids, level),
        policy=PolicyRef(name=policy_name[:96], kind=policy_kind, sha256=policy_sha256),
        conditions=conditions_summary(sids),
        episodes=episodes,
        metrics=m.compute_metrics(episodes),
        scorecard=sc.to_contract({level: verdict.passed}, thresholds),
    )


def run_to_json(run: Run) -> str:
    return run.model_dump_json(by_alias=True, exclude_none=True)
