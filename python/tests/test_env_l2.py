"""L2 in the environment: sun, insolation + horizon shadows, comms, solar/RTG energy, astronaut space-weather rule."""

from __future__ import annotations

import math

import numpy as np
import pytest

pytest.importorskip("gymnasium")

from marsx.contracts import obs as spec  # noqa: E402
from marsx.env import scenarios  # noqa: E402
from marsx.env.core import NavBatch  # noqa: E402
from marsx.env.terrain import Terrain  # noqa: E402

ENV, COMM = spec.block("environment"), spec.block("comm")


def flat(n=32, horizon_deg: float | None = 0.0) -> Terrain:
    z = np.zeros((n, n), np.float32)
    hz = None if horizon_deg is None else np.full((16, n, n), horizon_deg, np.float16)
    return Terrain(z.copy(), z.copy(), z.copy(), 2.0, "flat", horizon_deg=hz)


def engine(sid: str, terrain=None, **kw) -> NavBatch:
    eng = NavBatch(terrain or flat(), scenarios.get(sid), num_envs=1, seed=0, autoreset=False, **kw)
    eng.reset_to([0], starts=[(10, 10)], goals=[(10, 25)])
    return eng


def env_block(eng) -> np.ndarray:
    return eng.observe()[0, ENV.start:ENV.start + ENV.size]


def test_sun_elevation_and_tau_in_observation():
    clear, storm = engine("jezero-v1/l2/solar-clear"), engine("jezero-v1/l2/solar-storm")
    assert env_block(clear)[0] == pytest.approx(math.sin(math.radians(47.9)), abs=0.02)  # Mars24 at 09:00 LTST
    assert env_block(clear)[6] == pytest.approx(0.5 / 3) and env_block(storm)[6] == pytest.approx(2.0 / 3)
    ltst_angle = math.atan2(env_block(clear)[3], env_block(clear)[4]) % (2 * math.pi)
    assert ltst_angle * 24 / (2 * math.pi) == pytest.approx(9.0, abs=0.05)


def _soc_after_waits(eng, n=20) -> float:
    eng.soc[:] = 0.5
    for _ in range(n):
        eng.step(np.array([spec.WAIT]))
    return float(eng.soc[0])


def test_solar_balance_positive_on_clear_sol_negative_in_storm():
    assert _soc_after_waits(engine("jezero-v1/l2/solar-clear")) > 0.5
    assert _soc_after_waits(engine("jezero-v1/l2/solar-storm")) < 0.5


def test_horizon_shadow_cuts_direct_light():
    open_sky = engine("jezero-v1/l2/solar-clear")
    walled = engine("jezero-v1/l2/solar-clear", terrain=flat(horizon_deg=80.0))
    args = (np.zeros(1), np.array([10]), np.array([10]))
    assert open_sky.conditions.lit(*args)[0] and not walled.conditions.lit(*args)[0]
    assert walled.conditions.irradiance(*args)[0] < 0.5 * open_sky.conditions.irradiance(*args)[0]
    assert _soc_after_waits(walled) < _soc_after_waits(engine("jezero-v1/l2/solar-clear"))


def test_rtg_rover_keeps_charge_in_the_storm():
    assert _soc_after_waits(engine("jezero-v1/l2/rtg-storm")) >= 0.5


def test_one_plan_per_sol_comm_block():
    eng = engine("jezero-v1/l3/rtg-onesol")
    c = eng.observe()[0, COMM.start:COMM.start + COMM.size]
    assert c[0] == 1.0 and 0.0 <= c[1] <= 1.0 and 0.0 < c[2] < 1.0


def test_l1_scenarios_have_no_l2_conditions():
    assert engine("jezero-v1/l1/rtg-geometry").conditions is None


def test_astronaut_consumables_drain_while_waiting():
    eng = engine("jezero-v1/l2/astronaut-clear")
    eng.alert_t[:] = np.nan
    soc0 = float(eng.soc[0])
    eng.step(np.array([spec.WAIT]))
    assert eng.soc[0] < soc0


def test_spe_alert_redirects_goal_to_shelter_and_returning_succeeds():
    eng = engine("jezero-v1/l2/astronaut-clear")
    eng.alert_t[:] = 1.0
    eng.step(np.array([2]))  # E: alert fires (t >= 1 s), goal becomes the start cell (shelter)
    assert tuple(eng.goal_cells()[0]) == (10, 10)
    _, _, term, _, info = eng.step(np.array([3]))  # W: back in the shelter within the window
    assert term[0] and info["outcome"][0] == "success"


def test_spe_violation_when_shelter_not_reached_in_time():
    eng = engine("jezero-v1/l2/astronaut-clear")
    eng.alert_t[:] = 1.0
    eng.spe_window_s = 5.0
    outcome = ""
    for _ in range(10):
        _, _, term, _, info = eng.step(np.array([2]))
        if term[0]:
            outcome = info["outcome"][0]
            break
    assert outcome == "spe_violation"


DATA = __import__("pathlib").Path(__file__).resolve().parents[2] / "data" / "processed" / "jezero-v1"


@pytest.mark.skipif(not (DATA / "manifest.json").exists(), reason="processed dataset not built")
def test_l2_reads_pipeline_tables_as_single_source():
    from marsx.conditions import mars24
    from marsx.env.l2 import MarsConditions
    from marsx.env.terrain import load_terrain

    t = load_terrain(DATA)
    storm = MarsConditions(scenarios.get("jezero-v1/l2/solar-storm"), t)
    assert storm.sources == {"sun": "table:sun_sol_314+sun_sol_315", "owlt": "table:owlt", "skyView": "layer:sky_view"}
    ms = storm.t0_ms + np.arange(0, 600) * 60_000
    ref = mars24.mars_solar_state(ms, t.center_lat_deg, t.center_lon_east_deg)
    # manifest startUtc is truncated to whole seconds (sun moves ~0.004 deg/s): 0.01 deg tolerance
    np.testing.assert_allclose(storm.elev[:600], np.asarray(ref.elevation_deg), atol=1e-2)
    clear = MarsConditions(scenarios.get("jezero-v1/l2/solar-clear"), t)
    assert clear.sources["sun"] == "mars24" and clear.sources["owlt"] == "table:owlt"
