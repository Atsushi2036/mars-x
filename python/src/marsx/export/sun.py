"""Sun direction in the local ENU frame from Mars24 for the scenario's UTC time and the site position."""

from __future__ import annotations

import math
from datetime import UTC, datetime

import numpy as np

from marsx.conditions.mars24 import mars_solar_state

# 09:00 LTST at Jezero, aphelion clear season (used when a scenario has no time of its own)
DEFAULT_START_UTC = "2021-07-20T15:09:00Z"


def parse_utc_ms(s: str) -> int:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return round(dt.timestamp() * 1000)


def sun_enu(start_utc: str, lat_deg: float, lon_east_deg: float) -> dict:
    st = mars_solar_state(parse_utc_ms(start_utc), lat_deg, lon_east_deg)
    el, az = math.radians(float(st.elevation_deg)), math.radians(float(st.azimuth_deg))
    vec = (math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el))  # towards the Sun: E, N, U
    return {"vector": [round(v, 9) for v in vec], "elevationDeg": float(st.elevation_deg),
            "azimuthDegFromNorthCw": float(st.azimuth_deg), "ltstH": float(st.ltst_h), "lsDeg": float(st.ls_deg),
            "rAu": float(st.r_au), "startUtc": start_utc, "model": "Mars24 (Allison and McEwen 2000)"}


def angle_deg(a, b) -> float:
    a, b = np.asarray(a, float), np.asarray(b, float)
    c = float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
    return math.degrees(math.acos(max(-1.0, min(1.0, c))))
