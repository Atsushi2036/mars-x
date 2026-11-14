import json

import pytest

from marsx import cli
from marsx.bench import suite as S
from marsx.contracts.run import Run


@pytest.fixture
def suite_file(tmp_path, grid):
    suite = S.build_suite(lambda sid: grid, dataset_sha256="b" * 64,
                          plan={"L1": [("jezero-v1/l1/rtg-geometry", 5)]},
                          bands_m=((6, 20), (20, 30)), max_oracle_steps=40)
    p = tmp_path / "suite.json"
    S.save_suite(suite, p)
    return p


def test_evaluate_then_scorecard(tmp_path, suite_file, make_env, capsys):
    out = tmp_path / "run.json"
    rc = cli.main(["evaluate", "--policy", "baseline:astar", "--suite", str(suite_file), "--level", "L1",
                   "--out", str(out)], make_env=make_env)
    assert rc == 0
    run = Run.model_validate_json(out.read_text(encoding="utf-8"))
    assert run.metrics.n == 5 and run.policy.kind == "baseline" and run.policy.name == "baseline/astar"
    card = tmp_path / "scorecard.json"
    rc = cli.main(["scorecard", str(out), "--suite", str(suite_file), "--out", str(card)], make_env=make_env)
    assert rc == 0
    rep = json.loads(card.read_text(encoding="utf-8"))
    assert rep["header"]["status"] == "Verified by re-simulation ✓"
    assert {v["level"]: v["passed"] for v in rep["verdict"]["levels"]}["L1"] is True
    printed = capsys.readouterr().out
    assert "L1" in printed and "Verified by re-simulation" in printed


def test_scorecard_flags_tampered_run(tmp_path, suite_file, make_env):
    out = tmp_path / "run.json"
    cli.main(["evaluate", "--policy", "baseline:random", "--suite", str(suite_file), "--level", "L1",
              "--out", str(out)], make_env=make_env)
    doc = json.loads(out.read_text(encoding="utf-8"))
    doc["metrics"]["success"] = 1.0
    out.write_text(json.dumps(doc), encoding="utf-8")
    card = tmp_path / "scorecard.json"
    rc = cli.main(["scorecard", str(out), "--suite", str(suite_file), "--out", str(card)], make_env=make_env)
    assert rc == 2
    assert json.loads(card.read_text(encoding="utf-8"))["header"]["status"] == "Not verifiable"


def test_rejects_oversized_or_invalid_run(tmp_path, suite_file, make_env):
    bad = tmp_path / "bad.json"
    bad.write_text('{"schemaVersion": "run/1"}', encoding="utf-8")
    assert cli.main(["scorecard", str(bad), "--suite", str(suite_file)], make_env=make_env) == 1


def test_unknown_policy_spec_is_an_error(suite_file, make_env):
    with pytest.raises(SystemExit):
        cli.main(["evaluate", "--policy", "baseline:nope", "--suite", str(suite_file), "--level", "L1"],
                 make_env=make_env)
