"""T6: ONNX policy/1 export + ADR-0007 validation, policy card, tabular Q-learning, evaluation vs oracle."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("stable_baselines3")
onnx = pytest.importorskip("onnx")
ort = pytest.importorskip("onnxruntime")

from marsx.contracts import obs as spec
from marsx.contracts import policy
from marsx.env import scenarios
from marsx.env.core import NavBatch
from marsx.env.terrain import cost_map, synthetic_terrain
from marsx.nav.core import dijkstra_cost_to_goal
from marsx.train import export_onnx, qlearn
from marsx.train.evaluate import evaluate_policy


@pytest.fixture(scope="module")
def tiny_model():
    from marsx.sb3 import SB3VecAdapter
    from stable_baselines3 import PPO

    eng = NavBatch(synthetic_terrain(64, 0), scenarios.get("jezero-v1/l1/rtg-geometry"), num_envs=4, seed=0)
    return PPO("MlpPolicy", SB3VecAdapter(eng), n_steps=16, batch_size=32, policy_kwargs={"net_arch": [32, 32]},
               device="cpu", seed=0)


def test_export_is_gemm_tanh_only_with_metadata_and_dynamic_batch(tmp_path, tiny_model):
    path = tmp_path / "policy.onnx"
    export_onnx.export_logits(tiny_model.policy, path)
    m = onnx.load(str(path))
    assert {n.op_type for n in m.graph.node} <= {"Gemm", "Tanh"}
    meta = {p.key: p.value for p in m.metadata_props}
    assert meta == policy.METADATA
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    x = np.random.default_rng(0).uniform(-1, 1, (7, spec.OBS_DIM)).astype(np.float32)
    logits = sess.run(["logits"], {"obs": x})[0]
    assert logits.shape == (7, spec.N_ACTIONS)
    sb3_actions, _ = tiny_model.predict(x, deterministic=True)
    np.testing.assert_array_equal(logits.argmax(1), sb3_actions)


def test_validator_accepts_export_and_rejects_forbidden_ops(tmp_path, tiny_model):
    path = tmp_path / "policy.onnx"
    export_onnx.export_logits(tiny_model.policy, path)
    report = export_onnx.validate(path)
    assert report.ops == ["Gemm", "Tanh"] and policy.OPSET_MIN <= report.opset <= policy.OPSET_MAX
    m = onnx.load(str(path))
    m.graph.node.append(onnx.helper.make_node("Loop", inputs=[], outputs=["x"]))
    bad = tmp_path / "bad.onnx"
    onnx.save(m, str(bad))
    with pytest.raises(ValueError, match="Loop"):
        export_onnx.validate(bad)


def test_policy_card_validates(tmp_path, tiny_model):
    path = tmp_path / "policy.onnx"
    export_onnx.export_logits(tiny_model.policy, path)
    card = export_onnx.policy_card(path, name="test/ppo", version="0.0.1", intended_use="test",
                                   limitations="test", metrics={"successTest": 0.5})
    assert policy.PolicyCard.model_validate(card.model_dump(by_alias=True)).onnx_bytes == path.stat().st_size


def test_qlearning_reaches_near_oracle_on_small_map():
    t = synthetic_terrain(24, seed=4)
    cost = cost_map(t, 24.0, 0.525)
    free = np.argwhere(np.isfinite(cost))
    start, goal = tuple(free[0]), tuple(free[-1])
    oracle = dijkstra_cost_to_goal(cost, goal)[start]
    assert np.isfinite(oracle)
    q, curve = qlearn.train(cost, start, goal, episodes=20000, seed=0)
    path_cost = qlearn.greedy_cost(q, cost, start, goal)
    assert path_cost <= 1.10 * oracle
    assert len(curve) > 0


def test_evaluate_reports_success_and_oracle_ratio(tiny_model):
    eng = NavBatch(synthetic_terrain(64, 1), scenarios.get("jezero-v1/l1/rtg-geometry"), num_envs=8, seed=3,
                   autoreset=False, r_min=5, r_max=10)
    res = evaluate_policy(lambda o: tiny_model.predict(o, deterministic=True)[0], eng, episodes=8, seed=3)
    assert 0.0 <= res["success"] <= 1.0 and res["n"] == 8
    assert all(r >= 1.0 - 1e-9 for r in res["costRatios"])


def test_qlearning_greedy_path_reaches_goal_and_converts_to_actions():
    t = synthetic_terrain(24, seed=4)
    cost = cost_map(t, 24.0, 0.525)
    free = np.argwhere(np.isfinite(cost))
    start, goal = tuple(free[0]), tuple(free[-1])
    q, _ = qlearn.train(cost, start, goal, episodes=20000, seed=0)
    path = qlearn.greedy_path(q, cost, start, goal)
    assert path is not None and tuple(path[0]) == start and tuple(path[-1]) == goal


def test_qlearning_bench_policy_solves_short_episode():
    from marsx.contracts.suite import EpisodeSpec
    from marsx.env.vector import JezeroVecEnv
    from marsx.train.qlearn_policy import QLearningPolicy

    env = JezeroVecEnv(num_envs=1, terrain=synthetic_terrain(48, seed=2))
    free = np.argwhere(np.isfinite(env.engine.cost))
    s = free[len(free) // 2]
    g = next(c for c in free if 6 <= np.hypot(*(c - s)) <= 10)
    spec_ = EpisodeSpec(index=0, seed=0, scenario_id="x", start=s.tolist(), goal=g.tolist())
    obs, _ = env.reset(seed=0, options={"episodes": [spec_]})
    pol = QLearningPolicy(episodes=6000, seed=0)
    pol.begin([spec_], env)
    for _ in range(200):
        obs, _, term, trunc, info = env.step(pol.act(obs))
        if term[0] or trunc[0]:
            break
    assert info["outcome"][0] == "success"
