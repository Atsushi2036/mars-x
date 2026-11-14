"""Energy models: RTG rover (Perseverance-like), solar rover (MER-like) and EVA astronaut.

All functions are NumPy-vectorised (scalars in -> floats out; arrays in -> arrays out) so the
vectorised environment can call them for thousands of agents per step. Every number lives in
``PARAMS`` with its provenance; assumptions are labelled and calibrable.
"""

from __future__ import annotations


import numpy as np
from numpy.typing import ArrayLike, NDArray

from marsx.conditions.params import Param, assumption

_ROVER = "NASA, Perseverance rover components: https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/"
_POWER = "JPL Mars 2020 press kit, power: https://www.jpl.nasa.gov/news/press_kits/mars_2020/launch/mission/spacecraft/power/"
_MMRTG = "NASA MMRTG fact sheet (BOL 110 W, 72 W at 17 years): https://science.nasa.gov/wp-content/uploads/2024/02/mmrtg-factsheet-updated-5-18-20-1.pdf"
_MER = "MER 2004 press kit (140 W full sun, ~4 h/sol), cited in https://solarviews.com/eng/spirit.htm"
_APOLLO = "Waligora et al. 1975, NASA TN D-7883 (Apollo lunar EVA 780-1200 BTU/h): https://www.nasa.gov/wp-content/uploads/static/history/alsj/tnD7883Metabolic.pdf"
_NSSDC = "NSSDCA Mars Fact Sheet: https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html"

BTU_PER_H_TO_W = 0.29307107
W_TO_KCAL_PER_H = 0.859845

PARAMS: dict[str, Param] = {
    # --- RTG rover (Perseverance) ---
    "rtg_bol_w": Param(110.0, "W", "measured", f"{_POWER}; {_MMRTG}", note="beginning of life"),
    "rtg_decay_per_year": Param(
        0.025, "1/yr", "derived",
        f"1 - (72/110)^(1/17) = 2.46 %/yr, rounded to 2.5 %/yr; {_MMRTG}",
        note="~2.5 %/yr design value; MSL observed up to 4.8 %/yr on a hot Mars (NASA NF4 workshop)",
    ),
    "battery_count": Param(2.0, "-", "measured", _POWER),
    "battery_ah_each": Param(43.0, "Ah", "measured", _POWER),
    "battery_voltage": assumption(28.0, "V", "28 V nominal rover bus; not stated in the press kit"),
    "peak_demand_w": Param(900.0, "W", "measured", _POWER, note="science activities"),
    "rover_mass_kg": Param(1025.0, "kg", "measured", _ROVER),
    "rover_speed": Param(0.042, "m/s", "measured", _ROVER, note="top speed 152 m/h"),
    "rolling_resistance": assumption(0.15, "-", "wheel-regolith rolling resistance coefficient"),
    "drive_efficiency": assumption(0.5, "-", "motor + gear train efficiency"),
    "base_load_w": assumption(60.0, "W", "avionics/heaters while driving"),
    # --- Solar rover (MER reference) ---
    "solar_panel_w": Param(140.0, "W", "measured", _MER, note="output in full sunlight"),
    "solar_reference_irradiance": assumption(
        586.2, "W/m^2", "140 W rated at Mars mean top-of-atmosphere irradiance (NSSDC)", note=_NSSDC
    ),
    "solar_dust_loss": assumption(0.20, "-", "fractional panel output loss from dust deposition"),
    # --- EVA astronaut ---
    "met_rate_low_w": Param(round(780 * BTU_PER_H_TO_W, 1), "W", "measured", _APOLLO, note="780 BTU/h ~ 197 kcal/h"),
    "met_rate_high_w": Param(round(1200 * BTU_PER_H_TO_W, 1), "W", "measured", _APOLLO, note="1200 BTU/h ~ 302 kcal/h"),
    "met_slope_full_deg": assumption(20.0, "deg", "slope at which the upper Apollo rate is reached (linear)"),
    "astronaut_speed": assumption(1.0, "m/s", "walking speed in a pressurised suit"),
    "eva_duration_h": assumption(8.0, "h", "EVA consumables duration"),
}


def all_params() -> dict[str, Param]:
    return dict(PARAMS)


