"""Surface insolation on Mars (Appelbaum & Flood 1990) with 16-azimuth horizons.

Sources
- Appelbaum, J. and Flood, D. J. (1990), "Solar Radiation on Mars - Update 1990",
  NASA TM-103623, https://ntrs.nasa.gov/citations/19910005804. Equations used:
  (1) Gob = S / r^2; (6)-(7) Beer's law with air mass 1/cos z; (17) global
  irradiance on a horizontal surface Gh = Gob cos z f(z, tau, al) / (1 - al);
  (18) polynomial fit of the normalised net flux function (mean error 0.7 %,
  max 7 % at z of 80-85 deg and tau > 5), coefficients p(i, j, k) from Table III;
  (19) direct beam on a horizontal surface Gbh = Gob cos z exp(-tau / cos z);
  diffuse = global - direct (the paper's own definition).
- Solar constant: NSSDCA Mars Fact Sheet (1361 W/m2 at 1 AU gives 586.2 W/m2 at
  the mean Mars distance). TM-103623 used 1371; pass ``solar_constant=1371`` to
  reproduce the paper.
- Sky view factor of a horizontal surface under a horizon profile:
  V = mean over azimuth of cos^2(h) (Dozier and Frew 1990, IEEE TGRS 28(5)).

Assumptions (not from the paper)
- ``assumption``: the 16 horizon azimuths are 0, 22.5, ... 337.5 deg clockwise
  from north (the same convention as ``marsx.conditions.mars24`` azimuths) and
  the profile is linearly interpolated between bins.
- ``assumption``: in shadow the diffuse irradiance is the open-sky diffuse times
  the sky view factor (isotropic sky; terrain-reflected light neglected).
- ``assumption``: for z > 85 deg (beyond the polynomial validity) the net flux
  function is held at its z = 85 deg value; the direct beam, which is ~0 there,
  keeps the exact formula.
Valid ranges enforced: 0 <= tau <= 6 (Table I/II range), 0.1 <= albedo <= 0.4.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SOLAR_CONSTANT_W_M2 = 1361.0  # NSSDCA Mars Fact Sheet, W/m2 at 1 AU
_Z_MAX_FIT_DEG = 85.0

# Table III: _P[k][j][i] = p(i, j, k); rows are j (zenith power), columns are i (tau power).
_P = np.array(
    [
        [  # k = 0
            [1.002800, -0.228681, 0.019613, 0.000231, -0.000130, 0.000003],
            [-0.450073, 1.335955, -1.131691, 0.402126, -0.063967, 0.003758],
            [5.566705, -16.912405, 13.739701, -4.756079, 0.743740, -0.043159],
            [-22.471579, 64.909973, -52.509470, 17.997548, -2.786548, 0.160340],
            [36.334497, -101.800319, 79.895539, -26.762885, 4.074117, -0.231476],
            [-20.420490, 53.207148, -39.949537, 12.977108, -1.931169, 0.107837],
        ],
        [  # k = 1
            [0.009814, 0.226139, -0.117733, 0.030579, -0.004090, 0.000218],
            [-0.156701, 0.396821, -0.313648, 0.099227, -0.013508, 0.000651],
            [1.361122, -3.758111, 3.007907, -0.987457, 0.141693, -0.007320],
            [-4.365924, 12.539251, -10.394165, 3.486452, -0.513123, 0.027401],
            [5.991693, -17.498138, 14.291370, -4.765323, 0.703675, -0.037960],
            [-2.915099, 8.275686, -6.593125, 2.173999, -0.320308, 0.017335],
        ],
    ]
)


def toa_beam_irradiance(r_au, solar_constant: float = SOLAR_CONSTANT_W_M2):
    """Eq. (1): beam irradiance at the top of the atmosphere, W/m2."""
    return solar_constant / np.asarray(r_au, dtype=float) ** 2


def _check(tau, albedo):
    t = np.asarray(tau, dtype=float)
    if np.any(~np.isfinite(t)) or np.any(t < 0.0) or np.any(t > 6.0):
        raise ValueError("optical depth must be in [0, 6] (range of Appelbaum & Flood tables)")
    if not 0.1 <= float(albedo) <= 0.4:
        raise ValueError("albedo must be in [0.1, 0.4] (range of Appelbaum & Flood tables)")
    return t


def net_flux_f(zenith_deg, tau, albedo: float = 0.1):
    """Eq. (18): normalised net flux function f(z, tau, al)."""
    t = _check(tau, albedo)
    z = np.clip(np.asarray(zenith_deg, dtype=float), 0.0, _Z_MAX_FIT_DEG) / 100.0
    zb, tb = np.broadcast_arrays(z, t)
    ti = tb[..., None] ** np.arange(6)  # tau^i
    zj = zb[..., None] ** np.arange(6)  # z~^j
    poly = 0.0
    for k in (0, 1):
        poly = poly + albedo**k * np.einsum("...j,jk,...k->...", zj, _P[k], ti)
    return poly * (1.0 - albedo)


def surface_irradiance(
    zenith_deg, tau, r_au, albedo: float = 0.1, solar_constant: float = SOLAR_CONSTANT_W_M2
):
    """Global, direct and diffuse irradiance on a horizontal open surface, W/m2.

    Zero when the sun is at or below the horizon (zenith >= 90 deg).
    """
    zen = np.asarray(zenith_deg, dtype=float)
    f = net_flux_f(zen, tau, albedo)
    up = zen < 90.0
    cosz = np.where(up, np.cos(np.radians(np.minimum(zen, 90.0))), 0.0)
    gob = toa_beam_irradiance(r_au, solar_constant)
    t = np.asarray(tau, dtype=float)
    with np.errstate(divide="ignore", over="ignore"):
        beam = np.where(cosz > 0, gob * cosz * np.exp(-t / np.where(cosz > 0, cosz, 1.0)), 0.0)
    glob = np.where(up, gob * cosz * f / (1.0 - albedo), 0.0)
    direct = np.minimum(beam, glob)  # the fit can undershoot Beer's law at extreme z; keep diffuse >= 0
    diffuse = glob - direct
    return glob, direct, diffuse


def horizon_elevation_at(horizon16_deg, azimuth_deg):
    """Horizon elevation (deg) at ``azimuth_deg`` from 16 azimuth bins (22.5 deg)."""
    h = np.asarray(horizon16_deg, dtype=float)
    if h.shape != (16,):
        raise ValueError("horizon must have 16 azimuth bins")
    pos = (np.asarray(azimuth_deg, dtype=float) % 360.0) / 22.5
    i0 = np.floor(pos).astype(int) % 16
    i1 = (i0 + 1) % 16
    w = pos - np.floor(pos)
    return h[i0] * (1.0 - w) + h[i1] * w


def sky_view_factor(horizon16_deg) -> float:
    """Sky view factor of a horizontal surface: mean(cos^2(horizon elevation))."""
    h = np.radians(np.asarray(horizon16_deg, dtype=float))
    return float(np.mean(np.cos(h) ** 2))


@dataclass(frozen=True)
class ShadedIrradiance:
    lit: object  # bool: sun above the local horizon
    direct: object
    diffuse: object
    global_: object


def shaded_irradiance(
    zenith_deg,
    azimuth_deg,
    tau,
    r_au,
    horizon16_deg,
    albedo: float = 0.1,
    solar_constant: float = SOLAR_CONSTANT_W_M2,
) -> ShadedIrradiance:
    """Irradiance on a horizontal cell given its 16-azimuth horizon profile."""
    glob, direct, diffuse = surface_irradiance(zenith_deg, tau, r_au, albedo, solar_constant)
    elev = 90.0 - np.asarray(zenith_deg, dtype=float)
    lit = elev > horizon_elevation_at(horizon16_deg, azimuth_deg)
    svf = sky_view_factor(horizon16_deg)
    d = diffuse * svf
    b = np.where(lit, direct, 0.0)
    return ShadedIrradiance(lit, b, d, b + d)
