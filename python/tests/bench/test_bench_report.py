import pytest

from marsx.bench import policies as P
from marsx.bench import runner as R
from marsx.bench import scorecard as sc
from marsx.bench import suite as S
from marsx.bench import verify as V


@pytest.fixture
def suite(grid):
    return S.build_suite(lambda sid: grid, dataset_sha256="b" * 64,
                         plan={"L1": [("jezero-v1/l1/rtg-geometry", 6)], "L2": [("jezero-v1/l2/rtg-clear", 4)]},
                         bands_m=((6, 20), (20, 30)), max_oracle_steps=40)


def test_report_for_verified_astar_runs(suite, make_env):
    runs = [R.evaluate(suite, lv, P.AStarPolicy(), make_env, policy_name="baseline/astar", policy_kind="baseline")
            for lv in ("L1", "L2")]
    checks = [V.verify_run(r, suite, make_env) for r in runs]
    rep = sc.build_report(runs, checks, suite, suite_sha256="c" * 64)
    assert rep["schemaVersion"] == "scorecard/1"
    assert rep["program"] == "MARS-X First Filter (simulation)"
    assert rep["header"]["status"] == "Verified by re-simulation ✓"
    assert rep["header"]["model"] == "baseline/astar" and rep["header"]["suite"]["sha256"] == "c" * 64
    assert rep["verdict"]["precheck"]["passed"] is True
    lv = {v["level"]: v for v in rep["verdict"]["levels"]}
    assert lv["L1"]["passed"] and lv["L2"]["passed"] and not lv["L3"]["passed"]
    assert "not run" in lv["L3"]["reasons"][0]
    assert rep["verdict"]["seal"].startswith("Passed MARS-X First Filter · L2 · suite v0.1")
    assert rep["notCovered"] == list(sc.NOT_COVERED)
    assert "Not affiliated" in rep["disclaimer"]
    assert rep["reproducibility"]["rootSeed"] == 20261115
    assert "marsx evaluate" in rep["reproducibility"]["command"]


def test_report_not_verifiable_grants_nothing(suite, make_env):
    run = R.evaluate(suite, "L1", P.AStarPolicy(), make_env)
    bad = run.model_copy(update={"metrics": run.metrics.model_copy(update={"success": 0.5})})
    rep = sc.build_report([bad], [V.verify_run(bad, suite, make_env)], suite, suite_sha256="c" * 64)
    assert rep["header"]["status"] == "Not verifiable"
    assert rep["verdict"]["precheck"]["passed"] is False
    assert all(not v["passed"] for v in rep["verdict"]["levels"])
    assert rep["verdict"]["seal"] is None
