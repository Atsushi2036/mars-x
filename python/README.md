# marsx

Python package of MARS-X, a first-filter test bench for planetary autonomy on real Jezero terrain.

| module | what it is |
|---|---|
| `marsx.pipeline` | geospatial pipeline: HiRISE DEM/ortho → 2 m planning grid, horizons, condition tables, `manifest.json` |
| `marsx.contracts` | versioned contracts: `run/1`, `scenario/1`, `suite/1`, `policy/1`, `obs/1`, `act/1`, `traj/1` (JSON Schemas in `packages/schemas`) |
| `marsx.conditions` | Mars conditions with provenance: gravity, Mars24 sun, insolation, MEDA weather, comms, energy, rocks, slip, space weather |
| `marsx.nav` | A*, Dijkstra cost-to-goal, smoothing, classical baselines |
| `marsx.env` | Gymnasium env `MarsX/Jezero-v1` (single + NumPy-vectorised), built-in L1/L2/L3 scenarios |
| `marsx.bench` | benchmark suite `jezero-v1`, runner, scorecard, re-simulation verification (`marsx` CLI) |
| `marsx.train` | PPO reference training, tabular Q-learning, ONNX `policy/1` export + validator, learning baselines |

## Install

```bash
uv sync --project python --extra train      # SDK + training (torch CPU, stable-baselines3, onnx)
uv sync --project python --extra pipeline   # only to rebuild the dataset from raw NASA/USGS data
uv run --project python pytest python/tests
```

From another project / Colab (pin a commit for reproducibility):

```bash
pip install "marsx[train] @ git+https://github.com/Atsushi2036/mars-x@<commit-sha>#subdirectory=python"
```

Requires Python ≥ 3.12. The processed dataset is not in the wheel: set `MARSX_DATA` to the folder with
`manifest.json` (see `docs/sdk/README.md`, "Get the data").

## Quick start

```python
import gymnasium as gym

env = gym.make("marsx.env:MarsX/Jezero-v1", scenario="jezero-v1/l1/rtg-geometry")
vec = gym.make_vec("marsx.env:MarsX/Jezero-v1", num_envs=4096, vectorization_mode="vector_entry_point")
```

```bash
marsx evaluate --policy my_policy.onnx --level L1 --out run_L1.json
marsx scorecard run_L1.json --out scorecard.json
```

Full guide: [`docs/sdk/README.md`](../docs/sdk/README.md) · Colab: [`docs/sdk/colab_quickstart.ipynb`](../docs/sdk/colab_quickstart.ipynb).

Simulation only. Not affiliated with or endorsed by NASA, JPL or Caltech.
