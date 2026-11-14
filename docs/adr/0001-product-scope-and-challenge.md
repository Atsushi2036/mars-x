# ADR-0001: Product scope — a "first-filter" test bench for planetary autonomy

- Status: Accepted (2026-11-14, approved by the team lead)
- Deciders: product-owner, ai-engineer, ux-ui-designer, orchestrator

## Context
NASA Space Apps 2026, challenge **"Interplanetary Survival Guide: Martian Map"**: build a map/tool an astronaut could use on a Mars surface excursion (Marswalk), layering several kinds of NASA data, prioritising crew safety and including a route map that avoids obstacles. The challenge text notes that Mars Trek and the USGS geologic maps are regional/global, not hyperlocal.
Submission deadline: Sunday 2026-11-15 23:59 local. All materials in English; demo video ≤30 s or ≤7 slides; AI ("SI") use must be declared.

## Decision
MARS-X is a **browser-based, zero-install test bench** on **real 1 m HiRISE terrain of Jezero crater** with **real Mars conditions**, where universities and companies bring **their own navigation/AI model**, run it on reproducible scenarios, get a scorecard, and — if it passes — export the scenario to higher-fidelity simulators (Gazebo, Isaac Sim).

Profiles: **Astronaut (Marswalk)**, **Rover RTG** (Perseverance-like), **Rover solar** (generic).
Scorecard levels: L1 geometry, L2 conditions, L3 autonomy (comm delay + unseen obstacles). Passing is *necessary, not sufficient*: MARS-X is a cheap early filter, not flight validation.

Delivered as deployable slices (each one ends deployed):
- S1 real terrain + live route planning
- S2 Mars conditions engine + profiles + layers + validation against Perseverance's real traverse
- S3 Python SDK (Gymnasium) + benchmark suite + scorecard + 3D replay + in-browser Q-learning lab
- S4 PPO policy (ONNX) + export to Gazebo/glTF + guided mission + ONNX drag-and-drop
- S5 AI4Mars perception lab + Spanish toggle

## Alternatives considered
- **Terrain viewer + A\* only**: rejected — "your house with another floor"; not useful as a prototyping sandbox.
- **"Digital twin" positioning**: rejected — at JPL the term means the rover replica used for validation; misleading.
- **Full physics simulator (wheel–soil, CFD)**: rejected — that is Gazebo/Isaac's niche; we model the *effects* of conditions on the mission.
- **Login, accounts, leaderboard**: deferred — needs a backend and PII handling; not required by the challenge.

## Consequences
- Honest messaging is part of the product (A\* plans, it does not learn; models are simplified and cited).
- Scope is large; execution is ordered so that every slice is a complete product if time runs out.
