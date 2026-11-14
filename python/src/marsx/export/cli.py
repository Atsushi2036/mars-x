"""``python -m marsx.export --scenario <id> [--out DIR]`` (also exposed as ``marsx export`` by marsx.cli).

    python -m marsx.export --scenario jezero-v1/l2/solar-clear --out out/
    python -m marsx.export --demo --out data/processed/jezero-v1/export     # precompiled demo packages + index.json
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from collections.abc import Sequence
from pathlib import Path

from marsx.contracts.scenario import Scenario
from marsx.export import package as P

DEMO_SCENARIOS = (
    "jezero-v1/l1/rtg-geometry",
    "jezero-v1/l2/solar-clear",
    "jezero-v1/l2/solar-storm",
    "jezero-v1/l2/astronaut-clear",
    "jezero-v1/l3/rtg-clear",
)


def resolve_scenario(scenario_id: str) -> Scenario:
    from marsx.bench import suite as bs
    from marsx.env import scenarios as es

    try:
        return bs.scenario(scenario_id)
    except KeyError:
        return es.get(scenario_id)


def _first_existing(*c):
    for x in c:
        if x and Path(x).exists():
            return Path(x)
    return None


def pick_endpoints(sc: Scenario, suite_path: str | None, episode: int, start, goal) -> tuple[list[int], list[int], str]:
    if start and goal:
        return start, goal, "command line"
    if sc.start and sc.goal:
        return list(sc.start), list(sc.goal), "scenario"
    path = _first_existing(suite_path, "bench/jezero-v1/suite.json", "../bench/jezero-v1/suite.json")
    if path is None:
        raise SystemExit("scenario has no start/goal: pass --start r,c --goal r,c or --suite <suite.json>")
    doc = json.loads(path.read_text(encoding="utf-8"))
    eps = doc.get("episodes") or []
    own = [e for e in eps if e["scenarioId"] == sc.id]
    if own:
        e = own[episode % len(own)]
        return e["start"], e["goal"], f"suite {path.name} episode of {sc.id}"
    e = eps[episode % len(eps)]
    return e["start"], e["goal"], f"suite {path.name} fallback episode ({sc.id} not in that file)"


def export_one(scenario_id: str, data_dir: Path, out_dir: Path, mesh_step: int, texture_px: int,
               suite_path: str | None, episode: int, start=None, goal=None) -> dict:
    sc = resolve_scenario(scenario_id)
    s, g, src = pick_endpoints(sc, suite_path, episode, start, goal)
    inp = P.load_inputs(data_dir, sc, s, g, src, texture_px)
    files, meta = P.build_files(inp, mesh_step)
    files = P.finalize_package(files, meta)
    out_dir.mkdir(parents=True, exist_ok=True)
    name = P.slug(sc.id)
    zip_path = out_dir / f"marsx-{name}.zip"
    zsha = P.write_zip(files, zip_path, f"marsx-{name}")
    return {"scenarioId": sc.id, "zip": zip_path.name, "sha256": zsha, "bytes": zip_path.stat().st_size,
            "files": json.loads(files["manifest.json"])["files"], "sunElevationDeg": meta["sun"]["elevationDeg"],
            "ltstH": meta["sun"]["ltstH"], "gravity": meta["gravity"]["value"], "meshStepCells": mesh_step,
            "meshVsDem": meta["mesh"]["vsDem"]}


def _cell(s: str) -> list[int]:
    r, c = s.split(",")
    return [int(r), int(c)]


def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(prog="marsx export", description="Export a scenario to Gazebo / Isaac / web packages")
    ap.add_argument("--scenario", help="scenario id, e.g. jezero-v1/l2/solar-clear")
    ap.add_argument("--demo", action="store_true", help="export the demo scenarios and write index.json")
    ap.add_argument("--data", default=None, help="processed dataset dir (default: $MARSX_DATA)")
    ap.add_argument("--out", default="out")
    ap.add_argument("--mesh-step", type=int, default=8, help="mesh decimation in DEM cells (default 8 -> 8 m)")
    ap.add_argument("--texture-px", type=int, default=2048)
    ap.add_argument("--suite", default=None, help="suite.json providing start/goal episodes")
    ap.add_argument("--episode", type=int, default=0)
    ap.add_argument("--start", type=_cell, default=None, help="row,col on the planning grid")
    ap.add_argument("--goal", type=_cell, default=None)
    return ap


def main(argv: Sequence[str] | None = None) -> int:
    a = build_parser().parse_args(argv)
    if bool(a.scenario) == bool(a.demo):
        print("choose exactly one of --scenario or --demo", file=sys.stderr)
        return 1
    data = _first_existing(a.data, os.environ.get("MARSX_DATA"), "data/processed/jezero-v1", "../data/processed/jezero-v1")
    if data is None or not (data / "manifest.json").exists():
        print("No processed dataset: pass --data or set MARSX_DATA", file=sys.stderr)
        return 1
    out = Path(a.out)
    ids = list(DEMO_SCENARIOS) if a.demo else [a.scenario]
    entries = []
    for sid in ids:
        e = export_one(sid, data, out, a.mesh_step, a.texture_px, a.suite, a.episode, a.start, a.goal)
        entries.append(e)
        print(f"{sid}: {e['zip']} {e['bytes'] / 1048576:.1f} MiB sha256={e['sha256'][:16]}... "
              f"sun el={e['sunElevationDeg']:.1f} deg g={e['gravity']}")
    if a.demo:
        doc = {"schema": "export-index/1", "datasetId": data.name,
               "packages": [{k: e[k] for k in ("scenarioId", "zip", "sha256", "bytes", "gravity", "meshStepCells")}
                            | {"sunElevationDeg": round(e["sunElevationDeg"], 3), "ltstH": round(e["ltstH"], 3)}
                            for e in entries]}
        (out / "index.json").write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(f"index.json written ({len(entries)} packages)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
