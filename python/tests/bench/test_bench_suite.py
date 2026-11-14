import numpy as np
import pytest

from marsx.bench import suite as S
from marsx.contracts.scenario import Scenario
from marsx.contracts.suite import Suite
from marsx.nav import astar


def flat_cost(n=96):
    c = np.ones((n, n), np.float32)
    c[40:44, 60:80] = np.inf  # a wall inside the test quadrant
    return c


def test_plan_matches_t5_episode_counts():
    plan = S.LEVEL_PLAN
    assert sum(n for _, n in plan["L1"]) == 600
    assert [n for _, n in plan["L2"]] == [200, 200, 200, 200]
    assert sum(n for _, n in plan["L3"]) == 600
    assert all(n >= 20 for _, n in plan["L3"])  # PO: n >= 20 per family


def test_all_suite_scenarios_are_valid_contract_objects():
    for level, fams in S.LEVEL_PLAN.items():
        for sid, _ in fams:
            sc = S.scenario(sid)
            assert isinstance(sc, Scenario) and sc.level == level and sc.id == sid
            assert sid.startswith(f"jezero-v1/{level.lower()}/")
    assert [sid for sid, _ in S.LEVEL_PLAN["L2"]] == [
        "jezero-v1/l2/rtg-storm", "jezero-v1/l2/solar-clear", "jezero-v1/l2/solar-storm", "jezero-v1/l2/astronaut-clear"]
    assert S.scenario("jezero-v1/l3/astronaut-storm").conditions.spe.enabled
    assert S.scenario("jezero-v1/l3/rtg-clear").conditions.hidden_rocks.enabled
    assert S.scenario("jezero-v1/l3/rtg-clear").conditions.comm.mode == "one_plan_per_sol"


def test_scenario_hash_is_stable():
    assert S.scenario_sha256("jezero-v1/l1/rtg-geometry") == S.scenario_sha256("jezero-v1/l1/rtg-geometry")
    assert len(S.scenario_sha256("jezero-v1/l1/rtg-geometry")) == 64


def test_train_and_test_regions_are_disjoint_and_cover_with_guard():
    test = S.region_mask((96, 96), "test")
    train = S.region_mask((96, 96), "train")
    assert not np.any(test & train)
    assert 0.15 < test.mean() < 0.30
    assert train.mean() > 0.5


def test_generated_episodes_are_deterministic_feasible_and_in_region():
    cost = flat_cost()
    kw = {"n": 12, "seed": 123, "split": "test", "res_m": 2.0, "bands_m": ((10, 30), (30, 60)), "max_oracle_steps": 80}
    a = S.generate_episodes(cost, "jezero-v1/l1/rtg-geometry", **kw)
    b = S.generate_episodes(cost, "jezero-v1/l1/rtg-geometry", **kw)
    assert [e.model_dump() for e in a] == [e.model_dump() for e in b]
    mask = S.region_mask(cost.shape, "test")
    for i, e in enumerate(a):
        d_m = 2.0 * float(np.hypot(e.start[0] - e.goal[0], e.start[1] - e.goal[1]))
        lo, hi = kw["bands_m"][i % 2]
        assert lo <= d_m <= hi
        assert mask[tuple(e.start)] and mask[tuple(e.goal)]
        # The oracle is optimal on the full map the agent can drive (only start/goal are region-bound).
        res = astar(cost, tuple(e.start), tuple(e.goal))
        assert e.oracle_cost == pytest.approx(round(res.cost, 6))
        assert len(res.path) - 1 <= 80
        assert e.oracle_path_m > 0


def test_build_suite_produces_valid_versioned_suite():
    cost = flat_cost()
    counts = {"L1": [("jezero-v1/l1/rtg-geometry", 4)],
              "L2": [("jezero-v1/l2/rtg-storm", 3)],
              "L3": [("jezero-v1/l3/rtg-clear", 2)]}
    suite = S.build_suite(lambda sid: cost, dataset_sha256="a" * 64, plan=counts,
                          bands_m=((10, 30),), max_oracle_steps=80)
    assert isinstance(suite, Suite)
    assert suite.id == "jezero-v1" and suite.root_seed == 20261115 and suite.split == "test"
    assert [lv.episodes for lv in suite.levels] == [4, 3, 2]
    assert [e.index for e in suite.episodes] == list(range(9))
    assert len({e.seed for e in suite.episodes}) == 9
    again = S.build_suite(lambda sid: cost, dataset_sha256="a" * 64, plan=counts,
                          bands_m=((10, 30),), max_oracle_steps=80)
    assert again.model_dump() == suite.model_dump()


def test_save_and_load_roundtrip(tmp_path):
    cost = flat_cost()
    suite = S.build_suite(lambda sid: cost, dataset_sha256=None, plan={"L1": [("jezero-v1/l1/rtg-geometry", 2)]},
                          bands_m=((10, 30),), max_oracle_steps=80)
    p = tmp_path / "suite.json"
    S.save_suite(suite, p)
    assert S.load_suite(p) == suite
    assert S.suite_sha256(p) == S.suite_sha256(p)


def test_level_episodes_selects_by_level():
    cost = flat_cost()
    suite = S.build_suite(lambda sid: cost, dataset_sha256=None,
                          plan={"L1": [("jezero-v1/l1/rtg-geometry", 2)], "L2": [("jezero-v1/l2/rtg-storm", 3)]},
                          bands_m=((10, 30),), max_oracle_steps=80)
    assert len(S.level_episodes(suite, "L2")) == 3
    assert all(e.scenario_id == "jezero-v1/l2/rtg-storm" for e in S.level_episodes(suite, "L2"))


def test_oracle_may_leave_the_test_region_when_cheaper():
    cost = np.full((96, 96), 5.0, np.float32)
    cost[:, 40:50] = 1.0  # cheap corridor in the train region, west of the test quadrant
    cost[50:56, :] = 1.0
    eps = S.generate_episodes(cost, "jezero-v1/l1/rtg-geometry", n=6, seed=5, bands_m=((20, 60),),
                              max_oracle_steps=200)
    for e in eps:
        full = astar(cost, tuple(e.start), tuple(e.goal))
        assert e.oracle_cost == pytest.approx(round(full.cost, 6))


def test_suite_hash_ignores_line_endings(tmp_path):
    suite = S.build_suite(lambda sid: flat_cost(), dataset_sha256=None, plan={"L1": [("jezero-v1/l1/rtg-geometry", 2)]},
                          bands_m=((10, 30),), max_oracle_steps=80)
    p = tmp_path / "suite.json"
    S.save_suite(suite, p)
    crlf = tmp_path / "crlf.json"
    crlf.write_bytes(p.read_bytes().replace(b"\n", b"\r\n"))
    assert S.suite_sha256(p) == S.suite_sha256(crlf)


def test_suite_scenarios_reuse_env_builtins():
    from marsx.env import scenarios as env_scenarios

    for sid in ("jezero-v1/l1/rtg-geometry", "jezero-v1/l2/solar-clear", "jezero-v1/l2/rtg-storm"):
        assert S.scenario(sid) == env_scenarios.get(sid)
    l3 = S.scenario("jezero-v1/l3/solar-storm")
    base = env_scenarios.get("jezero-v1/l2/solar-storm")
    assert l3.agent == base.agent and l3.time == base.time and l3.conditions.tau == base.conditions.tau
    assert l3.time is not None
