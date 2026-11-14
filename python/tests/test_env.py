"""MarsX/Jezero-v1 environment: single env, NumPy-vectorised env, SB3 adapter (obs/1, act/1)."""

from __future__ import annotations

import math
from pathlib import Path

import numpy as np
import pytest

gym = pytest.importorskip("gymnasium")

from marsx.contracts import obs as obs_spec  # noqa: E402
from marsx.env import scenarios  # noqa: E402
from marsx.contracts.suite import EpisodeSpec  # noqa: E402
from marsx.env.core import NavBatch  # noqa: E402
from marsx.env.terrain import Terrain, cost_map, load_terrain, synthetic_terrain  # noqa: E402

REPO = Path(__file__).resolve().parents[2]
DATA = REPO / "data" / "processed" / "jezero-v1"


def flat_terrain(n=32, res=2.0) -> Terrain:
    z = np.zeros((n, n), np.float32)
    return Terrain(slope_deg=z.copy(), step_m=z.copy(), height_m=z.copy(), res_m=res, source="flat")


def make(terrain=None, n_envs=1, **kw) -> NavBatch:
    sc = scenarios.get("jezero-v1/l1/rtg-geometry")
    return NavBatch(terrain or flat_terrain(), sc, num_envs=n_envs, seed=0, **kw)


# ------------------------------------------------------------------ terrain / cost
def test_cost_map_blocks_steep_high_steps_and_nodata():
    t = flat_terrain(8)
    t.slope_deg[1, 1] = 30.0  # > 24 deg
    t.step_m[2, 2] = 0.6  # > 0.525 m wheel
    t.height_m[3, 3] = np.nan
    c = cost_map(t, max_slope_deg=24.0, max_step_m=0.525)
    assert np.isinf(c[1, 1]) and np.isinf(c[2, 2]) and np.isinf(c[3, 3])
    assert c[0, 0] == pytest.approx(1.0)


def test_synthetic_terrain_is_deterministic():
    a, b = synthetic_terrain(64, seed=3), synthetic_terrain(64, seed=3)
    np.testing.assert_array_equal(a.slope_deg, b.slope_deg)


@pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="processed dataset not built")
def test_load_real_plan_grid():
    t = load_terrain(DATA)
    assert t.slope_deg.shape == (1024, 1024) and t.res_m == pytest.approx(2.0)
    assert np.nanmax(t.slope_deg) <= 127.5 and np.isfinite(t.height_m).mean() > 0.5


# ------------------------------------------------------------------ dynamics
def test_observation_shape_dtype_and_range():
    env = make(n_envs=4)
    o = env.reset()
    assert o.shape == (4, obs_spec.OBS_DIM) and o.dtype == np.float32
    assert np.all(o >= -1.0) and np.all(o <= 1.0)


def test_move_east_accounts_distance_cost_and_time():
    env = make()
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 20)])
    _, r, term, trunc, _ = env.step(np.array([2]))  # E
    assert env.cell(0) == (10, 11)
    assert env.path_m[0] == pytest.approx(2.0)
    assert env.path_cost[0] == pytest.approx(1.0)
    assert env.t_s[0] == pytest.approx(2.0 / 0.042)
    assert not term[0] and not trunc[0]
    assert r[0] == pytest.approx(-0.1 * 1.0 + 0.3 * 1.0)


def test_move_into_known_hazard_is_refused_and_penalised():
    t = flat_terrain()
    t.slope_deg[10, 11] = 40.0
    env = make(t)
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 20)])
    _, r, term, _, _ = env.step(np.array([2]))
    assert env.cell(0) == (10, 10) and not term[0]
    assert r[0] == pytest.approx(-1.0)


def test_diagonal_corner_cutting_is_refused_like_marsx_nav():
    t = flat_terrain()
    t.slope_deg[9, 10] = 40.0  # north neighbour blocked -> NE diagonal must be refused
    env = make(t)
    env.reset_to([0], starts=[(10, 10)], goals=[(5, 15)])
    env.step(np.array([4]))  # NE
    assert env.cell(0) == (10, 10) and env.shield[0] == 1


