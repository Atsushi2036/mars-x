"""Golden values from JPL Horizons (observer table, Mars (499) seen from the Earth
centre, quantity 20 'delta'), fetched 2026-11-14 from
https://ssd.jpl.nasa.gov/api/horizons.api (CENTER='500@399', TIME_TYPE='UT').
Horizons' delta is light-time corrected; ours is the instantaneous geometric
range, so up to ~0.2 s of OWLT difference is expected (tolerance 1 s)."""
import numpy as np
import pytest

from marsx.conditions.comms import (
    AU_KM,
    C_KM_S,
    CONJUNCTION_SEP_DEG,
    earth_mars_distance_au,
    link_available,
    owlt_s,
    sun_earth_mars_angle_deg,
    uplink_receive_times_ms,
)
from marsx.conditions.mars24 import mars_sol_date, unix_ms_to_jd_tt


def ms(iso: str) -> int:
    return int(np.datetime64(iso, "ms").astype(np.int64))


HORIZONS = [
    ("2021-02-18T20:55:00", 1.36734869418727),
    ("2023-11-12T12:00:00", 2.53393032847050),
    ("2027-02-19T12:00:00", 0.67794770204344),
    ("2030-07-01T00:00:00", 2.54445612265476),
]


@pytest.mark.parametrize("iso,delta_au", HORIZONS)
def test_owlt_matches_horizons_within_one_second(iso, delta_au):
    expected_s = delta_au * AU_KM / C_KM_S
    assert owlt_s(ms(iso)) == pytest.approx(expected_s, abs=1.0)


def test_distance_is_vectorised_and_in_physical_range():
    t = np.arange(ms("2026-01-01T00:00:00"), ms("2030-01-01T00:00:00"), 86400_000 * 5)
    d = earth_mars_distance_au(t)
    assert d.shape == t.shape and d.min() > 0.37 and d.max() < 2.7


def test_owlt_range_matches_documented_3_to_22_minutes():
    t = np.arange(ms("2020-01-01T00:00:00"), ms("2036-01-01T00:00:00"), 86400_000 * 3)
    o = owlt_s(t) / 60.0
    assert 3.0 < o.min() < 5.0 and 20.0 < o.max() < 23.0


def test_conjunction_window_nov_2023_is_closed_then_open():
    # NASA: commanding pause ~11-25 Nov 2023 (marsdaily, design-intelligence F11).
    assert not link_available(ms("2023-11-18T12:00:00"))
    assert not link_available(ms("2023-11-12T00:00:00"))
    assert not link_available(ms("2023-11-24T12:00:00"))
    assert link_available(ms("2023-11-05T00:00:00"))
    assert link_available(ms("2023-12-01T00:00:00"))
    assert link_available(ms("2027-02-19T12:00:00"))  # opposition
    assert sun_earth_mars_angle_deg(ms("2023-11-18T12:00:00")) < CONJUNCTION_SEP_DEG
    assert sun_earth_mars_angle_deg(ms("2027-02-19T12:00:00")) > 150


def test_uplink_one_plan_per_sol():
    lon = 77.45  # Jezero, deg east
    t0 = ms("2026-11-14T00:00:00")
    t1 = t0 + int(10 * 88775.2441 * 1000)
    ups = uplink_receive_times_ms(t0, t1, lmst_h=8.0, lon_east_deg=lon)
    assert 9 <= len(ups) <= 11
    assert np.allclose(np.diff(ups) / 1000.0, 88775.2441, atol=0.01)
    from marsx.conditions.mars24 import mars_solar_state

    st = mars_solar_state(ups, 18.4, lon)
    assert np.allclose(st.lmst_h, 8.0, atol=1e-4)
    assert (ups >= t0).all() and (ups < t1).all()