def _v(name: str) -> float:
    return PARAMS[name].value


def _out(x: NDArray[np.float64], scalar: bool) -> NDArray[np.float64] | float:
    return float(x) if scalar else x


# ---------------------------------------------------------------- RTG rover

def rtg_power_w(years_since_fueling: float) -> float:
    if years_since_fueling < 0:
        raise ValueError("years_since_fueling must be >= 0")
    return _v("rtg_bol_w") * (1.0 - _v("rtg_decay_per_year")) ** years_since_fueling


def battery_capacity_wh() -> float:
    return _v("battery_count") * _v("battery_ah_each") * _v("battery_voltage")


def rover_drive_power_w(slope_deg: ArrayLike, gravity: float) -> NDArray[np.float64] | float:
    """Electrical power while driving up (+) / down (-) a slope at nominal speed.

    P = m g v (C_rr cos(theta) + sin(theta)) / eta + P_base, traction clipped at 0 (no regeneration).
    """
    scalar = np.ndim(slope_deg) == 0
    th = np.radians(np.asarray(slope_deg, dtype=np.float64))
    traction = _v("rover_mass_kg") * gravity * _v("rover_speed") * (
        _v("rolling_resistance") * np.cos(th) + np.sin(th)
    ) / _v("drive_efficiency")
    return _out(np.maximum(traction, 0.0) + _v("base_load_w"), scalar)


def rover_drive_energy_wh(
    distance_m: ArrayLike, slope_deg: ArrayLike, gravity: float, slip: ArrayLike = 0.0
) -> NDArray[np.float64] | float:
    """Energy for a move; slip s stretches the drive time by 1/(1-s)."""
    scalar = np.ndim(distance_m) == 0 and np.ndim(slope_deg) == 0 and np.ndim(slip) == 0
    s = np.clip(np.asarray(slip, dtype=np.float64), 0.0, 0.99)
    t_s = np.asarray(distance_m, dtype=np.float64) / _v("rover_speed") / (1.0 - s)
    e = np.asarray(rover_drive_power_w(slope_deg, gravity)) * t_s / 3600.0
    return _out(e, scalar)


# ---------------------------------------------------------------- solar rover

def solar_power_w(
    irradiance_w_m2: ArrayLike, in_shadow: ArrayLike = False
) -> NDArray[np.float64] | float:
    """P = P_ref * G / G_ref * (1 - dust); 0 in shadow (PO S2-04)."""
    scalar = np.ndim(irradiance_w_m2) == 0 and np.ndim(in_shadow) == 0
    g = np.maximum(np.asarray(irradiance_w_m2, dtype=np.float64), 0.0)
    p = _v("solar_panel_w") * g / _v("solar_reference_irradiance") * (1.0 - _v("solar_dust_loss"))
    p = np.where(np.asarray(in_shadow, dtype=bool), 0.0, p)
    return _out(p, scalar)


# ---------------------------------------------------------------- astronaut

def w_to_kcal_per_h(watts: float) -> float:
    return watts * W_TO_KCAL_PER_H


def astronaut_metabolic_w(slope_deg: ArrayLike) -> NDArray[np.float64] | float:
    """Linear between the Apollo low rate (flat or downhill) and high rate (>= met_slope_full_deg)."""
    scalar = np.ndim(slope_deg) == 0
    frac = np.clip(np.asarray(slope_deg, dtype=np.float64) / _v("met_slope_full_deg"), 0.0, 1.0)
    low, high = _v("met_rate_low_w"), _v("met_rate_high_w")
    return _out(low + (high - low) * frac, scalar)


def eva_consumables_wh() -> float:
    """Suit consumables expressed as metabolic energy: full EVA at the highest Apollo rate."""
    return _v("eva_duration_h") * _v("met_rate_high_w")


def astronaut_step_energy_wh(distance_m: ArrayLike, slope_deg: ArrayLike) -> NDArray[np.float64] | float:
    scalar = np.ndim(distance_m) == 0 and np.ndim(slope_deg) == 0
    t_s = np.asarray(distance_m, dtype=np.float64) / _v("astronaut_speed")
    return _out(np.asarray(astronaut_metabolic_w(slope_deg)) * t_s / 3600.0, scalar)