def test_wait_keeps_position_and_advances_time():
    env = make()
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 20)])
    env.step(np.array([obs_spec.WAIT]))
    assert env.cell(0) == (10, 10) and env.t_s[0] > 0 and env.path_m[0] == 0


def test_reaching_goal_terminates_with_success():
    env = make(autoreset=False)
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 11)])
    _, r, term, _, info = env.step(np.array([2]))
    assert term[0] and info["outcome"][0] == "success"
    assert r[0] > 9


def test_hidden_rock_collision_terminates_and_sensor_reveals_only_nearby():
    rocks = np.zeros((32, 32), bool)
    rocks[10, 12] = True
    rocks[10, 15] = True  # 5 cells = 10 m away: outside the 8 m sensor radius
    env = make(rocks=rocks, sensor_radius_m=8.0, autoreset=False)
    o = env.reset_to([0], starts=[(10, 10)], goals=[(10, 20)])
    k, c = obs_spec.PATCH_K, obs_spec.PATCH_K // 2
    rock_ch = o[0, 3 * k * k: 4 * k * k].reshape(k, k)
    assert rock_ch[c, c + 2] == 1.0 and rock_ch[c, c + 5] == 0.0
    env.step(np.array([2]))
    _, _, term, _, info = env.step(np.array([2]))
    assert term[0] and info["outcome"][0] == "collision"


def test_truncation_at_max_steps():
    sc = scenarios.get("jezero-v1/l1/rtg-geometry").model_copy(update={"max_steps": 3})
    env = NavBatch(flat_terrain(), sc, num_envs=1, seed=0, autoreset=False)
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 30)])
    for _ in range(2):
        _, _, _, trunc, _ = env.step(np.array([obs_spec.WAIT]))
        assert not trunc[0]
    _, _, _, trunc, info = env.step(np.array([obs_spec.WAIT]))
    assert trunc[0] and info["outcome"][0] == "timeout"


def test_sampled_goals_are_reachable_and_in_distance_band():
    t = synthetic_terrain(96, seed=1)
    env = NavBatch(t, scenarios.get("jezero-v1/l1/rtg-geometry"), num_envs=256, seed=2, r_min=8, r_max=20)
    env.reset()
    s, g = env.start_cells(), env.goal_cells()
    d = np.hypot(*(s - g).T)
    assert np.all(d >= 8) and np.all(d <= 20)
    comp = env.components
    assert np.all(comp[s[:, 0], s[:, 1]] == comp[g[:, 0], g[:, 1]])


def test_same_step_autoreset_returns_final_obs():
    env = make(autoreset=True)
    env.reset_to([0], starts=[(10, 10)], goals=[(10, 11)])
    o, _, term, _, info = env.step(np.array([2]))
    assert term[0] and info["_final_obs"][0]
    assert not np.array_equal(info["final_obs"][0], o[0]) or env.cell(0) != (10, 11)


# ------------------------------------------------------------------ gymnasium API + parity
def test_gymnasium_make_and_env_checker():
    from gymnasium.utils.env_checker import check_env

    env = gym.make("marsx.env:MarsX/Jezero-v1", scenario="jezero-v1/l1/rtg-geometry", terrain="synthetic")
    check_env(env.unwrapped, skip_render_check=True)
    o, _ = env.reset(seed=0)
    assert o.shape == (obs_spec.OBS_DIM,)


def test_single_and_vector_envs_are_identical_for_same_seed_and_actions():
    single = gym.make("marsx.env:MarsX/Jezero-v1", terrain="synthetic").unwrapped
    vec = gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=1, vectorization_mode="vector_entry_point",
                       terrain="synthetic")
    o1, _ = single.reset(seed=7)
    o2, _ = vec.reset(seed=7)
    np.testing.assert_array_equal(o1, o2[0])
    rng = np.random.default_rng(0)
    for _ in range(50):
        a = int(rng.integers(0, 9))
        s1 = single.step(a)
        s2 = vec.step(np.array([a]))
        np.testing.assert_array_equal(s1[0], s2[0][0])
        assert s1[1] == pytest.approx(float(s2[1][0]))
        if s1[2] or s1[3]:
            break


