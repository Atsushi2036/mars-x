# MARS-X — Project submission form (NASA Space Apps 2026)

> Copy each section into the matching field of the Space Apps project page. Replace `[TEAM NAME]`, `[MEMBERS]`
> and `[FINAL URL]` before submitting. All numbers below come from `bench/jezero-v1/baselines/*.scorecard.json`
> and `data/processed/jezero-v1` validation (suite `jezero-v1 0.1.0`).

- **Team:** [TEAM NAME]
- **Members:** [MEMBERS]
- **Challenge:** Interplanetary Survival Guide: Martian Map
- **Final project link:** [FINAL URL] (no login) · source: https://github.com/Atsushi2036/mars-x
- **Demo link:** [VIDEO URL] (≤30 s) or [SLIDES URL] (≤7 slides)

## Project title

MARS-X

## Tagline (≤10 words)

Test your Mars navigation AI on real Jezero terrain.

## High-level summary

MARS-X is a browser-based first-filter test bench for Mars surface navigation. It turns NASA's 1 m HiRISE elevation
model of Jezero crater into an interactive 3D map where you plan a safe Marswalk for an astronaut or a route for a
rover, under conditions taken from real sols of Perseverance's weather station. Universities and robotics teams can
also bring their own navigation AI (an ONNX policy or a run file from our Gymnasium-compatible Python SDK) and get a
reproducible scorecard. The result is honest by design: simulation only, necessary but not sufficient, and even our
oracle planner fails the conditions level, because conditions matter.

## What does it do?

- **Map an astronaut's Marswalk.** Pick a science stop (for example the Mg-carbonate patch seen by CRISM, or a real
  Perseverance waypoint), and MARS-X plans a route under the astronaut's slope limit, shows the walk budget (EVA time,
  return margin) and the shelter rule for a solar particle alert.
- **Plan rover routes** for an RTG rover and a solar rover, each with its own slope limit and energy model, and watch
  or follow the traverse in 3D, in orbit view or on foot.
- **Show the conditions of a real sol:** Perseverance MEDA weather (clear sols 148, 151, 160, 170; dust-storm sols 313–315), the Sun and
  shadows hour by hour with the Mars24 algorithm, a clear sol versus the January 2022 regional dust storm, and the
  Earth–Mars light-time for that date.
- **Test your own AI.** Train a tabular Q-learning agent live in the browser and watch it learn, or drop in a
  `run.json` or an ONNX policy. MARS-X re-simulates every episode itself and builds a scorecard with three levels
  (L1 nominal navigation, L2 Mars conditions, L3 hidden rocks and one plan per sol), 95 % Wilson intervals and the
  baselines.
- **Graduate to a full simulator:** export the exact scenario, terrain included, as a package for Gazebo (SDF) and
  Isaac Sim (OBJ for the Isaac Lab MeshConverter).

## How does it work?

1. **Data pipeline (Python):** windowed HTTP reads of the USGS Mars 2020 TRN HiRISE DTM (1 m) and orthomosaic
   (25 cm), reprojected to a local equirectangular grid so pixels are true metres (the source projection stretches
   east–west by 5.4 % at 18.4° N). Slope, roughness, step, hazard, horizon and sky-view layers are derived in parallel
   (Numba, process pools). Every layer carries its source, licence, SHA-256 and an origin chip (measured, derived,
   modeled, assumption).
2. **Validation against the rover:** DEM height at 147 Perseverance waypoints agrees with the rover's published
   elevation (Pearson r = 0.99999, mean absolute error 2.7 cm). DEM slope versus the rover's measured tilt:
   r = 0.84 (0.91 with 1.5 m smoothing). Elevation–image alignment: 0.66 px.
3. **Conditions engine:** Mars24 sun geometry (Allison & McEwen 2000), MEDA sols from the PDS Atmospheres Node,
   insolation with dust opacity (Appelbaum & Flood), RTG and solar energy, Earth–Mars one-way light-time from the JPL
   approximate ephemeris, synthetic sub-metre rocks from the Golombek & Rapp rock size-frequency model (seeded), and
   a space-weather shelter rule for the astronaut (a training rule, not a forecast).
4. **Environment and benchmark:** a Gymnasium 1.x environment (`check_env` passes) running about 190,000 agent-steps
   per second, a versioned suite (`jezero-v1 0.1.0`) and baselines. The web app and the SDK share golden fixtures so
   the same scenario, seed and actions give the same result.
5. **Web app:** React + three.js in the browser, with all heavy work in Web Workers (terrain meshing, A* planning,
   Q-learning, ONNX inference with ONNX Runtime Web in WebAssembly). Static hosting, no backend, nothing uploaded.

### Benchmark results (suite jezero-v1 0.1.0, thresholds v0.1: L1 ≥ 80 %, L2 ≥ 70 %, L3 Wilson lower bound ≥ 60 %; any critical violation fails the level)

| Baseline | L1 success | L2 success | L3 success | Passes v0.1? |
|---|---|---|---|---|
| A* (oracle planner, not machine learning) | 1.000 | 0.998 | 0.007 | No: fails L2 on critical violations |
| A* + replanning | 1.000 | 0.998 | 0.800 | No: fails L2 and L3 on critical violations |
| PPO 0.2.0 (reference policy, trained by the team) | 0.605 | 0.629 | 0.558 | No |
| Tabular Q-learning | 0.490 | not run | not run | No |
| Random | ≈ 0 | — | — | No |

