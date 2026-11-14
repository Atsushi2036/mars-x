"""Synthetic sub-metre rocks below the DEM resolution (labelled "synthetic").

Size-frequency model of Golombek & Rapp 1997 (JGR 102(E2) 4117-4129, doi:10.1029/96JE03319):
cumulative fractional area covered by rocks of diameter >= D is F_k(D) = k * exp(-q(k) * D),
with q(k) = 1.79 + 0.152 / k and k the total rock abundance (1-10 % used for landing sites).

The number density per unit diameter follows from the area density divided by the rock's
footprint: n(D) = k q exp(-q D) / (pi D^2 / 4). Counts are Poisson, positions uniform, and
diameters are drawn by inverse-CDF on a fixed grid, so the same seed always yields the same rocks.

Coordinates are metres from the crop's upper-left corner: x grows with the column, y with the row.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass, field

import numpy as np
from numpy.typing import NDArray

from marsx.conditions.params import Param, assumption

GOLOMBEK_RAPP = "Golombek & Rapp 1997, JGR 102(E2) 4117-4129, doi:10.1029/96JE03319"
_ROVER = "NASA, Perseverance rover components: https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/"
_DRIVE = "NASA blog, Tracks along the longest drive on another world (Oct 2026): https://science.nasa.gov/blog/tracks-along-the-longest-drive-on-another-world/"

Q_INTERCEPT = Param(1.79, "1/m", "modeled", GOLOMBEK_RAPP, note="q(k) = 1.79 + 0.152/k")
Q_SLOPE = Param(0.152, "-", "modeled", GOLOMBEK_RAPP)
HEIGHT_RATIO = assumption(0.5, "-", "rock height = 0.5 x diameter")
HAZARD_HEIGHT = Param(
    0.20, "m", "derived", f"20 cm belly-clearance requirement; {_DRIVE}",
    note="conservative simplification: any rock taller than this is a critical collision",
)
IMPASSABLE_HEIGHT = Param(0.525, "m", "measured", f"wheel diameter 52.5 cm; {_ROVER}")
SENSOR_RADIUS = assumption(8.0, "m", "range at which onboard cameras reveal sub-metre rocks")
D_MIN = assumption(0.4, "m", "smallest generated diameter (height 0.2 m = hazard threshold)")
D_MAX = assumption(1.0, "m", "largest generated diameter (~HiRISE DEM resolution)")

_CDF_POINTS = 4097


def q_of_k(k: float) -> float:
    return Q_INTERCEPT.value + Q_SLOPE.value / k


def cumulative_area_fraction(d_m: float, k: float) -> float:
    return k * math.exp(-q_of_k(k) * d_m)


def _density_grid(k: float, d_min: float, d_max: float) -> tuple[NDArray[np.float64], NDArray[np.float64]]:
    d = np.linspace(d_min, d_max, _CDF_POINTS)
    q = q_of_k(k)
    n = k * q * np.exp(-q * d) / (math.pi * d * d / 4.0)  # rocks per m^2 per m of diameter
    cum = np.concatenate([[0.0], np.cumsum(0.5 * (n[1:] + n[:-1]) * np.diff(d))])
    return d, cum


def expected_count(area_m2: float, k: float, d_min: float, d_max: float) -> float:
    _, cum = _density_grid(k, d_min, d_max)
    return float(area_m2 * cum[-1])


@dataclass(frozen=True)
class RockField:
    x_m: NDArray[np.float64]
    y_m: NDArray[np.float64]
    d_m: NDArray[np.float64]
    h_m: NDArray[np.float64]
    meta: dict[str, object] = field(default_factory=dict)

    @classmethod
    def from_arrays(cls, x_m: NDArray, y_m: NDArray, d_m: NDArray, meta: dict[str, object]) -> RockField:
        d = np.asarray(d_m, dtype=np.float64)
        return cls(
            np.asarray(x_m, dtype=np.float64), np.asarray(y_m, dtype=np.float64), d,
            d * HEIGHT_RATIO.value, {"label": "synthetic", **meta},
        )

    def __len__(self) -> int:
        return int(self.x_m.size)

    @property
    def hazard(self) -> NDArray[np.bool_]:
        return self.h_m > HAZARD_HEIGHT.value

    @property
    def impassable(self) -> NDArray[np.bool_]:
        return self.h_m > IMPASSABLE_HEIGHT.value

    def digest(self) -> str:
        h = hashlib.sha256()
        for a in (self.x_m, self.y_m, self.d_m):
            h.update(np.ascontiguousarray(a, dtype="<f8").tobytes())
        return h.hexdigest()


def generate_rocks(
    seed: int,
    width_m: float,
    height_m: float,
    k: float = 0.05,
    d_min: float = D_MIN.value,
    d_max: float = D_MAX.value,
) -> RockField:
    if not 0.0 < k <= 0.30:
        raise ValueError(f"rock abundance k must be in (0, 0.30], got {k}")
    if not 0.0 < d_min < d_max:
        raise ValueError("need 0 < d_min < d_max")
    rng = np.random.default_rng(np.random.SeedSequence(seed))
    d_grid, cum = _density_grid(k, d_min, d_max)
    n = int(rng.poisson(width_m * height_m * cum[-1]))
    x = rng.uniform(0.0, width_m, n)
    y = rng.uniform(0.0, height_m, n)
    d = np.interp(rng.uniform(0.0, cum[-1], n), cum, d_grid)
    meta: dict[str, object] = {
        "model": f"{GOLOMBEK_RAPP}; F_k(D) = k exp(-q(k) D), q(k) = 1.79 + 0.152/k",
        "seed": seed, "k": k, "q": q_of_k(k), "dMin": d_min, "dMax": d_max,
        "widthM": width_m, "heightM": height_m,
    }
    return RockField.from_arrays(x, y, d, meta)


def rasterize_max_height(field: RockField, shape: tuple[int, int], res_m: float) -> NDArray[np.float32]:
    rows, cols = shape
    grid = np.zeros(shape, dtype=np.float32)
    c = np.floor(field.x_m / res_m).astype(np.int64)
    r = np.floor(field.y_m / res_m).astype(np.int64)
    ok = (r >= 0) & (r < rows) & (c >= 0) & (c < cols)
    np.maximum.at(grid, (r[ok], c[ok]), field.h_m[ok].astype(np.float32))
    return grid


def reveal(field: RockField, x_m: float, y_m: float, radius_m: float = SENSOR_RADIUS.value) -> NDArray[np.bool_]:
    return (field.x_m - x_m) ** 2 + (field.y_m - y_m) ** 2 <= radius_m * radius_m


def all_params() -> dict[str, Param]:
    return {
        "q_intercept": Q_INTERCEPT, "q_slope": Q_SLOPE, "height_ratio": HEIGHT_RATIO,
        "hazard_height": HAZARD_HEIGHT, "impassable_height": IMPASSABLE_HEIGHT,
        "sensor_radius": SENSOR_RADIUS, "d_min": D_MIN, "d_max": D_MAX,
    }
