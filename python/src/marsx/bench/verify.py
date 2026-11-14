"""run.json verification (anti-cheat): never trust self-reported numbers.

1. The run must reference this suite (id, version, level, split, root seed) and contain exactly the
   suite's episodes for that level (same index, seed, scenario, start, goal).
2. Every episode needs a valid traj/1 block (sha256 of the decoded bytes must match).
3. The recorded actions are replayed on the env; outcome, steps, path, energy, violations, the oracle
   reference (A* replayed in the same env) and the re-simulated trajectory bytes must match the run.
4. Metrics are recomputed from the re-simulated episodes and must equal the reported metrics.
Any failure -> "Not verifiable" and no level is granted.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from marsx.bench import metrics as m
from marsx.bench import runner as R
from marsx.bench import suite as S
from marsx.bench.policies import ActionReplayPolicy
from marsx.contracts import traj
from marsx.contracts.run import EpisodeResult, Metrics, Run
from marsx.contracts.suite import Suite

VERIFIED = "verified"
NOT_VERIFIABLE = "not_verifiable"
_LABELS = {VERIFIED: "Verified by re-simulation ✓", NOT_VERIFIABLE: "Not verifiable"}
PATH_TOL_M = 1e-4
ENERGY_TOL_WH = 1e-3
METRIC_TOL = 1e-6
MAX_REASONS = 50


def label(status: str) -> str:
    return _LABELS[status]


@dataclass
class Verification:
    status: str
    reasons: list[str] = field(default_factory=list)
    episodes: list[EpisodeResult] = field(default_factory=list)
    metrics: Metrics | None = None

    @property
    def verified(self) -> bool:
        return self.status == VERIFIED

    def to_dict(self) -> dict[str, object]:
        return {"status": self.status, "label": label(self.status), "reasons": self.reasons}


def _fail(reasons: list[str]) -> Verification:
    return Verification(NOT_VERIFIABLE, reasons[:MAX_REASONS])


def _close(a: float | None, b: float | None, tol: float) -> bool:
    if a is None or b is None:
        return a is None and b is None
    return abs(a - b) <= tol


def _metrics_equal(a: Metrics, b: Metrics) -> bool:
    da, db = a.model_dump(), b.model_dump()
    for k in da:
        x, y = da[k], db[k]
        if isinstance(x, list):
            if len(x) != len(y) or any(abs(p - q) > METRIC_TOL for p, q in zip(x, y)):
                return False
        elif isinstance(x, float) or isinstance(y, float):
            if not _close(x, y, METRIC_TOL):
                return False
        elif x != y:
            return False
    return True


def verify_run(
    run: Run, suite: Suite, make_env: R.EnvFactory, batch_size: int = R.DEFAULT_BATCH,
    dataset_sha256: str | None = None,
) -> Verification:
    """``dataset_sha256``: hash of the dataset the verifier loaded; a run produced on other data is rejected."""
    reasons: list[str] = []
    if dataset_sha256 is not None and run.dataset.sha256 != dataset_sha256:
        return _fail([f"dataset mismatch: run used {run.dataset.sha256[:12]}, verifier loaded {dataset_sha256[:12]}"])
    ref = run.suite
    if (ref.id, ref.version, ref.split, ref.root_seed) != (suite.id, suite.version, suite.split, suite.root_seed):
        reasons.append(f"suite mismatch: run references {ref.id} {ref.version}, expected {suite.id} {suite.version}")
        return _fail(reasons)
    specs = S.level_episodes(suite, ref.level)
    want = {(s.index, s.seed, s.scenario_id, tuple(s.start), tuple(s.goal)) for s in specs}
    got = {(e.index, e.seed, e.scenario_id, tuple(e.start), tuple(e.goal)) for e in run.episodes}
    if want != got or len(run.episodes) != len(specs):
        reasons.append(f"episode set differs from suite level {ref.level} "
                       f"({len(want - got)} missing/changed, {len(got - want)} unexpected)")
        return _fail(reasons)

    actions: dict[int, np.ndarray] = {}
    for e in run.episodes:
        if e.trajectory is None:
            reasons.append(f"episode {e.index}: missing trajectory")
            continue
        try:
            a = traj.decode(e.trajectory)
        except ValueError as exc:
            reasons.append(f"episode {e.index}: invalid trajectory ({exc})")
            continue
        actions[e.index] = a.action[:-1].astype(np.int64)
    if reasons:
        return _fail(reasons)

    by_index = {e.index: e for e in run.episodes}
    resim = R.run_episodes(specs, ActionReplayPolicy(actions), make_env, batch_size)
    for r in resim:
        e = by_index[r.index]
        diffs = []
        if r.outcome != e.outcome:
            diffs.append(f"outcome {e.outcome} != {r.outcome}")
        if r.steps != e.steps:
            diffs.append(f"steps {e.steps} != {r.steps}")
        if not _close(r.path_m, e.path_m, PATH_TOL_M):
            diffs.append(f"pathM {e.path_m} != {r.path_m}")
        if not _close(r.energy_wh, e.energy_wh, ENERGY_TOL_WH):
            diffs.append(f"energyWh {e.energy_wh} != {r.energy_wh}")
        if r.violations != e.violations:
            diffs.append(f"violations {e.violations} != {r.violations}")
        if (r.oracle is None) != (e.oracle is None) or (r.oracle and e.oracle and (
                not _close(r.oracle.path_m, e.oracle.path_m, PATH_TOL_M)
                or not _close(r.oracle.cost, e.oracle.cost, PATH_TOL_M)
                or not _close(r.oracle.energy_wh, e.oracle.energy_wh, ENERGY_TOL_WH))):
            diffs.append("oracle reference differs from the suite oracle")
        if r.trajectory.sha256 != e.trajectory.sha256:  # type: ignore[union-attr]
            diffs.append("trajectory differs from re-simulation")
        if diffs:
            reasons.append(f"episode {e.index}: " + "; ".join(diffs))
    recomputed = m.compute_metrics(resim)
    if not _metrics_equal(recomputed, run.metrics):
        reasons.append("reported metrics differ from metrics recomputed by re-simulation")
    if reasons:
        out = _fail(reasons)
        out.episodes, out.metrics = resim, recomputed
        return out
    return Verification(VERIFIED, [], resim, recomputed)
