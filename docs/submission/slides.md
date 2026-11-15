# MARS-X — Demo deck (7 slides maximum, title and intro included)

The rules require English and no more than 7 slides. The deck must show:
- the team name, the members and the challenge;
- an image of the project and the user experience;
- how NASA data makes the solution possible.

**Screenshots.** Paths are under `apps/explorer/.shots/redesign/`. Use the **dark desktop** captures listed here.
Do **not** use `A/guided/*`: those were taken on the synthetic test terrain and show the badge "Synthetic terrain,
not real Mars data". If a guided-tour image is wanted, re-capture it on the live site with `?tour=1`.

**Design.**
- Dark background (#0B0E14), Geist font, one big image per slide, at most about 40 words of body text.
- No NASA, JPL or mission logos.
- Footer on every slide: "Not affiliated with or endorsed by NASA, JPL or Caltech."

---

## Slide 1 — Title

- **Image:** `D/explore__desktop__dark.png` (full bleed, darkened 30 %)
- **Text:**
  - **MARS-X**
  - Test your Mars navigation AI on real Jezero terrain.
  - Team: **[TEAM NAME]** · Members: **[MEMBERS]**
  - NASA Space Apps 2026 · Challenge: **Interplanetary Survival Guide: Martian Map**
  - [FINAL URL]

## Slide 2 — Intro: the Marswalk

- **Image:** `B/17-astronaut-front__desktop__dark.png`
- **Text:**
  - **A hyperlocal map for a safe, science-rich Marswalk**
  - The first crews will need routes that respect slopes, suits, time and space weather. Existing portals are regional
    or global.
  - MARS-X maps a 2 × 2 km window of Jezero at 1 m/px, for an astronaut and the rovers that support the crew.

## Slide 3 — Problem

- **Image:** `D/plan-result__desktop__dark.png`
- **Text:**
  - **Testing navigation for Mars is expensive or unrealistic**
  - High-fidelity robot simulators need a GPU and a local install.
  - Map viewers show layers but cannot test an AI.
  - Universities and small robotics teams have no cheap, fair first test on real Martian ground.

## Slide 4 — Solution and user experience

- **Image:** `D/train/7-3d-ghost__desktop__dark.png` (Q-learning agent learning on the real terrain)
- **Text:**
  - **Plan · Test your AI · Graduate**
  - **Plan a route** for an astronaut, an RTG rover or a solar rover; watch or follow it in 3D.
  - **Test your AI:** train Q-learning live in the browser, or drop an ONNX policy or an SDK run file. It runs in your
    browser; nothing is uploaded.
  - **Graduate:** export the scenario to Gazebo or Isaac Sim.
  - Guided tour: [FINAL URL]/?tour=1

## Slide 5 — NASA data makes it possible

- **Image:** `D/data__desktop__dark.png` (Dataset and Validation cards)
- **Text:**
  - **Built on NASA data, checked against the rover**
  - HiRISE DTM 1 m and 25 cm orthomosaic (USGS, NASA/JPL/University of Arizona) · Perseverance traverse and waypoints (MMGIS) ·
    MEDA weather sols (PDS) · Mars24 sun · CRISM minerals (ML-derived) · THEMIS thermal inertia.
  - DEM vs rover elevation at 147 waypoints: r = 0.99999, error 2.7 cm.

## Slide 6 — Results: honest by design

- **Image:** `D/lab-byo__desktop__dark.png`. If a newer scorecard capture exists, use it instead, with a caption
  "scorecard view".
- **Text (table):**

  | Baseline | L1 | L2 | L3 |
  |---|---|---|---|
  | A* (oracle planner, not ML) | 1.000 | 0.998 | 0.007 |
  | A* + replanning | 1.000 | 0.998 | 0.800 |
  | PPO 0.2.0 (trained by us) | 0.605 | 0.629 | 0.558 |
  | Q-learning | 0.490 | — | — |

  - Success rates on suite jezero-v1 0.1.0.
  - **No baseline passes v0.1: even the oracle planner fails L2 on critical violations. Conditions matter.**
  - Scores are recomputed by re-simulation, with 95 % Wilson intervals.
  - Simulation only: necessary, not sufficient.

## Slide 7 — Future

- **Image:** `B/16-follow-astronaut__desktop__dark.png`
- **Text:**
  - **Next: from first filter to the field**
  - More Mars and Moon sites.
  - Hidden test seeds for fair competitions between universities.
  - Perseverance camera views at science stops.
  - Run the exported scenarios in Gazebo and Isaac Sim.
  - Open source, free, in the browser. Gymnasium SDK on Colab.
  - Contact: [TEAM NAME]

---

## Checks before exporting the deck

- 7 slides or fewer, all in English, with team name, members and challenge on slide 1.
- Numbers match `bench/jezero-v1/baselines/*.scorecard.json` (A* L2 is 0.9975 → 0.998; PPO card file must be 0.2.0).
- Never show the PPO card's in-distribution 95.5 % without the official 0.605 next to it.
- Never show the in-browser Q-learning "Success, last 100: 100 %" as a benchmark result. It is one training task;
  the suite result is L1 0.490.
- No words such as validated, certified, flight-ready, digital twin or NASA-approved.
- Share the deck as a public link (Google Slides "anyone with the link", or PDF on Drive or GitHub).