def test_vector_env_runs_thousands_of_envs():
    vec = gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=2048, vectorization_mode="vector_entry_point",
                       terrain="synthetic")
    o, _ = vec.reset(seed=0)
    for _ in range(5):
        o, r, term, trunc, _ = vec.step(vec.action_space.sample())
    assert o.shape == (2048, obs_spec.OBS_DIM) and np.isfinite(r).all()


BENCH_INFO_KEYS = {"cell", "tS", "soc", "energyWh", "pathM", "outcome", "violations", "timeSlopeGt15S"}


def _vec(n=2, **kw):
    return gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=n, vectorization_mode="vector_entry_point",
                        terrain=flat_terrain(), **kw)


def test_vector_reset_with_explicit_episodes_and_bench_info_contract():
    vec = _vec()
    eps = [EpisodeSpec(index=0, seed=1, scenario_id="x", start=[10, 10], goal=[10, 12]),
           EpisodeSpec(index=1, seed=2, scenario_id="x", start=[5, 5], goal=[5, 25])]
    o, info = vec.reset(seed=[1, 2], options={"episodes": eps})
    assert o.shape == (2, obs_spec.OBS_DIM) and BENCH_INFO_KEYS <= set(info)
    np.testing.assert_array_equal(info["cell"], [[10, 10], [5, 5]])
    o, r, term, trunc, info = vec.step(np.array([2, 2]))
    assert BENCH_INFO_KEYS <= set(info)
    assert list(info["outcome"]) == ["", ""] and info["pathM"][0] == pytest.approx(2.0)
    assert info["energyWh"][0] > 0 and info["tS"][0] == pytest.approx(2.0 / 0.042)


def test_vector_next_step_autoreset_ignores_action_after_done():
    vec = _vec()
    eps = [{"index": 0, "seed": 1, "scenarioId": "x", "start": [10, 10], "goal": [10, 11]},
           {"index": 1, "seed": 2, "scenarioId": "x", "start": [5, 5], "goal": [5, 25]}]
    vec.reset(seed=0, options={"episodes": eps})
    _, _, term, _, info = vec.step(np.array([2, 2]))
    assert term[0] and info["outcome"][0] == "success" and info["outcome"][1] == ""
    _, r, term, trunc, info = vec.step(np.array([2, 2]))  # env 0 resets now; its action is ignored
    assert r[0] == 0 and not term[0] and not trunc[0] and info["outcome"][0] == ""
    assert info["pathM"][0] == 0 and info["pathM"][1] == pytest.approx(4.0)


def test_vector_reset_can_switch_scenario():
    vec = _vec(1)
    vec.reset(seed=0, options={"scenario": scenarios.get("jezero-v1/l1/astronaut-geometry"),
                               "episodes": [EpisodeSpec(index=0, seed=0, scenario_id="a", start=[3, 3], goal=[3, 9])]})
    assert vec.unwrapped.engine.kind == "astronaut"
    vec.step(np.array([2]))
    assert vec.unwrapped.engine.t_s[0] == pytest.approx(2.0 / 1.0)


def test_l3_scenario_generates_hidden_rocks_deterministically():
    t = synthetic_terrain(96, seed=0)
    sc = scenarios.get("jezero-v1/l3/rtg-hidden-rocks")
    a = NavBatch(t, sc, num_envs=1, rock_seed=5)
    b = NavBatch(t, sc, num_envs=1, rock_seed=5)
    assert a.rocks.any() and np.array_equal(a.rocks, b.rocks)
    assert not np.array_equal(a.rocks, NavBatch(t, sc, num_envs=1, rock_seed=6).rocks)


def test_sb3_adapter_reports_terminal_observation():
    pytest.importorskip("stable_baselines3")
    from marsx.sb3 import SB3VecAdapter

    venv = SB3VecAdapter(make(n_envs=2, autoreset=True))
    venv.engine.reset_to([0, 1], starts=[(10, 10), (5, 5)], goals=[(10, 11), (5, 25)])
    venv.reset_infos = [{} for _ in range(2)]
    venv.step_async(np.array([2, 2]))
    o, r, d, infos = venv.step_wait()
    assert d[0] and not d[1] and "terminal_observation" in infos[0]
    assert infos[0]["terminal_observation"].shape == (obs_spec.OBS_DIM,)
    assert math.isfinite(float(r.sum()))
