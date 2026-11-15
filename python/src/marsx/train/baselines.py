"""Learning baselines on the official suite: tabular Q-learning (L1 only) and the PPO reference (L1-L3).

    uv run --project python --extra train python -m marsx.train.baselines --data data/processed/jezero-v1 \
        --runs <dir for run.json files> --out bench/jezero-v1/baselines

Writes ``<name>-L*.run.json`` to ``--runs`` and ``qlearning.scorecard.json`` / ``ppo.scorecard.json`` (verified by
re-simulation with ``marsx scorecard``) to ``--out``.
"""

from __future__ import annotations

import argparse
import os
import subprocess
import sys
import time
from pathlib import Path

from marsx.bench import env_factory as F
from marsx.bench import policies as P
from marsx.bench import runner as R
from marsx.bench import suite as S
from marsx.train.qlearn_policy import QLearningPolicy


def _scorecard(runs: list[Path], data: str, out: Path) -> None:
    env = {**os.environ, "PYTHONIOENCODING": "utf-8", "MARSX_DATA": data}
    cmd = [sys.executable, "-m", "marsx.cli", "scorecard", *map(str, runs), "--data", data, "--out", str(out)]
    print(subprocess.run(cmd, env=env, capture_output=True, text=True, encoding="utf-8", check=True).stdout, flush=True)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed/jezero-v1")
    ap.add_argument("--suite", default="bench/jezero-v1/suite.json")
    ap.add_argument("--runs", required=True)
    ap.add_argument("--out", default="bench/jezero-v1/baselines")
    ap.add_argument("--onnx", default="models/jezero-v1/policy.onnx")
    ap.add_argument("--only", choices=["qlearning", "ppo"], default=None)
    a = ap.parse_args(argv)
    runs_dir, out = Path(a.runs), Path(a.out)
    runs_dir.mkdir(parents=True, exist_ok=True)
    out.mkdir(parents=True, exist_ok=True)
    suite = S.load_suite(a.suite)
    make_env = F.vec_env_factory(a.data)
    jobs = []
    if a.only in (None, "qlearning"):
        jobs.append(("qlearning", lambda: QLearningPolicy(), "baseline/qlearning", "baseline", None, ["L1"]))
    if a.only in (None, "ppo"):
        pol = P.OnnxPolicy(a.onnx)
        jobs.append(("ppo", lambda: pol, pol.name, "onnx", pol.sha256, ["L1", "L2", "L3"]))
    for name, make_policy, pname, kind, sha, levels in jobs:
        files = []
        for level in levels:
            t0 = time.perf_counter()
            run = R.evaluate(suite, level, make_policy(), make_env, policy_name=pname, policy_kind=kind,
                             policy_sha256=sha)
            f = runs_dir / f"{name}-{level}.run.json"
            f.write_text(R.run_to_json(run), encoding="utf-8", newline="\n")
            files.append(f)
            m = run.metrics
            print(f"{name} {level}: n={m.n} success={m.success:.3f} CI95={m.success_ci95} spl={m.spl} "
                  f"violations={m.violations} ({time.perf_counter() - t0:.0f}s)", flush=True)
        _scorecard(files, a.data, out / f"{name}.scorecard.json")


if __name__ == "__main__":
    main()
