"""Export JSON Schemas + example documents to packages/schemas (CI checks drift in tests/test_contracts.py)."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from marsx.contracts import obs, policy, run, scenario, suite, traj

SCHEMA_FILES = {
    "run": "run.schema.json",
    "scenario": "scenario.schema.json",
    "suite": "suite.schema.json",
    "policy": "policy-card.schema.json",
}
_MODELS = {"run": run.Run, "scenario": scenario.Scenario, "suite": suite.Suite, "policy": policy.PolicyCard}


def _schema(name: str) -> dict:
    s = _MODELS[name].model_json_schema(by_alias=True, mode="serialization")
    s["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    s["$id"] = f"https://mars-x.dev/schemas/{SCHEMA_FILES[name]}"
    return json.loads(json.dumps(s, sort_keys=True))


def all_schemas() -> dict[str, dict]:
    return {name: _schema(name) for name in SCHEMA_FILES}


def _dump(model) -> dict:
    return json.loads(model.model_dump_json(by_alias=True, exclude_none=True))


def example_documents() -> dict[str, dict]:
    """Small, valid, deterministic examples (also used as golden inputs for the web zod validators)."""
    sc = scenario.Scenario(
        id="jezero-v1/l1/rtg-geometry",
        title="L1 geometry - RTG rover on the Jezero delta front",
        level="L1",
        window=scenario.Window(dataset_id="jezero-v1", grid_id="nav2m", row0=0, col0=0, rows=512, cols=512),
        agent=scenario.Agent(
            kind="rtg_rover",
            max_slope_deg=scenario.Param(value=24, unit="deg", provenance="source", ref=scenario.NASA_BLOG_2026),
            max_step_m=scenario.Param(value=0.525, unit="m", provenance="source", ref=scenario.NASA_ROVER),
            speed_m_s=scenario.Param(value=0.042, unit="m/s", provenance="source", ref=scenario.NASA_ROVER),
        ),
        max_steps=600,
    )
    rows = np.array([10, 10, 11], np.uint16)
    tr = traj.encode(traj.TrajArrays(row=rows, col=np.array([10, 11, 12], np.uint16),
                                     t_s=np.array([0, 48, 115], np.uint32), soc=np.array([1, 1, 0.999], np.float16),
                                     action=np.array([2, 6, 8], np.uint8)))
    rn = run.Run(
        run_id="00000000-0000-4000-8000-000000000000",
        created_utc="2026-11-15T03:00:00Z",
        producer=run.Producer(marsx_version="0.1.0", git_sha=None, python="3.13.3", platform="win-amd64"),
        suite=run.SuiteRef(id="jezero-v1", version="0.1.0", level="L1", split="test", root_seed=20261115),
        dataset=run.DatasetRef(id="jezero-v1", sha256="0" * 64),
        scenario=run.ScenarioRef(id=sc.id, sha256="1" * 64),
        policy=run.PolicyRef(name="baseline/astar", kind="baseline"),
        conditions=run.ConditionsSummary(gravity=scenario.JEZERO_GRAVITY.value),
        episodes=[run.EpisodeResult(index=0, seed=1, start=[10, 10], goal=[11, 12], outcome="success", steps=3,
                                    path_m=4.83, oracle=run.Oracle(path_m=4.83, cost=5.1),
                                    events=[run.Event(t=48, type="replan", cell=[10, 11])], trajectory=tr)],
        metrics=run.Metrics(n=1, success=1.0, success_ci95=[0.2065, 1.0], spl=1.0),
        scorecard=run.Scorecard(thresholds_version="v0.1", passed={"L1": True}),
    )
    st = suite.Suite(id="jezero-v1", version="0.1.0", root_seed=20261115,
                     levels=[suite.LevelSpec(level="L1", scenario_ids=[sc.id], episodes=1)],
                     episodes=[suite.EpisodeSpec(index=0, seed=1, scenario_id=sc.id, start=[10, 10], goal=[11, 12])])
    card = policy.PolicyCard(name="example/ppo", version="0.0.0", onnx_sha256="2" * 64, onnx_bytes=206942, opset=20,
                             ops=["Gemm", "Tanh"], intended_use="Example card.", limitations="Example only.",
                             license="MIT")
    return {"scenario": _dump(sc), "run": _dump(rn), "suite": _dump(st), "policy": _dump(card)}


def export(out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "examples").mkdir(exist_ok=True)
    written = []
    for name, schema in all_schemas().items():
        p = out_dir / SCHEMA_FILES[name]
        p.write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(p)
    for name, doc in example_documents().items():
        p = out_dir / "examples" / f"{name}.example.json"
        p.write_text(json.dumps(doc, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        written.append(p)
    p = out_dir / "obs-v1.layout.json"
    p.write_text(json.dumps(obs.layout_document(), indent=2) + "\n", encoding="utf-8")
    written.append(p)
    return written
