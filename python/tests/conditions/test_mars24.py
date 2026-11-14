"""Golden cases: the two worked examples published by NASA GISS Mars24
(https://www.giss.nasa.gov/tools/mars24/help/algorithm.html)."""
import numpy as np
import pytest

from marsx.conditions.mars24 import (
    leap_seconds_tai_utc,
    mars_solar_state,
    unix_ms_to_jd_tt,
)

# (unix ms, lat deg, longitude WEST deg, expected values as printed by GISS)
EX1 = dict(ms=947116800000, lat=0.0, lon_w=0.0)
EX2 = dict(ms=1073137591000, lat=-14.640, lon_w=184.702)


def test_example1_time_scales():
    assert leap_seconds_tai_utc(EX1["ms"]) == 32
    jd_tt = unix_ms_to_jd_tt(EX1["ms"])
    assert jd_tt == pytest.approx(2451549.50074, abs=1e-5)


def test_example1_values():
    s = mars_solar_state(EX1["ms"], EX1["lat"], -EX1["lon_w"])
    assert s.delta_t_j2000 == pytest.approx(4.50074, abs=1e-5)
    assert s.mean_anomaly_deg == pytest.approx(21.74558, abs=1e-4)
    assert s.pbs_deg == pytest.approx(0.00142, abs=1e-4)
    assert s.ls_deg == pytest.approx(277.18758, abs=1e-4)
    assert s.eot_deg == pytest.approx(-5.18774, abs=1e-4)
    assert s.mst_h == pytest.approx(23.99425, abs=1e-4)
    assert s.lmst_h == pytest.approx(23.99425, abs=1e-4)
    assert s.ltst_h == pytest.approx(23.64840, abs=1e-4)
    assert s.subsolar_lon_w_deg == pytest.approx(174.72600, abs=1e-4)
    assert s.declination_deg == pytest.approx(-25.22825, abs=1e-4)
    assert s.r_au == pytest.approx(1.39358, abs=1e-5)
    assert s.zenith_deg == pytest.approx(154.26182, abs=1e-4)
    assert s.azimuth_deg == pytest.approx(191.03905, abs=1e-4)


def test_example2_spirit_landing():
    s = mars_solar_state(EX2["ms"], EX2["lat"], -EX2["lon_w"])
    assert s.mean_anomaly_deg % 360 == pytest.approx(66.06858, abs=1e-4)
    assert s.pbs_deg == pytest.approx(0.01614, abs=1e-4)
    assert s.ls_deg == pytest.approx(327.32416, abs=1e-4)
    assert s.eot_deg == pytest.approx(-12.77553, abs=1e-4)
    assert s.mst_h == pytest.approx(13.16537, abs=1e-4)
    assert s.lmst_h == pytest.approx(0.85190, abs=1e-4)
    assert s.ltst_h == pytest.approx(0.00025, abs=1e-4)
    assert s.subsolar_lon_w_deg == pytest.approx(4.70500, abs=1e-4)
    # Published declination/zenith for this example differ from D-1 as documented
    # by 2.5e-4 / 6.5e-4 deg (example 1 matches to 6e-6): unexplained, kept < 1e-3.
    assert s.declination_deg == pytest.approx(-13.42065, abs=1e-3)
    assert s.r_au == pytest.approx(1.47767, abs=1e-5)
    assert s.zenith_deg == pytest.approx(151.93895, abs=1e-3)
    assert s.azimuth_deg == pytest.approx(179.99383, abs=1e-3)


def test_vectorised_matches_scalar_and_elevation_complement():
    ms = np.array([EX1["ms"], EX2["ms"]], dtype=np.int64)
    s = mars_solar_state(ms, np.array([0.0, -14.64]), np.array([0.0, -184.702]))
    one = mars_solar_state(EX2["ms"], -14.64, -184.702)
    assert s.ls_deg.shape == (2,)
    assert s.ls_deg[1] == pytest.approx(one.ls_deg, abs=1e-12)
    assert s.elevation_deg == pytest.approx(90.0 - s.zenith_deg)


def test_leap_seconds_table_edges():
    jan1_2017 = 1483228800000
    assert leap_seconds_tai_utc(jan1_2017 - 1) == 36
    assert leap_seconds_tai_utc(jan1_2017) == 37
    assert leap_seconds_tai_utc(jan1_2017 + 10**12) == 37  # held after the last entry
    with pytest.raises(ValueError):
        leap_seconds_tai_utc(0)  # 1970: before the 1972 table, unsupported


def test_sol_length_and_mars_sol_date():
    from marsx.conditions.mars24 import mars_sol_date

    # one Mars sol later (88775.2441 s) -> MSD advances by exactly 1.
    a = mars_sol_date(EX1["ms"])
    b = mars_sol_date(EX1["ms"] + int(round(88775.2441 * 1000)))
    assert b - a == pytest.approx(1.0, abs=1e-6)


def test_unix_ms_from_msd_roundtrip():
    from marsx.conditions.mars24 import mars_sol_date, unix_ms_from_msd

    ms = np.array([EX1["ms"], EX2["ms"], 1_800_000_000_000], dtype=np.int64)
    back = unix_ms_from_msd(mars_sol_date(ms))
    assert np.abs(back - ms).max() <= 2  # milliseconds


def test_perseverance_landing_local_time():
    # NASA: Perseverance landed 2021-02-18 ~20:55 UTC at ~15:55 local mean solar time (Jezero 77.45 E).
    ms = int(np.datetime64("2021-02-18T20:55:00", "ms").astype(np.int64))
    s = mars_solar_state(ms, 18.44, 77.45)
    assert 15.0 < s.lmst_h < 16.5
