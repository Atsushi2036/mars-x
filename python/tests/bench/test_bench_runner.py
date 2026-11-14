import json

import numpy as np
import pytest

from marsx.bench import policies as P
from marsx.bench import runner as R
from marsx.bench import suite as S
from marsx.contracts import traj
from marsx.contracts.obs import WAIT
from marsx.contracts.run import MAX_BYTES, Run


@pytest.fixture
def small_suite(grid):
    return S.build_suite(lambda sid: grid, dataset_sha256="b" * 64,
                         plan={"L1": [("jezero-v1/l1/rtg-geometry", 6)]},
                         bands_m=((6, 20), (20, 30)), max_oracle_steps=40)


def run_l1(small_suite, make_env, policy, **kw):
    return R.run_episodes(S.level_episodes(small_suite, "L1"), policy, make_env, **kw)


def test_astar_policy_succeeds_with_oracle_length(small_suite, make_env, grid):
    results = run_l1(small_suite, make_env, P.AStarPolicy())
    assert [r.outcome for r in results] == ["success"] * 6
    for r, spec in zip(results, S.level_episodes(small_suite, "L1")):
        assert r.path_m == pytest.approx(spec.oracle_path_m, abs=1e-6)
        assert r.oracle.path_m == spec.oracle_path_m
        assert r.index == spec.index and r.seed == spec.seed and r.scenario_id == spec.scenario_id


def test_trajectory_convention_states_then_actions(small_suite, make_env):
    r = run_l1(small_suite, make_env, P.AStarPolicy())[0]
    a = traj.decode(r.trajectory)
    assert len(a) == r.steps + 1
    assert [int(a.row[0]), int(a.col[0])] == r.start
    assert [int(a.row[-1]), int(a.col[-1])] == r.goal
    assert int(a.action[-1]) == WAIT and a.t_s[0] == 0
    assert np.all(np.diff(a.t_s.astype(np.int64)) >= 0)


def test_random_policy_is_deterministic(small_suite, make_env):
    a = run_l1(small_suite, make_env, P.RandomPolicy(seed=1))
    b = run_l1(small_suite, make_env, P.RandomPolicy(seed=1))
    assert [x.model_dump() for x in a] == [y.model_dump() for y in b]


def test_batching_does_not_change_results(small_suite, make_env):
    a = run_l1(small_suite, make_env, P.AStarPolicy(), batch_size=2)
    b = run_l1(small_suite, make_env, P.AStarPolicy(), batch_size=64)
    assert [x.model_dump() for x in a] == [y.model_dump() for y in b]


def test_episode_seeds_are_passed_to_env(small_suite, grid):
    envs = []

    def factory(scenario, n):
        from conftest import FakeNavBatch

        envs.append(FakeNavBatch(grid, n))
        return envs[-1]

    run_l1(small_suite, factory, P.AStarPolicy())
    assert envs[0].seeds_seen[0] == [e.seed for e in S.level_episodes(small_suite, "L1")]
    assert envs[0].num_envs == 6


def test_collision_outcome_is_recorded(small_suite, grid):
    from conftest import FakeNavBatch

    rocks = np.zeros(grid.shape, bool)
    spec = S.level_episodes(small_suite, "L1")[0]
    path = P.astar_path(grid, spec.start, spec.goal)
    rocks[tuple(path[1])] = True
    res = R.run_episodes([spec], P.AStarPolicy(), lambda sc, n: FakeNavBatch(grid, n, rocks=rocks))
    assert res[0].outcome == "collision" and res[0].steps == 1


def test_evaluate_builds_a_valid_run(small_suite, make_env):
    run = R.evaluate(small_suite, "L1", P.AStarPolicy(), make_env, policy_name="baseline/astar",
                     policy_kind="baseline")
    assert isinstance(run, Run)
    doc = R.run_to_json(run)
    assert len(doc.encode()) < MAX_BYTES
    again = Run.model_validate_json(doc)
    assert again == run
    assert run.metrics.n == 6 and run.metrics.success == 1.0
    assert run.scorecard.passed == {"L1": True}
    assert run.suite.level == "L1" and run.suite.root_seed == 20261115
    assert run.dataset.sha256 == "b" * 64
    assert run.scenario.id == "jezero-v1/l1/rtg-geometry"
    assert run.scenario.sha256 == S.scenario_sha256("jezero-v1/l1/rtg-geometry")
    assert run.conditions.gravity == pytest.approx(3.694, abs=1e-3)
    assert json.loads(doc)["schemaVersion"] == "run/1"


def test_oracle_energy_comes_from_replaying_the_oracle_in_the_env(small_suite, make_env):
    run = R.evaluate(small_suite, "L1", P.RandomPolicy(seed=3), make_env)
    for e, s in zip(run.episodes, S.level_episodes(small_suite, "L1")):
        # the fake env charges 0.5 Wh per metre
        assert e.oracle.energy_wh == pytest.approx(0.5 * s.oracle_path_m, abs=1e-6)
    astar = R.evaluate(small_suite, "L1", P.AStarPolicy(), make_env)
    assert astar.metrics.energy_ratio == pytest.approx(1.0)


def test_astar_replan_avoids_rocks_revealed_by_the_sensor(small_suite, grid):
    from conftest import FakeNavBatch

    specs = S.level_episodes(small_suite, "L1")
    rocks = np.zeros(grid.shape, bool)
    for spec in specs:
        path = P.astar_path(grid, spec.start, spec.goal)
        if len(path) > 3:
            rocks[tuple(path[len(path) // 2])] = True
    for spec in specs:  # never block start or goal
        rocks[tuple(spec.start)] = rocks[tuple(spec.goal)] = False
    factory = lambda sc, n: FakeNavBatch(grid, n, rocks=rocks)
    blind = R.run_episodes(specs, P.AStarPolicy(), factory, oracle_energy=False)
    replan = R.run_episodes(specs, P.AStarReplanPolicy(), factory, oracle_energy=False)
    assert any(r.outcome == "collision" for r in blind)
    assert all(r.outcome == "success" for r in replan)
