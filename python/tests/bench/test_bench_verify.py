import base64

import pytest

from marsx.bench import policies as P
from marsx.bench import runner as R
from marsx.bench import suite as S
from marsx.bench import verify as V
from marsx.contracts import traj
from marsx.contracts.canonical import sha256_bytes


@pytest.fixture
def suite(grid):
    return S.build_suite(lambda sid: grid, dataset_sha256="b" * 64,
                         plan={"L1": [("jezero-v1/l1/rtg-geometry", 6)]},
                         bands_m=((6, 20), (20, 30)), max_oracle_steps=40)


@pytest.fixture
def run(suite, make_env):
    return R.evaluate(suite, "L1", P.AStarPolicy(), make_env, policy_name="baseline/astar", policy_kind="baseline")


def test_honest_run_is_verified(run, suite, make_env):
    v = V.verify_run(run, suite, make_env)
    assert v.status == V.VERIFIED and v.reasons == []
    assert v.metrics == run.metrics


def test_tampered_metrics_are_not_verifiable(run, suite, make_env):
    bad = run.model_copy(update={"metrics": run.metrics.model_copy(update={"success": 0.99})})
    v = V.verify_run(bad, suite, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("metrics" in r for r in v.reasons)


def test_self_reported_outcome_that_the_actions_do_not_reproduce(run, suite, make_env):
    eps = list(run.episodes)
    # Replace the actions of episode 0 with WAITs but keep the claimed success.
    a = traj.decode(eps[0].trajectory)
    a.action[:] = 8
    eps[0] = eps[0].model_copy(update={"trajectory": traj.encode(a)})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("episode 0" in r for r in v.reasons)


def test_cherry_picked_episode_set_is_rejected(run, suite, make_env):
    v = V.verify_run(run.model_copy(update={"episodes": run.episodes[1:]}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("episode set" in r for r in v.reasons)
    eps = list(run.episodes)
    eps[0] = eps[0].model_copy(update={"goal": list(eps[0].start)})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE


def test_missing_trajectory_is_not_verifiable(run, suite, make_env):
    eps = list(run.episodes)
    eps[2] = eps[2].model_copy(update={"trajectory": None})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("trajectory" in r for r in v.reasons)


def test_corrupted_trajectory_bytes_are_not_verifiable(run, suite, make_env):
    eps = list(run.episodes)
    raw = bytearray(base64.b64decode(eps[1].trajectory.data))
    raw[0] ^= 1
    blk = eps[1].trajectory.model_copy(update={"data": base64.b64encode(bytes(raw)).decode()})
    eps[1] = eps[1].model_copy(update={"trajectory": blk})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE
    blk2 = blk.model_copy(update={"sha256": sha256_bytes(bytes(raw))})
    eps[1] = eps[1].model_copy(update={"trajectory": blk2})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE


def test_suite_mismatch_is_not_verifiable(run, suite, make_env):
    other = suite.model_copy(update={"version": "9.9.9"})
    v = V.verify_run(run, other, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("suite" in r for r in v.reasons)


def test_label_text():
    assert V.label(V.VERIFIED) == "Verified by re-simulation ✓"
    assert V.label(V.NOT_VERIFIABLE) == "Not verifiable"


def test_tampered_oracle_energy_is_not_verifiable(run, suite, make_env):
    eps = list(run.episodes)
    eps[0] = eps[0].model_copy(update={"oracle": eps[0].oracle.model_copy(update={"energy_wh": 1e6})})
    v = V.verify_run(run.model_copy(update={"episodes": eps}), suite, make_env)
    assert v.status == V.NOT_VERIFIABLE and any("oracle" in r for r in v.reasons)
