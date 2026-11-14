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
    train_eng = NavBatch(terrain, sc, a.envs, seed=a.seed, region=region(terrain.shape, True), r_min=10, r_max=60)
    test_eng = NavBatch(terrain, sc, 50, seed=a.seed + 1, autoreset=False, region=region(terrain.shape, False),
                        r_min=10, r_max=60)
    model = PPO("MlpPolicy", SB3VecAdapter(train_eng), n_steps=256, batch_size=4096, n_epochs=4, learning_rate=3e-4,
                gamma=0.99, gae_lambda=0.95, ent_coef=0.01, policy_kwargs={"net_arch": [128, 128]}, device="cpu",
                seed=a.seed, verbose=0)

    def act(o):
        return model.predict(o, deterministic=True)[0]

    curve, t0, done = [], time.perf_counter(), 0
    res = evaluate_policy(act, test_eng, a.eval_episodes, seed=1234)
    curve.append({"timesteps": 0, "minutes": 0.0, **{k: res[k] for k in ("success", "splCost", "medianCostRatio")}})
    print(json.dumps(curve[-1]), flush=True)
    while done < a.timesteps:
        chunk = min(a.eval_every, a.timesteps - done)
        model.learn(chunk, reset_num_timesteps=False)
        done += chunk
        res = evaluate_policy(act, test_eng, a.eval_episodes, seed=1234)
        curve.append({"timesteps": done, "minutes": round((time.perf_counter() - t0) / 60, 2),
                      **{k: res[k] for k in ("success", "splCost", "medianCostRatio")}})
        print(json.dumps(curve[-1]), flush=True)
    wall = time.perf_counter() - t0

    with (out / "learning_curve.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(curve[0]))
        w.writeheader()
        w.writerows(curve)
    onnx_path = export_onnx.export_logits(model.policy, out / "policy.onnx")
    card = export_onnx.policy_card(
        onnx_path, name=a.name, version=a.version, license="MIT", authors=["MARS-X team"],
        metrics={k: float(v) for k, v in {
            "successTest": res["success"], "successTestCi95Low": res["successCi95"][0],
            "splCostTest": res["splCost"], "medianCostRatioTest": res["medianCostRatio"],
            "testEpisodes": float(res["n"])}.items() if np.isfinite(v)},
        training=pc.TrainingInfo(algorithm="PPO", library="stable-baselines3 2.9.2", timesteps=done,
                                 wall_clock_s=round(wall, 1), seed=a.seed, suite_id=None, split="train"),
        intended_use=("Reference local-navigation policy for MARS-X L1 (geometry) on the Jezero 2 m planning grid: "
                      "a baseline to compare user models against, and a demo of real learning."),
        limitations=("Trained on synthetic start/goal pairs 20-120 m apart in the north part of the grid (rows < 768) "
                     "and evaluated on the unseen south part. Sees only an 11x11 local window (22 m): dead ends larger "
                     "than that cause failures; long routes need global waypoints (A*). Not trained with lighting, "
                     "energy, comms or hidden rocks (L2/L3). Not a flight-ready controller."))
    (out / "policy-card.json").write_text(card.model_dump_json(by_alias=True, indent=2, exclude_none=True) + "\n",
                                          encoding="utf-8")
    print("final", json.dumps({k: res[k] for k in ("n", "success", "successCi95", "splCost", "medianCostRatio",
                                                    "outcomes")}), flush=True)
    return res


if __name__ == "__main__":
    main()
