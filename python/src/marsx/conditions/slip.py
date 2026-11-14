"""Wheel slip proxy from THEMIS thermal inertia and slope.

s(theta, class) = s0 + s1 * max(0, theta - theta0)^2, clipped to [0, 1].

Material classes come from THEMIS night-time thermal inertia (100 m/px, ~20 % accuracy;
Fergason, Christensen & Kieffer 2006, JGR 111 E12004, doi:10.1029/2006JE002735): low thermal
inertia = fine/loose material, high = rock/bedrock. Perseverance slip tables are not public, so
class thresholds and s0/s1/theta0 are team assumptions (PROXY, not wheel-soil mechanics; the
scorecard lists wheel-soil interaction as "not covered").
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

from marsx.conditions.params import Param, assumption

_FERGASON = "Fergason, Christensen & Kieffer 2006, JGR 111 E12004, doi:10.1029/2006JE002735"

LOOSE, MIXED, ROCKY, UNKNOWN = np.uint8(0), np.uint8(1), np.uint8(2), np.uint8(255)


@dataclass(frozen=True, slots=True)
class SlipClass:
    name: str
    s0: float
    s1: float  # 1/deg^2
    theta0_deg: float


CLASS_PARAMS: dict[int, SlipClass] = {
    int(LOOSE): SlipClass("loose fines / sand (low TI)", 0.05, 0.0015, 5.0),
    int(MIXED): SlipClass("mixed / indurated (mid TI)", 0.03, 0.0008, 8.0),
    int(ROCKY): SlipClass("rock / bedrock (high TI)", 0.01, 0.0003, 12.0),
}
CLASS_PARAMS[int(UNKNOWN)] = CLASS_PARAMS[int(MIXED)]

TI_LOOSE_MAX = assumption(150.0, "J m^-2 K^-1 s^-1/2", "upper thermal inertia of loose fines class")
TI_ROCKY_MIN = assumption(400.0, "J m^-2 K^-1 s^-1/2", "lower thermal inertia of rock/bedrock class")
STUCK_THRESHOLD = assumption(0.6, "-", "slip ratio above which the rover is considered embedded")
THERMAL_INERTIA_ACCURACY = Param(0.20, "-", "measured", _FERGASON, note="THEMIS TI relative accuracy")


def all_params() -> dict[str, Param]:
    out: dict[str, Param] = {
        "ti_loose_max": TI_LOOSE_MAX,
        "ti_rocky_min": TI_ROCKY_MIN,
        "stuck_threshold": STUCK_THRESHOLD,
        "thermal_inertia_accuracy": THERMAL_INERTIA_ACCURACY,
    }
    for code in (LOOSE, MIXED, ROCKY):
        c = CLASS_PARAMS[int(code)]
        why = f"slip curve of class '{c.name}'"
        out[f"s0_{int(code)}"] = assumption(c.s0, "-", why)
        out[f"s1_{int(code)}"] = assumption(c.s1, "1/deg^2", why)
        out[f"theta0_{int(code)}"] = assumption(c.theta0_deg, "deg", why)
    return out


def classify_thermal_inertia(ti: ArrayLike) -> NDArray[np.uint8]:
    t = np.asarray(ti, dtype=np.float64)
    cls = np.full(t.shape, MIXED, dtype=np.uint8)
    cls[t < TI_LOOSE_MAX.value] = LOOSE
    cls[t >= TI_ROCKY_MIN.value] = ROCKY
    cls[~np.isfinite(t)] = UNKNOWN
    return cls


# Lookup tables indexed by class code (0..255) for vectorised evaluation.
_S0 = np.full(256, CLASS_PARAMS[int(MIXED)].s0)
_S1 = np.full(256, CLASS_PARAMS[int(MIXED)].s1)
_TH0 = np.full(256, CLASS_PARAMS[int(MIXED)].theta0_deg)
for _code, _c in CLASS_PARAMS.items():
    _S0[_code], _S1[_code], _TH0[_code] = _c.s0, _c.s1, _c.theta0_deg


def slip_ratio(slope_deg: ArrayLike, cls: ArrayLike) -> NDArray[np.float64] | float:
    scalar = np.ndim(slope_deg) == 0 and np.ndim(cls) == 0
    th = np.abs(np.asarray(slope_deg, dtype=np.float64))
    c = np.asarray(cls, dtype=np.uint8)
    s = _S0[c] + _S1[c] * np.maximum(0.0, th - _TH0[c]) ** 2
    s = np.clip(s, 0.0, 1.0)
    return float(s) if scalar else s


def is_stuck(s: ArrayLike) -> NDArray[np.bool_] | bool:
    out = np.asarray(s, dtype=np.float64) > STUCK_THRESHOLD.value
    return bool(out) if np.ndim(s) == 0 else out


def speed_factor(s: ArrayLike) -> NDArray[np.float64] | float:
    out = 1.0 - np.clip(np.asarray(s, dtype=np.float64), 0.0, 1.0)
    return float(out) if np.ndim(s) == 0 else out
