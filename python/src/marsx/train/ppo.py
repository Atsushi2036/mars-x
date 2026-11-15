"""Train the PPO reference policy on the real Jezero planning grid and export it as ONNX policy/1.

    uv run --project python --extra train python -m marsx.train.ppo --data data/processed/jezero-v1 \
        --timesteps 4000000 --out models/jezero-v1

Split by region: train on grid rows [0, 768) (north), evaluate on rows [768, 1024) (south, never seen).
CPU only (small MLP: GPU is slower on Windows for this size; see lessons learned). No SubprocVecEnv.
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

import numpy as np
import torch

from marsx.contracts import policy as pc
from marsx.env import scenarios
from marsx.env.core import NavBatch
from marsx.env.terrain import load_terrain
from marsx.sb3 import SB3VecAdapter
from marsx.train import export_onnx
from marsx.train.evaluate import evaluate_policy

SPLIT_ROW = 768


def region(shape, train: bool) -> np.ndarray:
    m = np.zeros(shape, bool)
    if train:
        m[:SPLIT_ROW] = True
    else:
        m[SPLIT_ROW:] = True
    return m


def main(argv=None) -> dict:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", default="data/processed/jezero-v1")
    ap.add_argument("--scenario", default="jezero-v1/l1/rtg-geometry")
    ap.add_argument("--timesteps", type=int, default=4_000_000)
    ap.add_argument("--envs", type=int, default=64)
    ap.add_argument("--eval-every", type=int, default=1_000_000)
    ap.add_argument("--eval-episodes", type=int, default=200)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--r-min", type=float, default=10, help="goal distance band, cells (2 m)")
    ap.add_argument("--r-max", type=float, default=60)
    ap.add_argument("--time-weight", type=float, default=1.0,
                    help="reward.time used for training: without it WAIT is free and the policy learns to stand still")
    ap.add_argument("--out", default="models/jezero-v1")
    ap.add_argument("--name", default="marsx/ppo-l1-reference")
    ap.add_argument("--version", default="0.1.0")
    a = ap.parse_args(argv)

    from stable_baselines3 import PPO

    torch.set_num_threads(4)
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    terrain = load_terrain(a.data)
    sc = scenarios.get(a.scenario)
    sc = sc.model_copy(update={"reward": sc.reward.model_copy(update={"time": a.time_weight})})
    train_eng = NavBatch(terrain, sc, a.envs, seed=a.seed, region=region(terrain.shape, True), r_min=a.r_min,
                         r_max=a.r_max)
    test_eng = NavBatch(terrain, sc, 50, seed=a.seed + 1, autoreset=False, region=region(terrain.shape, False),
                        r_min=a.r_min, r_max=a.r_max)
    model = PPO("MlpPolicy", SB3VecAdapter(train_eng), n_steps=256, batch_size=4096, n_epochs=4, learning_rate=3e-4,
                gamma=0.99, gae_lambda=0.95, ent_coef=0.01, policy_kwargs={"net_arch": [128, 128]}, device="cpu",
                seed=a.seed, verbose=0)

    def act(o):
        return model.predict(o, deterministic=True)[0]

    curve, t0, done = [], time.perf_counter(), 0
    onnx_path = out / "policy.onnx"
    best = None  # (success, splCost, timesteps, res): the best checkpoint is exported as ONNX (no pickle)

    def record(res):
        nonlocal best
        curve.append({"timesteps": done, "minutes": round((time.perf_counter() - t0) / 60, 2),
                      **{k: res[k] for k in ("success", "splCost", "medianCostRatio")}})
        print(json.dumps(curve[-1]), flush=True)
        key = (res["success"], res["splCost"])
        if done > 0 and (best is None or key > best[:2]):
            export_onnx.export_logits(model.policy, onnx_path)
            best = (*key, done, res)
            print(f"checkpoint: exported best policy at {done} steps", flush=True)

    record(evaluate_policy(act, test_eng, a.eval_episodes, seed=1234))
    while done < a.timesteps:
        chunk = min(a.eval_every, a.timesteps - done)
        model.learn(chunk, reset_num_timesteps=False)
        done += chunk
        record(evaluate_policy(act, test_eng, a.eval_episodes, seed=1234))
    wall = time.perf_counter() - t0
    if best is None:
        raise SystemExit("no checkpoint was exported")
    res = best[3]

    with (out / "learning_curve.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(curve[0]))
        w.writeheader()
        w.writerows(curve)
    card = export_onnx.policy_card(
        onnx_path, name=a.name, version=a.version, license="MIT", authors=["MARS-X team"],
        metrics={k: float(v) for k, v in {
            "successTest": res["success"], "successTestCi95Low": res["successCi95"][0],
            "splCostTest": res["splCost"], "medianCostRatioTest": res["medianCostRatio"],
            "testEpisodes": float(res["n"])}.items() if np.isfinite(v)},
        training=pc.TrainingInfo(algorithm="PPO", library="stable-baselines3 2.9.2", timesteps=best[2],
                                 wall_clock_s=round(wall, 1), seed=a.seed, suite_id=None, split="train"),
        intended_use=(f"Reference local-navigation policy for MARS-X, trained on scenario {a.scenario} on the Jezero "
                      "2 m planning grid: a baseline to compare user models against, and a demo of real learning."),
        limitations=(f"Trained on random start/goal pairs {2 * a.r_min:.0f}-{2 * a.r_max:.0f} m apart in the north part of "
                     "the grid (rows < 768); test metrics are on the unseen south part with the same distance band. "
                     "Sees only an 11x11 local window (22 m): dead ends larger than that cause failures; long routes "
                     "need global waypoints (A*). Other agents/conditions than the training scenario are out of "
                     "distribution. Not a flight-ready controller."))
    (out / "policy-card.json").write_text(card.model_dump_json(by_alias=True, indent=2, exclude_none=True) + "\n",
                                          encoding="utf-8")
    test_eng.seed(7)
    export_onnx.write_golden(onnx_path, np.round(test_eng.reset()[:16], 7), out / "golden.json")  # web parity fixture
    print("final", json.dumps({k: res[k] for k in ("n", "success", "successCi95", "splCost", "medianCostRatio",
                                                    "outcomes")}), flush=True)
    return res


if __name__ == "__main__":
    main()
