# My first model — a "bring your own model" example

A small PPO navigation policy trained with the MARS-X SDK in ~5 minutes of laptop CPU, exported as an ONNX
`policy/1` model and evaluated on the official `jezero-v1` suite. It is deliberately different from (and weaker
than) the reference policy in `models/jezero-v1/`, so you can compare both in the scorecard.

> Simulation only. Not affiliated with or endorsed by NASA, JPL or Caltech.

## Files

| file | what it is |
|---|---|
| `my-model.onnx` | the policy: `obs` float32[N, 505] → `logits` float32[N, 9] (Gemm/Tanh only, 342 KB) |
| `my-model.card.json` | policy card (`policyCard/1`): sha256, training settings, metrics, limitations |
| `my-model.L1.run.json`, `my-model.L2.run.json` | official evaluation runs (`run/1`), one trajectory per episode |
| `my-model.scorecard.json` | scorecard, verified by re-simulating every episode |
| `my-model.golden.json` | parity fixture: observations + logits from onnxruntime (Python) for this exact model |
| `my-model.learning_curve.csv` | success / SPL on the held-out south region during training |

## Results

| | success | notes |
|---|---|---|
| held-out region, training distribution (100 episodes, 40–700 m) | 0.94 [0.875, 0.972] | SPL 0.855, median cost 1.09× optimal |
| official suite L1 (600 episodes) | 0.530 [0.490, 0.570] | 0 violations |
| official suite L2 (800 episodes) | 0.539 [0.504, 0.573] | 90 critical violations |
| reference PPO 0.2.0, for comparison | L1 0.605, L2 0.629 | `bench/jezero-v1/baselines/ppo.scorecard.json` |

It does not pass the v0.1 thresholds (L1 ≥ 0.80, L2 ≥ 0.70 with no critical violation): it only sees a 22 m
window, so long official routes (up to 1000 m) and the astronaut / solar profiles of L2 are hard for it.

## How it was trained (repeat it exactly)

```bash
git clone https://github.com/Atsushi2036/mars-x && cd mars-x
uv sync --project python --extra train
python -c "from marsx import data; print(data.fetch(dest='data/processed/jezero-v1'))"   # or: just fetch-data

uv run --project python --extra train python -m marsx.train.ppo \
  --data data/processed/jezero-v1 --scenario jezero-v1/l1/rtg-geometry \
  --r-min 20 --r-max 350 --time-weight 1 \
  --timesteps 1500000 --eval-every 500000 --eval-episodes 100 \
  --seed 7 --name my-team/my-first-model --version 0.1.0 --out my-first-model
```

- PPO (Stable-Baselines3 2.9.2, MLP 128×128, CPU) on the real 2 m Jezero grid, 64 environments stepped in one
  process by the NumPy-vectorised engine (no subprocesses).
- Trained on the north of the grid (rows < 768); evaluated on the unseen south. Goals 20–350 cells (40–700 m).
- `--time-weight 1` matters: without a time penalty WAIT is free and PPO learns to stand still.
- The best checkpoint is exported directly as ONNX (no pickle) and validated with the same rules as the web loader.

Evaluate and score it:

```bash
export MARSX_DATA=data/processed/jezero-v1
marsx evaluate --policy my-first-model/policy.onnx --level L1 --name my-team/my-first-model --out my-model.L1.run.json
marsx evaluate --policy my-first-model/policy.onnx --level L2 --name my-team/my-first-model --out my-model.L2.run.json
marsx scorecard my-model.L1.run.json my-model.L2.run.json --out my-model.scorecard.json
```

On Windows consoles set `PYTHONIOENCODING=utf-8` before `marsx scorecard`.

## Load it in the web app

1. Open MARS-X and choose **Test your AI** → **Bring your model**.
2. Drop `my-model.onnx` on "Drop a .onnx policy here". It is validated before any session is created (size, ONNX
   domains and opset, no external data, no control flow) and runs in a sandboxed worker; it never leaves your
   browser.
3. Or drop `my-model.L1.run.json` (or L2) on "Drop a run.json here" to replay all 600/800 evaluated episodes in 3D
   on the Jezero terrain and compare with the baselines.
