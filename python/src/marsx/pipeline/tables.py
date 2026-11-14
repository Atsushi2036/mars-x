"""Offline condition tables published next to the terrain (the web only reads them).

* ``sky_view_u8``   - sky view factor per 2 m cell from the 16 horizon maps.
* ``thermal_inertia_to_grid`` - THEMIS thermal inertia (100 m/px) resampled to the planning
  grid plus the slip material class (``marsx.conditions.slip`` thresholds).
* ``sun_table``     - Mars24 sun azimuth / elevation / distance per minute for a sol.
* ``owlt_table``    - hourly Earth-Mars one-way light time and link availability.

Everything is deterministic and uses the same functions as the real-time conditions engine,
so tables and live values cannot drift apart.
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from marsx.conditions import comms, mars24, slip

from . import derive
from .geo import Grid, LocalProjection
from .reproject import reproject_to_grid

SVF_ONE = 254  # u8 scale: sky view factor = q / 254, nodata 255
PERSEVERANCE_LANDING_UTC = datetime(2021, 2, 18, 20, 55, tzinfo=UTC)  # approx.; defines which sol contains landing = sol 0


def sky_view_u8(horizon: np.ndarray) -> np.ndarray:
    """mean over azimuths of cos^2(horizon elevation), as u8 (q/254); nodata 255."""
    ang = np.radians(derive.u8_to_angle(horizon))  # NaN where nodata
    svf = np.mean(np.cos(ang) ** 2, axis=0)
    out = np.clip(np.rint(np.nan_to_num(svf, nan=0.0) * SVF_ONE), 0, SVF_ONE).astype(np.uint8)
    out[np.isnan(svf)] = derive.U8_NODATA
    return out


def thermal_inertia_to_grid(arr, src_transform, src_crs, grid: Grid, proj: LocalProjection, nodata: float | None = 0.0):
    """Bilinear resample of thermal inertia onto ``grid`` and classify (0 loose, 1 mixed, 2 rocky, 255 unknown)."""
    ti = reproject_to_grid(np.asarray(arr, np.float32), src_transform, src_crs, grid, proj, "bilinear", src_nodata=nodata)
    return ti, slip.classify_thermal_inertia(ti)


def sun_table(start_ms: int, n: int, step_s: float, lat_deg: float, lon_east_deg: float) -> np.ndarray:
    """float32 [n, 3] = (azimuth deg cw from north, elevation deg, Mars-Sun distance AU)."""
    ms = int(start_ms) + np.rint(np.arange(n) * step_s * 1000.0).astype(np.int64)
    st = mars24.mars_solar_state(ms, lat_deg, lon_east_deg)
    return np.stack([np.asarray(st.azimuth_deg), np.asarray(st.elevation_deg), np.asarray(st.r_au)], axis=-1).astype(np.float32)


def perseverance_sol_start_ms(sol: int, lon_east_deg: float) -> int:
    """UTC ms of local mean solar midnight starting Perseverance sol ``sol`` (landing sol = 0)."""
    landing_ms = int(PERSEVERANCE_LANDING_UTC.timestamp() * 1000)
    day0 = np.floor(float(mars24.mars_sol_date(landing_ms)) + lon_east_deg / 360.0)
    return int(mars24.unix_ms_from_msd(day0 + sol - lon_east_deg / 360.0))


def owlt_table(start_ms: int, end_ms: int, step_h: float = 1.0) -> np.ndarray:
    """float32 [n, 2] = (one-way light time s, link available 1/0) every ``step_h`` hours."""
    ms = np.arange(int(start_ms), int(end_ms), int(step_h * 3_600_000), dtype=np.int64)
    return np.stack([np.asarray(comms.owlt_s(ms)), np.asarray(comms.link_available(ms), dtype=float)], axis=-1).astype(np.float32)
