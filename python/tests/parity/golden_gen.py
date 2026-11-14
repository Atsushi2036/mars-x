"""Official golden fixtures (Python is the oracle) for Python <-> TypeScript parity.

Regenerate with::

    uv run --project python python python/tests/parity/golden_gen.py

Outputs under ``fixtures/golden/`` (committed; consumed by pytest and Vitest):

* ``nav/cases.json``      A*/Dijkstra cases (marsx.nav.fixtures; exact paths, cost 1e-9).
* ``env/env-golden.json`` obs/1 + every step of NavBatch for L1/L3 cases (envgolden/1; obs 1e-6).
* ``env/env-l2-golden.json`` L2: sun, horizon shadow, solar balance, comms block, SPE rule (envl2golden/1).
* ``metrics/metrics-golden.json`` scorecard metrics from episodes (metricsgolden/1).
* ``manifest.json``       sha256 of every file + generator inputs.

Everything is seeded, so the files only change when the oracle's behaviour changes.
"""

from __future__ import annotations

import base64
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[3]
GOLDEN = ROOT / "fixtures" / "golden"
sys.path.insert(0, str(ROOT / "python" / "src"))

from marsx.bench.metrics import alert_compliance, compute_metrics, failure_taxonomy  # noqa: E402
from marsx.conditions import comms, mars24  # noqa: E402
from marsx.contracts import obs as spec  # noqa: E402
from marsx.contracts.run import EpisodeResult  # noqa: E402
from marsx.env import scenarios  # noqa: E402
from marsx.env.core import DEFAULT_ROCK_SEED, NavBatch, rock_mask  # noqa: E402
from marsx.env.terrain import Terrain, synthetic_terrain  # noqa: E402
from marsx.nav import fixtures as nav_fixtures  # noqa: E402

GENERATOR = "python/tests/parity/golden_gen.py"
F32_KEYS = {"slope", "step", "height"}  # base64 float32 payloads compared with tolerance by the freshness test
OBS_DIM = spec.OBS_DIM


def b64(a: np.ndarray, dtype) -> str:
    return base64.b64encode(np.ascontiguousarray(a, dtype=dtype).tobytes()).decode("ascii")


def dumps(doc: dict) -> str:
    return json.dumps(doc, separators=(",", ":"), allow_nan=False) + "\n"


# ----------------------------------------------------------------------------------------------- nav
def build_nav() -> dict:
    return nav_fixtures.build_cases()


# ----------------------------------------------------------------------------------------------- env L1/L3
_DIR_TO_ACTION = {(a.drow, a.dcol): a.index for a in spec.ACTIONS}


def _greedy_actions(eng: NavBatch, rng: np.random.Generator, noise: float):
    """Toward-goal action with seeded noise (random moves and WAITs) so bumps, waits and detours are covered."""
    r, c = eng.cell(0)
    gr, gc = eng.goal_cells()[0]
    if rng.random() < noise:
        return int(rng.integers(0, spec.N_ACTIONS))
    return _DIR_TO_ACTION[(int(np.sign(gr - r)), int(np.sign(gc - c)))] if (gr, gc) != (r, c) else spec.WAIT


def _scenario(sid: str, n: int, max_steps: int):
    s = scenarios.get(sid)
    return s.model_copy(update={"window": s.window.model_copy(update={"rows": n, "cols": n}), "max_steps": max_steps})


def _config(eng: NavBatch, sc) -> dict:
    w = sc.reward
    return {
        "kind": eng.kind, "maxSlopeDeg": float(sc.agent.max_slope_deg.value), "maxStepM": float(sc.agent.max_step_m.value),
        "speedMS": eng.speed, "gravity": eng.gravity,
        "reward": {"energy": w.energy, "risk": w.risk, "time": w.time, "progress": w.progress, "goal": w.goal,
                   "failure": w.failure, "hazard_attempt": w.hazard_attempt, "step_cost": w.step_cost},
        "maxSteps": eng.max_steps, "energyOn": bool(eng.energy_on),
        "sensorRadiusM": float(np.hypot(*(np.argwhere(eng.sensor_mask.reshape(11, 11) > 0) - 5).T).max() * eng.res)
        if eng.sensor_mask.any() else 0.0,
        "waitS": eng.wait_s, "sols": None if sc.time is None else sc.time.sols,
        "window": [sc.window.row0, sc.window.col0, sc.window.rows, sc.window.cols],
    }


