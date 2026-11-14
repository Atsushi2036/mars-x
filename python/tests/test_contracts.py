"""Contracts shared by the SDK, the benchmark and the web app (run/1, scenario/1, suite/1, policy/1, obs/1, traj/1)."""

from __future__ import annotations

import json
import math
from pathlib import Path

import jsonschema
import numpy as np
import pytest
from pydantic import ValidationError

from marsx.contracts import obs, policy, run, scenario, suite, traj
from marsx.contracts.canonical import canonical_json, sha256_json
from marsx.contracts.export import SCHEMA_FILES, all_schemas, example_documents

REPO = Path(__file__).resolve().parents[2]
SCHEMAS = REPO / "packages" / "schemas"


# ---------------------------------------------------------------- obs/1 and act/1
def test_obs_v1_layout_sums_to_documented_dimension():
    assert obs.OBS_DIM == 505
    assert sum(b.size for b in obs.LAYOUT) == obs.OBS_DIM
    assert [b.name for b in obs.LAYOUT][0] == "terrain"
    starts = [b.start for b in obs.LAYOUT]
    assert starts == sorted(starts) and starts[0] == 0


def test_act_v1_has_eight_moves_plus_wait():
    assert obs.N_ACTIONS == 9
    assert obs.ACTIONS[8].name == "WAIT" and (obs.ACTIONS[8].drow, obs.ACTIONS[8].dcol) == (0, 0)
    moves = {(a.drow, a.dcol) for a in obs.ACTIONS[:8]}
    assert len(moves) == 8 and (0, 0) not in moves
    # rows grow southwards (grid is north-up, row 0 = north edge)
    assert (obs.ACTIONS[0].name, obs.ACTIONS[0].drow) == ("N", -1)


# ---------------------------------------------------------------- traj/1
def test_traj_roundtrip_is_exact_and_hashed():
    rng = np.random.default_rng(0)
    n = 257
    steps = traj.TrajArrays(
        row=rng.integers(0, 4096, n).astype(np.uint16),
        col=rng.integers(0, 4096, n).astype(np.uint16),
        t_s=np.cumsum(rng.integers(1, 90, n)).astype(np.uint32),
        soc=rng.random(n).astype(np.float16),
        action=rng.integers(0, 9, n).astype(np.uint8),
    )
    block = traj.encode(steps)
    assert block.encoding == "traj/1"
    back = traj.decode(block)
    for name in ("row", "col", "t_s", "soc", "action"):
        np.testing.assert_array_equal(getattr(back, name), getattr(steps, name))
    assert len(traj.raw_bytes(block)) == 11 * n


def test_traj_rejects_tampered_payload():
    steps = traj.TrajArrays.empty(3)
    block = traj.encode(steps)
    bad = block.model_copy(update={"sha256": "0" * 64})
    with pytest.raises(ValueError, match="sha256"):
        traj.decode(bad)


# ---------------------------------------------------------------- run/1
def _example_run() -> dict:
    return json.loads(json.dumps(example_documents()["run"]))


def test_example_run_validates_and_uses_camel_case():
    doc = _example_run()
    r = run.Run.model_validate(doc)
    assert r.schema_version == "run/1"
    assert "schemaVersion" in doc and "schema_version" not in doc


def test_run_rejects_unknown_keys():
    doc = _example_run()
    doc["surprise"] = 1
    with pytest.raises(ValidationError):
        run.Run.model_validate(doc)


def test_run_rejects_non_finite_numbers():
    doc = _example_run()
    doc["episodes"][0]["pathM"] = math.inf
    with pytest.raises(ValidationError):
        run.Run.model_validate(doc)


def test_run_rejects_unknown_outcome():
    doc = _example_run()
    doc["episodes"][0]["outcome"] = "teleported"
    with pytest.raises(ValidationError):
        run.Run.model_validate(doc)


def test_trajectory_has_one_entry_per_state_with_wait_sentinel():
    doc = _example_run()
    ep = doc["episodes"][0]
    assert ep["trajectory"]["steps"] == ep["steps"] + 1
    t = traj.decode(run.Run.model_validate(doc).episodes[0].trajectory)
    assert int(t.action[-1]) == obs.WAIT
    bad = _example_run()
    bad["episodes"][0]["steps"] = bad["episodes"][0]["trajectory"]["steps"]  # old layout: one entry per action
    with pytest.raises(ValidationError, match="steps \\+ 1"):
        run.Run.model_validate(bad)


def test_run_caps_number_of_episodes():
    doc = _example_run()
    doc["episodes"] = doc["episodes"] * (run.MAX_EPISODES + 1)
    with pytest.raises(ValidationError):
        run.Run.model_validate(doc)


# ---------------------------------------------------------------- scenario/1
def test_param_from_source_requires_reference():
    with pytest.raises(ValidationError):
        scenario.Param(value=3.7, unit="m/s2", provenance="source")
    p = scenario.Param(value=30, unit="min", provenance="assumption")
    assert p.ref is None


def test_default_gravity_is_computed_for_jezero_with_reference():
    g = scenario.JEZERO_GRAVITY
    assert g.value == pytest.approx(3.694, abs=5e-4)
    assert g.provenance == "computed" and "nssdc" in (g.ref or "")


def test_example_scenario_validates_and_hash_is_stable():
    doc = example_documents()["scenario"]
    s = scenario.Scenario.model_validate(doc)
    assert sha256_json(doc) == sha256_json(json.loads(json.dumps(doc)))
    assert s.agent.kind in {"rtg_rover", "solar_rover", "astronaut"}


def test_canonical_json_is_key_order_independent():
    assert canonical_json({"b": 1, "a": [2, {"d": 1, "c": 0}]}) == canonical_json({"a": [2, {"c": 0, "d": 1}], "b": 1})


# ---------------------------------------------------------------- suite/1 and policy/1
def test_example_suite_and_policy_card_validate():
    docs = example_documents()
    suite.Suite.model_validate(docs["suite"])
    card = policy.PolicyCard.model_validate(docs["policy"])
    assert card.obs_dim == obs.OBS_DIM and card.n_actions == obs.N_ACTIONS


def test_v01_thresholds_match_product_owner_decision():
    t = {c.level: c for c in suite.DEFAULT_PASS_CRITERIA}
    assert (t["L1"].metric, t["L1"].threshold) == ("success", 0.80)
    assert (t["L2"].metric, t["L2"].threshold) == ("success", 0.70)
    assert (t["L3"].metric, t["L3"].threshold, t["L3"].min_episodes) == ("successWilson95Lower", 0.60, 20)


# ---------------------------------------------------------------- JSON Schema files (drift)
@pytest.mark.parametrize("name", sorted(SCHEMA_FILES))
def test_committed_schema_matches_models(name):
    committed = json.loads((SCHEMAS / SCHEMA_FILES[name]).read_text(encoding="utf-8"))
    assert committed == all_schemas()[name], f"run `python -m marsx.contracts` to regenerate {SCHEMA_FILES[name]}"


@pytest.mark.parametrize("name", sorted(SCHEMA_FILES))
def test_examples_validate_against_json_schema(name):
    jsonschema.validate(example_documents()[name], all_schemas()[name])
    committed_example = json.loads((SCHEMAS / "examples" / f"{name}.example.json").read_text(encoding="utf-8"))
    assert committed_example == example_documents()[name]
