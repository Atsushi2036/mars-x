"""Earth-Mars communications: one-way light time, solar conjunction, uplinks.

Sources
- Positions: JPL "Approximate Positions of the Planets", Table 1 (Keplerian
  elements and rates, valid 1800-2050 AD; E. M. Standish),
  https://ssd.jpl.nasa.gov/planets/approx_pos.html. Earth = Earth-Moon barycentre.
  Accuracy checked against JPL Horizons in ``tests/conditions/test_comms.py``
  (OWLT within 1 s on four dates, 2021-2030). Outside 1800-2050 the module raises.
- Speed of light 299792.458 km/s (exact, SI) and AU = 149597870.700 km (IAU 2012).
- One plan per sol: ``assumption`` (the operations mode of the benchmark, not a
  NASA constraint): one command uplink per sol received at a configurable LMST
  hour and no corrections until the next one.
- Conjunction moratorium: NASA paused commands to its Mars assets for about two
  weeks around the 2023-11-18 solar conjunction (11-25 Nov 2023,
  https://www.marsdaily.com/reports/NASAs_Mars_Missions_Persist_Through_Solar_Conjunction_999.html).
  ``CONJUNCTION_SEP_DEG`` is the Sun-Earth-Mars angle below which the link is
  closed: ``assumption``, calibrated so the closed window matches 11-25 Nov 2023
  (computed with this module's own ephemeris; see the test).
"""
from __future__ import annotations

import numpy as np

from .mars24 import SOL_DAYS, mars_sol_date, unix_ms_from_msd, unix_ms_to_jd_tt

C_KM_S = 299_792.458
AU_KM = 149_597_870.700
SOL_S = SOL_DAYS * 86400.0

# Standish Table 1: (value at J2000, rate per Julian century)
# a [AU], e, I [deg], L [deg], long.peri [deg], long.node [deg]
_EARTH = np.array(
    [
        [1.00000261, 0.00000562],
        [0.01671123, -0.00004392],
        [-0.00001531, -0.01294668],
        [100.46457166, 35999.37244981],
        [102.93768193, 0.32327364],
        [0.0, 0.0],
    ]
)
_MARS = np.array(
    [
        [1.52371034, 0.00001847],
        [0.09339410, 0.00007882],
        [1.84969142, -0.00813131],
        [-4.55343205, 19140.30268499],
        [-23.94362959, 0.44441088],
        [49.55953891, -0.29257343],
    ]
)

# assumption: calibrated to the 11-25 Nov 2023 moratorium (see module docstring).
CONJUNCTION_SEP_DEG = 2.1  # angle is 2.20 deg on 2023-11-11 and 2.04 deg on 2023-11-25 (this ephemeris)


def _helio_ecliptic(el: np.ndarray, jd_tt) -> np.ndarray:
    t = (np.asarray(jd_tt, dtype=float) - 2451545.0) / 36525.0
    if np.any(t < -2.0) or np.any(t > 0.5):
        raise ValueError("ephemeris valid for 1800-2050 AD only")
    a, e, inc, mean_l, varpi, node = (el[i, 0] + el[i, 1] * t for i in range(6))
    omega = varpi - node
    m = np.radians(((mean_l - varpi + 180.0) % 360.0) - 180.0)
    ecc = e
    big_e = m + ecc * np.sin(m)
    for _ in range(8):  # Newton iterations for Kepler's equation
        big_e = big_e - (big_e - ecc * np.sin(big_e) - m) / (1.0 - ecc * np.cos(big_e))
    xp = a * (np.cos(big_e) - ecc)
    yp = a * np.sqrt(1.0 - ecc**2) * np.sin(big_e)
    w, n, i = np.radians(omega), np.radians(node), np.radians(inc)
    cw, sw, cn, sn, ci, si = np.cos(w), np.sin(w), np.cos(n), np.sin(n), np.cos(i), np.sin(i)
    x = (cw * cn - sw * sn * ci) * xp + (-sw * cn - cw * sn * ci) * yp
    y = (cw * sn + sw * cn * ci) * xp + (-sw * sn + cw * cn * ci) * yp
    z = (sw * si) * xp + (cw * si) * yp
    return np.stack([x, y, z], axis=-1)


def _positions(unix_ms):
    jd = np.asarray(unix_ms_to_jd_tt(unix_ms), dtype=float)
    return _helio_ecliptic(_EARTH, jd), _helio_ecliptic(_MARS, jd)


def earth_mars_distance_au(unix_ms):
    """Instantaneous geometric Earth-Mars distance (AU)."""
    e, m = _positions(unix_ms)
    d = np.linalg.norm(m - e, axis=-1)
    return float(d) if d.ndim == 0 else d


def owlt_s(unix_ms):
    """One-way light time Earth-Mars in seconds (geometric range / c)."""
    return earth_mars_distance_au(unix_ms) * AU_KM / C_KM_S


def sun_earth_mars_angle_deg(unix_ms):
    """Angle Sun-Earth-Mars at Earth, in degrees (small near solar conjunction)."""
    e, m = _positions(unix_ms)
    to_sun = -e
    to_mars = m - e
    cosang = np.sum(to_sun * to_mars, axis=-1) / (
        np.linalg.norm(to_sun, axis=-1) * np.linalg.norm(to_mars, axis=-1)
    )
    ang = np.degrees(np.arccos(np.clip(cosang, -1.0, 1.0)))
    return float(ang) if ang.ndim == 0 else ang


def link_available(unix_ms):
    """False during the solar-conjunction commanding moratorium."""
    ok = np.asarray(sun_earth_mars_angle_deg(unix_ms)) >= CONJUNCTION_SEP_DEG
    return bool(ok) if ok.ndim == 0 else ok


def uplink_receive_times_ms(start_ms: int, end_ms: int, lmst_h: float, lon_east_deg: float):
    """Instants in [start_ms, end_ms) when LMST at ``lon_east_deg`` equals ``lmst_h``.

    One entry per sol (mode "one plan per sol": the plan is received at that
    local hour; the Earth-side send time is ``t - owlt_s(t)``).
    """
    lon_w = -float(lon_east_deg)
    msd0 = float(mars_sol_date(int(start_ms)))
    msd1 = float(mars_sol_date(int(end_ms)))
    frac = ((lmst_h + lon_w / 15.0) % 24.0) / 24.0  # MSD fractional part giving LMST = lmst_h
    first = np.floor(msd0 - frac) + 1.0 + frac
    first = first - 1.0 if first - 1.0 >= msd0 else first
    msds = np.arange(first, msd1, 1.0)
    t = unix_ms_from_msd(msds)
    return t[(t >= start_ms) & (t < end_ms)]
