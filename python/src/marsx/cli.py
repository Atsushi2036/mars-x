"""MARS-X command line.

    marsx evaluate --policy model.onnx --suite bench/jezero-v1/suite.json --level L1 --out run.json
    marsx evaluate --policy baseline:astar --level L2
    marsx scorecard run_L1.json run_L2.json --suite bench/jezero-v1/suite.json --out scorecard.json

``scorecard`` re-simulates every run (anti-cheat) and exits 0 when all runs are verified, 2 when any run
is "Not verifiable", 1 on invalid input. Without an installed entry point use ``python -m marsx.cli``.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from pydantic import ValidationError

from marsx.bench import policies as P
from marsx.bench import runner as R
from marsx.bench import scorecard as sc
from marsx.bench import suite as S
from marsx.bench import verify as V
from marsx.contracts.run import MAX_BYTES, Run

BASELINES = {
    "baseline:astar": ("baseline/astar", P.AStarPolicy),
    "baseline:astar-replan": ("baseline/astar-replan", P.AStarReplanPolicy),
    "baseline:random": ("baseline/random", P.RandomPolicy),
}


def _first_existing(*candidates: str | os.PathLike | None) -> Path | None:
    for c in candidates:
        if c and Path(c).exists():
            return Path(c)
    return None


def _default_suite() -> str:
    p = _first_existing("bench/jezero-v1/suite.json", "../bench/jezero-v1/suite.json")
    return str(p or "bench/jezero-v1/suite.json")


def _data_dir(arg: str | None) -> Path:
    p = _first_existing(arg, os.environ.get("MARSX_DATA"), "data/processed/jezero-v1", "../data/processed/jezero-v1")
    if p is None or not (p / "manifest.json").exists():
        raise SystemExit("No processed Jezero dataset found: pass --data <dir with manifest.json> or set MARSX_DATA")
    return p


def _policy(spec: str) -> tuple[P.Policy, str, str, str | None]:
    if spec in BASELINES:
        name, cls = BASELINES[spec]
        return cls(), name, "baseline", None
    if spec.startswith("baseline:"):
        raise SystemExit(f"unknown baseline {spec!r}; choose from {sorted(BASELINES)}")
    pol = P.OnnxPolicy(spec)
    return pol, pol.name, "onnx", pol.sha256


def _write(path: str | None, text: str) -> None:
    if path:
        Path(path).write_text(text, encoding="utf-8", newline="\n")


def cmd_evaluate(args: argparse.Namespace, make_env: R.EnvFactory | None) -> int:
    suite = S.load_suite(args.suite)
    data_sha = None
    if make_env is None:
        make_env, data_sha = _vec_factory(args.data)
        if suite.dataset_sha256 and data_sha != suite.dataset_sha256:
            print(f"warning: suite was generated for dataset {suite.dataset_sha256[:12]}, loaded {str(data_sha)[:12]}",
                  file=sys.stderr)
    policy, name, kind, sha = _policy(args.policy)
    run = R.evaluate(suite, args.level, policy, make_env, policy_name=args.name or name, policy_kind=kind,
                     policy_sha256=sha, batch_size=args.batch, dataset_sha256=data_sha)
    text = R.run_to_json(run)
    _write(args.out or f"run_{args.level}.json", text)
    mt = run.metrics
    print(f"{args.level}: n={mt.n} success={mt.success:.3f} CI95=[{mt.success_ci95[0]:.3f}, {mt.success_ci95[1]:.3f}] "
          f"SPL={mt.spl} violations={mt.violations} -> {args.out or f'run_{args.level}.json'}")
    return 0


def _load_run(path: str) -> Run:
    p = Path(path)
    if p.stat().st_size > MAX_BYTES:
        raise ValueError(f"{path}: larger than {MAX_BYTES} bytes")
    return Run.model_validate_json(p.read_text(encoding="utf-8"))


def cmd_scorecard(args: argparse.Namespace, make_env: R.EnvFactory | None) -> int:
    suite = S.load_suite(args.suite)
    try:
        runs = [_load_run(p) for p in args.runs]
    except (OSError, ValueError, ValidationError) as exc:
        print(f"invalid run.json: {exc}", file=sys.stderr)
        return 1
    data_sha = None
    if make_env is None:
        make_env, data_sha = _vec_factory(args.data)
    checks = [V.verify_run(r, suite, make_env, batch_size=args.batch, dataset_sha256=data_sha) for r in runs]
    rep = sc.build_report(runs, checks, suite, S.suite_sha256(args.suite))
    _write(args.out, json.dumps(rep, indent=1, ensure_ascii=False) + "\n")
    print(f"{rep['program']} · {rep['header']['status']}")
    for v in rep["verdict"]["levels"]:
        why = "" if v["passed"] else " — " + "; ".join(v["reasons"][:3])
        print(f"  {v['level']} {v['name']}: {'PASS' if v['passed'] else 'not passed'}{why}")
    if rep["verdict"]["seal"]:
        print(f"  {rep['verdict']['seal']}")
    return 0 if all(c.verified for c in checks) else 2


def _vec_factory(data: str | None) -> tuple[R.EnvFactory, str | None]:
    from marsx.bench.env_factory import load_terrain_cached, vec_env_factory

    d = _data_dir(data)
    return vec_env_factory(d), load_terrain_cached(str(d)).dataset_sha256


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="marsx", description="MARS-X First Filter (simulation) benchmark")
    sub = ap.add_subparsers(dest="cmd", required=True)
    ev = sub.add_parser("evaluate", help="run a policy on one suite level and write run.json")
    ev.add_argument("--policy", required=True, help="model.onnx | baseline:astar | baseline:astar-replan | baseline:random")
    ev.add_argument("--level", required=True, choices=list(sc.LEVELS))
    ev.add_argument("--suite", default=_default_suite())
    ev.add_argument("--data", default=None, help="processed dataset dir (default: $MARSX_DATA)")
    ev.add_argument("--out", default=None)
    ev.add_argument("--name", default=None, help="policy name shown in the scorecard")
    ev.add_argument("--batch", type=int, default=R.DEFAULT_BATCH)
    scp = sub.add_parser("scorecard", help="verify run.json files by re-simulation and build the scorecard")
    scp.add_argument("runs", nargs="+")
    scp.add_argument("--suite", default=_default_suite())
    scp.add_argument("--data", default=None)
    scp.add_argument("--out", default=None)
    scp.add_argument("--batch", type=int, default=R.DEFAULT_BATCH)
    return ap


def main(argv: Sequence[str] | None = None, make_env: R.EnvFactory | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.cmd == "evaluate":
        return cmd_evaluate(args, make_env)
    return cmd_scorecard(args, make_env)


if __name__ == "__main__":
    raise SystemExit(main())