def _run_case(case_id: str, terrain: Terrain, sc, *, start, goal, actions=None, rocks=None, noise=0.2, seed=7,
              sensor_radius_m=None) -> dict:
    eng = NavBatch(terrain, sc, 1, seed=0, autoreset=False, rocks=rocks, record=True, sensor_radius_m=sensor_radius_m)
    if start is None:
        eng.reset(seed=seed)
        start, goal = [int(v) for v in eng.start_cells()[0]], [int(v) for v in eng.goal_cells()[0]]
    else:
        eng.reset_to([0], [start], [goal])
    rng = np.random.default_rng(seed)
    obs = {0: eng.observe()[0]}
    steps = []
    i = 0
    while i < sc.max_steps and (actions is None or i < len(actions)):
        a = actions[i] if actions is not None else _greedy_actions(eng, rng, noise)
        _, rew, term, trunc, info = eng.step(np.array([a]))
        steps.append({
            "action": int(a), "reward": float(rew[0]), "terminated": bool(term[0]), "truncated": bool(trunc[0]),
            "cell": [int(v) for v in info["cell"][0]], "tS": float(info["tS"][0]), "soc": float(info["soc"][0]),
            "energyWh": float(info["energyWh"][0]), "pathM": float(info["pathM"][0]),
            "pathCost": float(info["pathCost"][0]), "steps": int(info["steps"][0]),
            "violations": int(info["violations"][0]), "timeSlopeGt15S": float(info["timeSlopeGt15S"][0]),
            "shield": int(info["shieldInterventions"][0]), "outcome": str(info["outcome"][0]),
        })
        i += 1
        obs[i] = eng.observe()[0]
        if term[0] or trunc[0]:
            break
    n = len(steps)
    keep = sorted({0, 1, 2, n // 2, n} & set(obs))
    traj = [[int(r), int(c), float(t), float(soc), int(a)] for r, c, t, soc, a in eng.trajs[0]]
    return {
        "id": case_id, "rows": terrain.shape[0], "cols": terrain.shape[1], "resM": terrain.res_m,
        "terrain": {"slope": b64(terrain.slope_deg, "<f4"), "step": b64(terrain.step_m, "<f4"),
                    "height": b64(terrain.height_m, "<f4")},
        "rocks": b64(eng.rocks, "u1"), "config": _config(eng, sc), "start": list(start), "goal": list(goal),
        "obsSteps": keep, "obs": {str(k): b64(obs[k], "<f4") for k in keep}, "steps": steps, "traj": traj,
    }


def _flat(n: int, slope_cols: dict[int, float] | None = None) -> Terrain:
    z = np.zeros((n, n), np.float32)
    slope = z.copy()
    for col, v in (slope_cols or {}).items():
        slope[:, col] = v
    return Terrain(slope, z.copy(), z.copy(), 2.0, "flat")


def build_env() -> dict:
    n = 48
    ter = synthetic_terrain(n, seed=11)
    rocks = rock_mask((n, n), 2.0, 0.05, DEFAULT_ROCK_SEED)
    rover = _scenario("jezero-v1/l3/rtg-hidden-rocks", n, 60)
    cases = [
        _run_case("rtg-hidden-rocks", ter, rover, start=None, goal=None, rocks=rocks, seed=3),
        _run_case("astronaut-energy", ter, _scenario("jezero-v1/l1/astronaut-geometry", n, 50), start=None, goal=None,
                  seed=5),
        _run_case("timeout-truncated", ter, _scenario("jezero-v1/l1/rtg-geometry", n, 12), start=None, goal=None,
                  seed=9, noise=0.0),
    ]
    one_rock = np.zeros((n, n), bool)
    one_rock[10, 11] = True
    cases.append(_run_case("rock-collision", _flat(n), rover, start=[10, 10], goal=[10, 30], rocks=one_rock,
                           actions=[2]))
    cases.append(_run_case("success-straight", _flat(n), _scenario("jezero-v1/l1/rtg-geometry", n, 30), start=[5, 5],
                           goal=[5, 9], actions=[2, 2, 2, 2]))
    # column 12 is steeper than the rover limit (24 deg): E bumps (shield), diagonals must not cut the corner
    wall = _flat(n, {12: 40.0})
    cases.append(_run_case("blocked-and-corner", wall, _scenario("jezero-v1/l1/rtg-geometry", n, 30), start=[10, 11],
                           goal=[10, 20], actions=[2, 4, 6, 8, 3, 1, 0]))
    return {"specVersion": "envgolden/1", "generator": GENERATOR, "obsDim": OBS_DIM, "cases": cases}


# ----------------------------------------------------------------------------------------------- env L2
def _ridge_terrain(n: int, deg: float, bins: range | None) -> Terrain:
    z = np.zeros((n, n), np.float32)
    hz = np.zeros((16, n, n), np.float16)
    for k in (range(16) if bins is None else bins):
        hz[k] = deg
    return Terrain(z.copy(), z.copy(), z.copy(), 2.0, "flat", horizon_deg=hz)


def _l2_engine(sid: str, terrain: Terrain, *, start=(10, 10), goal=(10, 25), wait_s=60.0, alert_t=None,
               spe_window_s=None, soc=None) -> NavBatch:
    eng = NavBatch(terrain, scenarios.get(sid), 1, seed=0, autoreset=False, wait_s=wait_s, record=False)
    eng.reset_to([0], [start], [goal])
    if alert_t is not None:
        eng.alert_t[:] = alert_t
    if spe_window_s is not None:
        eng.spe_window_s = spe_window_s
    if soc is not None:
        eng.soc[:] = soc
    return eng


def _l2_trace(case_id: str, kind_note: str, eng: NavBatch, actions: list[int], cell: tuple[int, int]) -> dict:
    env_b, comm_b = spec.block("environment"), spec.block("comm")
    r, c = np.array([cell[0]]), np.array([cell[1]])
    rows = []
    for k in range(len(actions) + 1):
        t = eng.t_s.copy()
        rc = eng.cells()
        o = eng.observe()[0]
        rows.append({
            "k": k, "tS": float(t[0]), "cell": [int(v) for v in rc[0]], "soc": float(eng.soc[0]),
            "lit": bool(eng.conditions.lit(t, rc[:, 0], rc[:, 1])[0]),
            "irradianceWm2": float(eng.conditions.irradiance(t, rc[:, 0], rc[:, 1])[0]),
            "generationW": float(eng.conditions.generation_w(eng.kind, t, rc[:, 0], rc[:, 1])[0]),
            "env": [float(v) for v in o[env_b.start:env_b.start + env_b.size]],
            "comm": [float(v) for v in o[comm_b.start:comm_b.start + comm_b.size]],
            "spe": int(eng.spe_state[0]), "goal": [int(v) for v in eng.goal_cells()[0]],
        })
        if k == len(actions):
            break
        _, rew, term, trunc, info = eng.step(np.array([actions[k]]))
        rows[-1]["action"] = actions[k]
        rows[-1]["after"] = {"terminated": bool(term[0]), "truncated": bool(trunc[0]), "outcome": str(info["outcome"][0]),
                             "reward": float(rew[0])}
        if term[0] or trunc[0]:
            break
    del r, c
    return {"id": case_id, "note": kind_note, "scenarioId": eng.scenario.id, "agent": eng.kind,
            "agentCell": list(cell), "waitS": eng.wait_s, "rows": rows}


def build_env_l2() -> dict:
    cases = []
    n = 32
    open_sky, walled = _ridge_terrain(n, 0.0, None), _ridge_terrain(n, 80.0, None)
    east_ridge = _ridge_terrain(n, 60.0, range(2, 7))  # sun at 09:00 LTST is ENE (az ~ 45-110 deg)
    waits = [spec.WAIT] * 20
    for tid, ter, note in (("shadow-open-sky", open_sky, "no horizon: direct + diffuse light"),
                           ("shadow-wall-80deg", walled, "80 deg horizon all around: direct beam cut, diffuse x sky view"),
                           ("shadow-east-ridge", east_ridge, "60 deg ridge on az 45-135: morning sun hidden")):
        cases.append(_l2_trace(tid, note, _l2_engine("jezero-v1/l2/solar-clear", ter, soc=0.5), list(waits), (10, 10)))
    cases.append(_l2_trace("solar-balance-clear", "clear aphelion sol (tau 0.5): net charging while waiting",
                           _l2_engine("jezero-v1/l2/solar-clear", open_sky, soc=0.5, wait_s=600.0), [spec.WAIT] * 30, (10, 10)))
    cases.append(_l2_trace("solar-balance-storm", "Jan-2022 storm (tau 2.0): lower irradiance than the clear sol, so a smaller net charge",
                           _l2_engine("jezero-v1/l2/solar-storm", open_sky, soc=0.5, wait_s=600.0), [spec.WAIT] * 30, (10, 10)))
    cases.append(_l2_trace("solar-storm-early-drain", "storm, first 20 min after 09:00 LTST: net discharge (soc < 0.5)",
                           _l2_engine("jezero-v1/l2/solar-storm", open_sky, soc=0.5), list(waits), (10, 10)))
    cases.append(_l2_trace("rtg-storm-keeps-charge", "RTG output is independent of dust",
                           _l2_engine("jezero-v1/l2/rtg-storm", open_sky, soc=0.5, wait_s=600.0), [spec.WAIT] * 30, (10, 10)))
    cases.append(_l2_trace("comms-one-plan-per-sol", "comm block over one sol in 1 h waits (link, time to uplink, OWLT)",
                           _l2_engine("jezero-v1/l3/rtg-onesol", open_sky, wait_s=3600.0), [spec.WAIT] * 25, (10, 10)))
    cases.append(_l2_trace("spe-alert-then-shelter", "alert at t>=1 s redirects the goal to the shelter; return succeeds",
                           _l2_engine("jezero-v1/l2/astronaut-clear", open_sky, alert_t=1.0), [2, 3], (10, 10)))
    cases.append(_l2_trace("spe-violation", "shelter not reached inside a 5 s window -> spe_violation",
                           _l2_engine("jezero-v1/l2/astronaut-clear", open_sky, alert_t=1.0, spe_window_s=5.0), [2] * 10,
                           (10, 10)))
    cases.append(_l2_trace("astronaut-consumables-drain", "astronaut EVA consumables drain while waiting (no alert)",
                           _l2_engine("jezero-v1/l2/astronaut-clear", open_sky, alert_t=float("nan")), [spec.WAIT] * 10,
                           (10, 10)))
    # direct oracle values for the conditions modules
    lat, lon = 18.49, 77.40
    iso = ["2021-07-20T15:09:00Z", "2022-01-07T04:14:50Z", "2026-11-15T12:00:00Z"]
    from marsx.env.l2 import utc_ms

    mars = []
    for s in iso:
        st = mars24.mars_solar_state(utc_ms(s), lat, lon)
        mars.append({"utc": s, "latDeg": lat, "lonEastDeg": lon, **{k: float(getattr(st, k)) for k in (
            "ls_deg", "lmst_h", "ltst_h", "elevation_deg", "azimuth_deg", "r_au")}})
    links = []
    for s in ("2023-10-20T00:00:00Z", "2023-11-11T00:00:00Z", "2023-11-18T00:00:00Z", "2023-11-25T00:00:00Z",
              "2023-12-10T00:00:00Z", "2026-11-15T00:00:00Z"):
        ms = utc_ms(s)
        links.append({"utc": s, "owltS": float(comms.owlt_s(ms)), "sunEarthMarsDeg": float(comms.sun_earth_mars_angle_deg(ms)),
                      "linkAvailable": bool(comms.link_available(ms))})
    return {"specVersion": "envl2golden/1", "generator": GENERATOR,
            "parity": "python-only oracle: apps/explorer env-lite has no L2 yet (zeros in obs env block, link=1); "
                      "the TS owner must reproduce these before claiming L2 parity",
            "obsLayout": {"environment": [spec.block("environment").start, spec.block("environment").size],
                          "comm": [spec.block("comm").start, spec.block("comm").size]},
            "cases": cases, "mars24": mars, "commsDirect": links}


# ----------------------------------------------------------------------------------------------- metrics
def _episodes(n: int, seed: int, oracle: bool, alerts: bool) -> list[EpisodeResult]:
    rng = np.random.default_rng(seed)
    outs = ["success", "collision", "hazard", "battery", "stuck", "spe_violation", "timeout"]
    eps = []
    for i in range(n):
        outcome = outs[int(rng.integers(0, len(outs)))]
        path = float(round(rng.uniform(60, 400), 3))
        o = {"pathM": float(round(path * rng.uniform(0.5, 1.0), 3)), "cost": float(round(path * 1.4, 4)),
             "energyWh": float(round(rng.uniform(5, 120), 3))}
        ev = []
        if alerts and rng.random() < 0.55:
            ev = [{"t": float(round(rng.uniform(1, 500), 3)), "type": "speAlert"}]
        eps.append(EpisodeResult.model_validate({
            "index": i, "seed": i, "scenarioId": "ab"[i % 2], "start": [0, 0], "goal": [1, 1], "outcome": outcome,
            "steps": int(rng.integers(20, 600)), "pathM": path, "energyWh": float(round(rng.uniform(5, 120), 3)),
            "oracle": o if oracle else None, "violations": int(outcome == "collision" or rng.random() < 0.05),
            "events": ev,
        }))
    return eps


def build_metrics() -> dict:
    out = []
    for name, eps in (("mixed-80", _episodes(80, 2026, True, True)), ("no-oracle", _episodes(10, 4, False, True)),
                      ("single", _episodes(1, 99, True, False)[:1]), ("empty", [])):
        out.append({
            "name": name,
            "episodes": [e.model_dump(by_alias=True, mode="json") for e in eps],
            "metrics": compute_metrics(eps).model_dump(by_alias=True, mode="json"),
            "alertCompliance": alert_compliance(eps),
            "taxonomy": failure_taxonomy(eps),
        })
    return {"specVersion": "metricsgolden/1", "generator": GENERATOR, "cases": out}


# ----------------------------------------------------------------------------------------------- orchestration
BUILDERS = {
    "nav/cases.json": build_nav,
    "env/env-golden.json": build_env,
    "env/env-l2-golden.json": build_env_l2,
    "metrics/metrics-golden.json": build_metrics,
}


def build_all() -> dict[str, str]:
    files = {rel: dumps(fn()) for rel, fn in BUILDERS.items()}
    manifest = {"specVersion": "golden/1", "generator": GENERATOR,
                "files": {rel: {"sha256": hashlib.sha256(txt.encode()).hexdigest(), "bytes": len(txt.encode())}
                          for rel, txt in files.items()}}
    files["manifest.json"] = json.dumps(manifest, indent=1) + "\n"
    return files


def main() -> None:
    for rel, txt in build_all().items():
        p = GOLDEN / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(txt, encoding="utf-8", newline="\n")
        print(p.relative_to(ROOT), len(txt))


if __name__ == "__main__":
    main()
