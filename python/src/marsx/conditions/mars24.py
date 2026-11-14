"""Mars24 solar-geometry algorithm (vectorised, NumPy).

Source: Allison, M. and McEwen, M. (2000), "A post-Pathfinder evaluation of
areocentric solar coordinates with improved timing recipes for Mars seasonal /
diurnal climate studies", Planetary and Space Science 48, 215-235; as published
(with two worked examples) by NASA GISS:
https://www.giss.nasa.gov/tools/mars24/help/algorithm.html

Step names (A-1 ... D-6) follow that page. Every coefficient below comes from
that source except where marked ``assumption``.

Conventions: longitudes in this module's public API are EAST-positive degrees
(the pipeline convention); Mars24 uses WEST-positive longitudes and the code
converts internally. Azimuth is clockwise from north. ``ltst_h`` is Local True
Solar Time (the hour of the sun), ``lmst_h`` Local Mean Solar Time.

Leap seconds (TAI-UTC) come from the IERS table (``_LEAP``); after the last entry
(2017-01-01, 37 s) the value is held constant (``assumption``: no further leap
second is announced; CGPM Resolution 4 (2022) plans to retire them by 2035).
Before 1972 the algorithm needs the Mars24 polynomial for TT-UTC, which is not
implemented: such dates raise ``ValueError``.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

# (UTC unix seconds at which TAI-UTC becomes N)  -- IERS Bulletin C history
_LEAP = (
    ("1972-01-01", 10), ("1972-07-01", 11), ("1973-01-01", 12), ("1974-01-01", 13),
    ("1975-01-01", 14), ("1976-01-01", 15), ("1977-01-01", 16), ("1978-01-01", 17),
    ("1979-01-01", 18), ("1980-01-01", 19), ("1981-07-01", 20), ("1982-07-01", 21),
    ("1983-07-01", 22), ("1985-07-01", 23), ("1988-01-01", 24), ("1990-01-01", 25),
    ("1991-01-01", 26), ("1992-07-01", 27), ("1993-07-01", 28), ("1994-07-01", 29),
    ("1996-01-01", 30), ("1997-07-01", 31), ("1999-01-01", 32), ("2006-01-01", 33),
    ("2009-01-01", 34), ("2012-07-01", 35), ("2015-07-01", 36), ("2017-01-01", 37),
)
_LEAP_MS = np.array([np.datetime64(d, "ms").astype(np.int64) for d, _ in _LEAP], dtype=np.int64)
_LEAP_S = np.array([n for _, n in _LEAP], dtype=np.int64)

TT_MINUS_TAI_S = 32.184
SOL_DAYS = 1.0274912517  # Mars sol in Earth days (C-2)

# B-3 planetary perturbers
_PBS_A = np.array([0.0071, 0.0057, 0.0039, 0.0037, 0.0021, 0.0020, 0.0018])
_PBS_TAU = np.array([2.2353, 2.7543, 1.1177, 15.7866, 2.1354, 2.4694, 32.8493])
_PBS_PHI = np.array([49.409, 168.173, 191.837, 21.736, 15.704, 95.528, 49.095])


def leap_seconds_tai_utc(unix_ms):
    """TAI-UTC in seconds at the given UTC instant(s) (1972 onwards)."""
    ms = np.asarray(unix_ms, dtype=np.int64)
    if np.any(ms < _LEAP_MS[0]):
        raise ValueError("dates before 1972-01-01 are not supported (no TT-UTC polynomial)")
    out = _LEAP_S[np.searchsorted(_LEAP_MS, ms, side="right") - 1]
    return int(out) if out.ndim == 0 else out


def unix_ms_to_jd_tt(unix_ms):
    """A-1..A-3: Unix milliseconds (UTC) -> Julian Date in Terrestrial Time."""
    ms = np.asarray(unix_ms, dtype=np.int64)
    jd_ut = 2440587.5 + ms / 8.64e7  # A-1
    tt_utc = TT_MINUS_TAI_S + np.asarray(leap_seconds_tai_utc(ms), dtype=float)  # A-2
    jd_tt = jd_ut + tt_utc / 86400.0  # A-3
    return float(jd_tt) if jd_tt.ndim == 0 else jd_tt


def mars_sol_date(unix_ms):
    """C-2: Mars Sol Date (continuous sol count; MST = 24 h * frac(MSD))."""
    jd_tt = unix_ms_to_jd_tt(unix_ms)
    return (jd_tt - 2451549.5) / SOL_DAYS + 44796.0 - 0.0009626


@dataclass(frozen=True)
class SolarState:
    """Outputs of Mars24 (arrays or floats, matching the input shape)."""

    delta_t_j2000: object  # days since J2000 in TT (A-4)
    mean_anomaly_deg: object  # M (B-1)
    fms_deg: object  # alpha_FMS (B-2)
    pbs_deg: object  # perturbers (B-3)
    nu_minus_m_deg: object  # equation of center (B-4)
    ls_deg: object  # areocentric solar longitude, [0, 360) (B-5)
    eot_deg: object  # equation of time (C-1)
    mst_h: object  # mean solar time at the prime meridian (C-2)
    lmst_h: object  # local mean solar time (C-3)
    ltst_h: object  # local true solar time (C-4)
    subsolar_lon_w_deg: object  # (C-5)
    declination_deg: object  # solar declination (D-1)
    r_au: object  # Mars-Sun distance (D-2)
    zenith_deg: object  # (D-5)
    elevation_deg: object  # 90 - zenith
    azimuth_deg: object  # (D-6), clockwise from north


def mars_solar_state(unix_ms, lat_deg, lon_east_deg) -> SolarState:
    """Full Mars24 solution for UTC instant(s) and planetocentric site(s)."""
    ms = np.asarray(unix_ms, dtype=np.int64)
    lat = np.radians(np.asarray(lat_deg, dtype=float))
    lon_w = -np.asarray(lon_east_deg, dtype=float)

    jd_tt = np.asarray(unix_ms_to_jd_tt(ms), dtype=float)
    dt = jd_tt - 2451545.0  # A-4

    m = 19.3871 + 0.52402073 * dt  # B-1
    fms = 270.3871 + 0.524038496 * dt  # B-2
    arg = np.radians(0.985626 * np.asarray(dt)[..., None] / _PBS_TAU + _PBS_PHI)
    pbs = np.sum(_PBS_A * np.cos(arg), axis=-1)  # B-3
    mr = np.radians(m)
    nu_m = (
        (10.691 + 3.0e-7 * dt) * np.sin(mr)
        + 0.623 * np.sin(2 * mr)
        + 0.050 * np.sin(3 * mr)
        + 0.005 * np.sin(4 * mr)
        + 0.0005 * np.sin(5 * mr)
        + pbs
    )  # B-4
    ls = (fms + nu_m) % 360.0  # B-5
    lsr = np.radians(ls)

    eot = 2.861 * np.sin(2 * lsr) - 0.071 * np.sin(4 * lsr) + 0.002 * np.sin(6 * lsr) - nu_m  # C-1
    msd = (jd_tt - 2451549.5) / SOL_DAYS + 44796.0 - 0.0009626  # C-2
    mst = 24.0 * (msd % 1.0)
    lmst = (mst - lon_w / 15.0) % 24.0  # C-3
    ltst = (lmst + eot / 15.0) % 24.0  # C-4
    sub_lon = (mst * 15.0 + eot + 180.0) % 360.0  # C-5 (west-positive)

    dec = np.degrees(np.arcsin(0.42565 * np.sin(lsr))) + 0.25 * np.sin(lsr)  # D-1
    decr = np.radians(dec)
    r_au = 1.52367934 * (
        1.00436
        - 0.09309 * np.cos(mr)
        - 0.004336 * np.cos(2 * mr)
        - 0.00031 * np.cos(3 * mr)
        - 0.00003 * np.cos(4 * mr)
    )  # D-2

    h = np.radians(sub_lon - lon_w)  # hour angle of the sun (positive after noon)
    cosz = np.sin(decr) * np.sin(lat) + np.cos(decr) * np.cos(lat) * np.cos(h)  # D-5
    zen = np.degrees(np.arccos(np.clip(cosz, -1.0, 1.0)))
    az = (
        np.degrees(np.arctan2(np.sin(h), np.cos(h) * np.sin(lat) - np.tan(decr) * np.cos(lat)))
        + 180.0
    ) % 360.0  # D-6 (atan2 form, clockwise from north)

    def out(x):
        x = np.asarray(x)
        return float(x) if x.ndim == 0 else x

    return SolarState(
        out(dt), out(m), out(fms), out(pbs), out(nu_m), out(ls), out(eot), out(mst),
        out(lmst), out(ltst), out(sub_lon), out(dec), out(r_au), out(zen), out(90.0 - zen), out(az),
    )