No baseline passes v0.1. Even the oracle planner fails L2: conditions matter. That gap is exactly what the test bench
is for.

## Benefits

- **Zero install:** runs in a browser, including phones; the SDK runs in Colab.
- **Real terrain, real conditions, honest limits:** every value says whether it is measured, derived, modeled or an
  assumption, and the scorecard lists what the test does not cover.
- **Fair and reproducible:** same versioned suite and seeds for everyone; numbers are recomputed by re-simulation,
  never taken from the file; a file that does not replay exactly is marked "Not verifiable".
- **Your model stays yours:** ONNX policies and run files are checked and run inside the page; nothing is uploaded.
- **A path forward:** export the failing scenarios to Gazebo or Isaac Sim with the same seeds.

## Intended impact

- **Universities:** a ready lab for robotics and AI courses — students change a reward or a cost, watch an agent
  learn on real Martian terrain, and compare it fairly with classical planning.
- **Startups and research teams:** a cheap first filter before spending GPU hours in high-fidelity simulators.
- **Mission thinking:** a hyperlocal, layered map of the kind a crew would use to plan a safe, science-rich Marswalk.
- **Local impact:** built by a team in Bolivia, free and open, usable on modest hardware.

## What tools, coding languages, hardware or software did you use?

- **Languages:** TypeScript, Python 3.13, GLSL.
- **Web:** React 19, three.js 0.187 with React Three Fiber and drei, Vite 8, Tailwind CSS 4, shadcn/ui and Radix UI,
  zustand, zod, Comlink (Web Workers), ONNX Runtime Web 1.31 (WebAssembly), Geist fonts.
- **Python:** NumPy, SciPy, Numba, rasterio, pyproj, Pillow, pydantic, Gymnasium 1.x, Stable-Baselines3 (PPO),
  PyTorch (CPU), ONNX.
- **Testing and quality:** Vitest, Playwright (screenshots at 1440 and 390 px, light and dark), pytest, ESLint,
  JSON Schema contracts shared between Python and TypeScript.
- **Infrastructure:** GitHub, GitHub Actions, Cloudflare Pages (static hosting), pnpm, uv.
- **AI assistance:** Claude Code (Anthropic) under the team's direction; see the "Use of AI" field.
- **Hardware:** ordinary laptops (Windows 11); policy training on CPU.

## Creativity

- **Bring your own navigation AI** and score it on real HiRISE terrain, in the browser, with no install. Existing
  Mars portals show layers; robotics simulators need a GPU and a local install. We did not find a tool that does both.
- **The same map serves an astronaut and a robot.** The same ground and the same sol give different safe routes for
  a suited astronaut, an RTG rover and a solar rover.
- **Learning made visible:** you can watch a Q-learning agent explore, fail and improve on the real crater in 3D.
- **Honesty as a feature:** provenance chips, re-simulation, "Not verifiable", the "necessary, not sufficient"
  stamp, and a baseline table where nobody passes.

## How it answers the Martian Map challenge

| Challenge asks for | In MARS-X |
|---|---|
| A map or tool an astronaut could use on a surface mission | Marswalk planner: science stop, route, walk budget, shelter rule; usable on a tablet or phone |
| A location with a science objective | Jezero delta, Perseverance's field site; science stops at real rover waypoints and the Mg-carbonate patch (CRISM) |
| At least three kinds of data, layered | Optical (HiRISE ortho), topographic (HiRISE DTM, slope, hazard), spectral (CRISM mineral map, ML-derived), thermal (THEMIS thermal inertia), atmospheric (MEDA weather, dust opacity), mission data (Perseverance traverse and waypoints) |
| Current conditions | Conditions of real archived sols from MEDA, the Sun and shadows for the chosen local time, the light-time for the date |
| Safety first; route avoiding obstacles | Slope limits per traveller, hazard layer, synthetic hidden rocks, EVA return margin, space-weather shelter rule |
| Hyperlocal, not regional or global | 2 × 2 km window at 1 m/px, against the regional and global views of existing portals |
| Point-of-view | Walk mode (first person on the terrain) and Follow mode behind the astronaut or the rover |
| Robots that support the crew | Rover profiles share the same map: one plan per sol, energy and hazards |

## Considerations (limits we state openly)

- **Simulation only:** a first filter, necessary but not sufficient. It does not certify anything and is not flight
  software.
- **Model conditions:** MEDA measures at the rover's position on past sols; the storm dust opacity is a published peak
  value; energy, insolation and slip are simplified models; sub-metre rocks are synthetic (seeded).
- **Assumptions:** astronaut limits (slope 15° by default, adjustable up to 20°; EVA 4 h; walking at 1 m/s; 30 min
  shelter window) are team assumptions, labelled in the app.
- **Comparison with Perseverance:** the rover's path was planned by humans with science goals. It is a reference,
  not ground truth.
- **Exports:** the Gazebo SDF is checked against template rules but has not been run in Gazebo. Isaac Sim is not
  tested.
- **Point-of-view:** the app does not yet embed Perseverance raw camera images.
- **Region:** one 2 × 2 km window. More regions are future work.
- **Affiliation:** not affiliated with or endorsed by NASA, JPL or Caltech.
