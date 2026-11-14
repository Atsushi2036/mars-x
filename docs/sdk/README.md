# MARS-X SDK: bring your own model

MARS-X is a **first-filter test bench** for planetary autonomy: you run *your* navigation model on real Jezero
terrain (HiRISE-derived 2 m planning grid) under documented Mars conditions, get a reproducible `run.json` +
scorecard, and, if it passes, export the scenario to higher-fidelity simulators.

> Simulation only. Not affiliated with or endorsed by NASA, JPL or Caltech. Passing MARS-X does not make a
> controller flight-ready; it means it is worth testing in a higher-fidelity simulator.

## 1. Install

```bash
pip install "marsx[train] @ git+https://github.com/Atsushi2036/mars-x#subdirectory=python"
# from a clone: uv sync --project python --extra train
```

The processed dataset (`manifest.json` + raw layers) is not in the wheel. Point `MARSX_DATA` at it
(`data/processed/jezero-v1`) or pass `terrain=<path>`. `terrain="synthetic"` gives a small deterministic map for
quick tests and CI.

## 2. The environment (Gymnasium 1.x)

```python
import gymnasium as gym

env = gym.make("marsx.env:MarsX/Jezero-v1", scenario="jezero-v1/l1/rtg-geometry")
obs, info = env.reset(seed=0)
obs, reward, terminated, truncated, info = env.step(env.action_space.sample())

# thousands of episodes per call, one process (NumPy data parallelism, no subprocesses)
vec = gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=4096, vectorization_mode="vector_entry_point")
```

- Measured on a laptop CPU (real 1024² grid, random actions): ~180–200 k agent-steps/s for 256–16 384 envs.
- Vector env: autoreset `NEXT_STEP`; `reset(options={"episodes": [EpisodeSpec, ...], "scenario": ...})` pins
  start/goal per env. `info` carries per-env arrays: `cell, tS, soc, energyWh, pathM, outcome, violations,
  timeSlopeGt15S, pathCost, shieldInterventions`.
- Training with Stable-Baselines3: `marsx.sb3.SB3VecAdapter(NavBatch(...))`. Do **not** use `SubprocVecEnv` on
  Windows (slower for this cheap env, and `WinError 1455` with CUDA torch).

### Scenarios (`marsx.env.scenarios.ids()`)

| id | level | what it adds |
|---|---|---|
| `jezero-v1/l1/rtg-geometry` | L1 | Perseverance-like rover limits: slope ≤ 24°, step ≤ 0.525 m, 0.042 m/s |
| `jezero-v1/l1/astronaut-geometry` | L1 | astronaut: slope ≤ 15°, 1 m/s (assumptions) |
| `jezero-v1/l2/solar-clear` | L2 | sun (Mars24), insolation with horizon shadows, solar energy; clear aphelion sol (tau 0.5, assumption) |
| `jezero-v1/l2/solar-storm` | L2 | same in the Jan-2022 regional dust storm (tau 2.0, Lemmon et al. 2022) |
| `jezero-v1/l2/rtg-storm` | L2 | RTG rover (110 W) in the storm |
| `jezero-v1/l2/astronaut-clear` | L2 | EVA consumables (4 h) + space-weather alert: return to shelter within 30 min |
| `jezero-v1/l3/rtg-hidden-rocks` | L3 | rocks below DEM resolution (Golombek-Rapp), revealed by an 8 m sensor |
| `jezero-v1/l3/rtg-onesol` | L3 | hidden rocks + one plan per sol (comms) |

Every number in a scenario is a `Param` with `provenance` = `source` (cited), `computed` or `assumption`.

## 3. Observation `obs/1` and action `act/1`

Flat `float32[505]` (layout in `packages/schemas/obs-v1.layout.json`):

| block | size | content |
|---|---|---|
| terrain | 4×11×11 | local 22 m window: cost, known hazard, relative elevation, revealed rocks |
| goal | 4 | dRow/64, dCol/64, unit vector to goal |
| agent | 4 | state of charge, slip estimate, sin/cos heading |
| environment | 8 | sin(sun elevation), sin/cos sun azimuth, sin/cos LTST, temperature, tau, wind |
| comm | 3 | link available, time to next uplink (sols), one-way light time / 22 min |
| time | 2 | sol fraction left, steps fraction left |

Actions `Discrete(9)`: `N, S, E, W, NE, NW, SE, SW, WAIT` (rows grow southwards; one step = 2 m or 2.83 m).
Moves into known hazards and diagonal corner cuts are refused (and counted as shield interventions).

## 4. Policy contract `policy/1` (ONNX)

- Input `obs` float32 `[batch, 505]` → output `logits` float32 `[batch, 9]`; action = argmax.
- `metadata_props`: `marsx.contract=policy/1`, `marsx.obs_spec=obs/1`, `marsx.act_spec=act/1`.
- Allowed: `ai.onnx` domain only, opset 17–21, no external data, ≤ 2 000 nodes, ≤ 20 MB, **no Loop/Scan/If**.
  The same rules run in the browser before a dropped model is executed (ADR-0007).
- Export an SB3 PPO actor with Gemm/Tanh only:

```python
from marsx.train import export_onnx
export_onnx.export_logits(model.policy, "policy.onnx")   # dynamo exporter, dynamic batch
report = export_onnx.validate("policy.onnx")             # raises ValueError on the first violation
card = export_onnx.policy_card("policy.onnx", name="uni-x/ppo", version="1.0.0",
                               intended_use="...", limitations="...")
```

## 5. Evaluate and get a scorecard

```bash
marsx evaluate --policy policy.onnx --level L1 --data data/processed/jezero-v1 --out runs/
marsx scorecard runs/*.json --data data/processed/jezero-v1        # verifies runs by re-simulation
marsx evaluate --policy baseline:astar --level L1                   # oracle-style baseline to compare
```

v0.1 pass thresholds (product decision): L1 success ≥ 80 %, L2 success ≥ 70 %, L3 Wilson-95 lower bound ≥ 60 %
with n ≥ 20. `run.json` (`run/1`) is one file with hashes of the dataset, scenario and policy; drop it on the web
app to replay the trajectories in 3D.

## 6. Reference policy and learning

- `python -m marsx.train.ppo --timesteps 4000000 --out models/jezero-v1`: PPO trained on the north of the grid
  (rows < 768) and evaluated on the unseen south; writes `policy.onnx`, `policy-card.json`, `learning_curve.csv`.
- `marsx.train.qlearn`: tabular Q-learning (fixed start/goal, real learning, does not generalise) — the same
  algorithm as the in-browser AI Lab.
- Honest framing: A* plans (it does not learn); Q-learning learns one route; PPO learns a local policy that
  generalises to unseen terrain. Perseverance works the same way at a high level: global route from orbital data,
  local hazard avoidance on board.
