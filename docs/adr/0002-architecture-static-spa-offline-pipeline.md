# ADR-0002: Architecture — static SPA + offline Python pipeline, no backend, no database

- Status: Accepted (2026-11-14)
- Deciders: backend-senior, database-architect, frontend-senior, devops-senior, security-senior

## Decision
```
OFFLINE (Python, uv)                 STATIC CDN (content-hashed)          BROWSER (SPA)
USGS DEM 1 m + HiRISE 25 cm   ─┐     manifest.json (JSON Schema)          main thread: UI + render only
CRISM, Perseverance traverse  ─┤ →   height.u16, layers, horizon maps  →  workers: terrain, planners (pool),
MEDA weather sols             ─┘     ortho tiles, policy.onnx              Q-learning lab, ONNX policy
precompute: reprojection, slopes, hazards, horizon maps, condition tables, benchmark suite, PPO training
```
- **Single source of truth**: everything expensive is precomputed in Python with data parallelism (numba `prange`, process pools, concurrent HTTP range reads). The browser and the Python SDK read the *same* files, so results match by construction.
- **No backend, no DB in the MVP**: data are write-once/read-many; missions are shared via URL (spec only) and recomputed deterministically.
- Data contract: `manifest.json` generated from pydantic models → JSON Schema in `packages/schemas` → zod validators in the web app; CI fails on drift. Golden fixtures shared by pytest and Vitest.

## Alternatives discarded
- FastAPI backend / live Python over WebSockets: adds ops, secrets and latency; planning in TS workers measured at 29–188 ms on 512²–1024² grids.
- Pyodide in the browser: ~10 MB, no torch/gymnasium.
- Postgres (Neon/Supabase): no multi-user writes in the MVP. Revisit for classrooms/competitions (hidden test seeds server-side).
- DuckDB-WASM: 34 MB runtime, larger than the dataset.

## Consequences
Changing data means a new content-hashed dataset version and redeploy; rollback = previous deploy.
