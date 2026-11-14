# ADR-0005: Navigation, learning agents and bring-your-own-model

- Status: Accepted (2026-11-14); details in the implementation spec by ai-engineer
- Deciders: ai-engineer, security-senior, product-owner

## Decision
- **Planning (not ML)**: A\*/Dijkstra on a 2 m cost grid (conservative max-pooling of 1 m slope/step hazards), in TypeScript Web Workers, one worker per profile in parallel; cost-to-goal field enables instant re-planning when the start moves. A Python twin exists for fixtures, evals and training; parity enforced with shared golden cases.
- Costs from documented Perseverance limits (cited) and profile parameters (astronaut, RTG rover, solar rover).
- **Learning**: tabular Q-learning trained live in the browser (AI Lab, editable reward weights, learning curves); PPO (Gymnasium + Stable-Baselines3) trained offline with local observations, exported to ONNX (~200 KB), run in the browser with onnxruntime-web (WASM, 1 thread). Training is parallelised by seeds; SubprocVecEnv rejected on Windows (slower, `WinError 1455`).
- **Bring your own model**:
  1. Python SDK `marsx` (Gymnasium API, NumPy-vectorised batch env, Colab notebook) → `marsx.evaluate(...)` → `run.json` → 3D replay + scorecard in the web app.
  2. Drag-and-drop ONNX policy, executed in an isolated worker with security controls (ADR-0007).
  3. Live localhost agent connection: roadmap.
- Export for graduation to high-fidelity simulators: GeoTIFF + GLB + `scenario.json` + Gazebo SDF (Mars gravity, sun direction), generated from fixed templates, never with plugins.

## Alternatives discarded
- Theta\*/D\* Lite/Hybrid A\*: post-smoothing suffices; re-planning already < 60 ms.
- TF.js (no release since Jan 2025), Pyodide training (no torch), LLM copilots (no value for the challenge).
- AI4Mars perception feeding the cost map: domain gap (ground photos vs orbital map) → presented as a separate perception lab (S5).
