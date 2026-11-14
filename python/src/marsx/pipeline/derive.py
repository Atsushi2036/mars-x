"""Terrain derivatives computed with numba (``prange`` data-parallel over rows).

Every kernel exists in a parallel and a serial flavour built from the same source,
so tests can prove they agree and the pipeline can measure the real speed-up.

Conventions: arrays are ``[row, col]`` with row 0 = NORTH edge; nodata is NaN.
Angles are stored as ``u8`` with a 0.5 degree step (``ANGLE_SCALE``), nodata = 255.
"""

from __future__ import annotations

import math
import types
from collections.abc import Callable

import numba as nb
import numpy as np

ANGLE_SCALE = 0.5  # degrees per u8 step (0..127.5 deg)
U8_NODATA = 255
HAZARD_NODATA = 255

# Engineering assumptions for the hazard layer (NOT official Mars 2020 limits).
SLOPE_LIMIT_DEG = 30.0
STEP_LIMIT_M = 0.30
ROUGH_LIMIT_M = 0.25


def _dual(fn: Callable) -> tuple[Callable, Callable]:
    """Compile ``fn`` twice: with ``parallel=True`` and as a plain serial loop.

    The serial flavour is a renamed copy: numba's on-disk cache is keyed by the function's
    qualified name, so two flavours of the same name would silently share one cached binary.
    """
    ser = types.FunctionType(fn.__code__, fn.__globals__, fn.__name__ + "_serial", fn.__defaults__, fn.__closure__)
    ser.__qualname__ = fn.__qualname__ + "_serial"
    return nb.njit(parallel=True, cache=True)(fn), nb.njit(cache=True)(ser)


# ----------------------------------------------------------------------------- Horn


def _horn_impl(dem, res, gx, gy):
    h, w = dem.shape
    for r in nb.prange(h):
        r0 = max(r - 1, 0)
        r1 = min(r + 1, h - 1)
        for c in range(w):
            c0 = max(c - 1, 0)
            c1 = min(c + 1, w - 1)
            a = dem[r0, c0]
            b = dem[r0, c]
            cc = dem[r0, c1]
            d = dem[r, c0]
            f = dem[r, c1]
            g = dem[r1, c0]
            hh = dem[r1, c]
            i = dem[r1, c1]
            e = dem[r, c]
            s = a + b + cc + d + e + f + g + hh + i
            if s != s:  # any NaN in the 3x3
                gx[r, c] = np.nan
                gy[r, c] = np.nan
                continue
            # one-sided at the borders: the denominator uses the real column/row span
            dx = ((cc + 2.0 * f + i) - (a + 2.0 * d + g)) / (4.0 * res * (c1 - c0))
            dy_south = ((g + 2.0 * hh + i) - (a + 2.0 * b + cc)) / (4.0 * res * (r1 - r0))
            gx[r, c] = dx  # d z / d east
            gy[r, c] = -dy_south  # d z / d north (rows grow southwards)


_horn_par, _horn_ser = _dual(_horn_impl)


def gradient(dem: np.ndarray, res: float, parallel: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Horn gradient ``(dz/dEast, dz/dNorth)`` in m/m; NaN around nodata."""
    dem = np.ascontiguousarray(dem, dtype=np.float32)
    gx = np.empty(dem.shape, np.float32)
    gy = np.empty(dem.shape, np.float32)
    (_horn_par if parallel else _horn_ser)(dem, np.float32(res), gx, gy)
    return gx, gy


def slope_deg(dem: np.ndarray, res: float, parallel: bool = True) -> np.ndarray:
    gx, gy = gradient(dem, res, parallel)
    return np.degrees(np.arctan(np.hypot(gx, gy))).astype(np.float32)


def aspect_deg(dem: np.ndarray, res: float, parallel: bool = True) -> np.ndarray:
    """Downhill direction as compass azimuth (0 = north, 90 = east)."""
    gx, gy = gradient(dem, res, parallel)
    return (np.degrees(np.arctan2(-gx, -gy)) % 360.0).astype(np.float32)


def normal_map(dem: np.ndarray, res: float, parallel: bool = True) -> np.ndarray:
    """Tangent-space normal map: RGB = (east, north, up) mapped from [-1, 1] to [0, 255]."""
    gx, gy = gradient(dem, res, parallel)
    nx, ny, nz = -gx, -gy, np.ones_like(gx)
    inv = 1.0 / np.sqrt(nx * nx + ny * ny + nz * nz)
    out = np.stack([nx * inv, ny * inv, nz * inv], axis=-1)
    out = np.where(np.isnan(out), np.array([0.0, 0.0, 1.0], np.float32), out)
    return np.clip(np.rint((out * 0.5 + 0.5) * 255.0), 0, 255).astype(np.uint8)


# ------------------------------------------------------------ roughness and step


def _rough_impl(dem, rad, out):
    h, w = dem.shape
    for r in nb.prange(h):
        r0 = max(r - rad, 0)
        r1 = min(r + rad, h - 1)
        for c in range(w):
            c0 = max(c - rad, 0)
            c1 = min(c + rad, w - 1)
            n = (r1 - r0 + 1) * (c1 - c0 + 1)
            sz = 0.0
            sx = 0.0
            sy = 0.0
            bad = False
            for rr in range(r0, r1 + 1):
                for cc in range(c0, c1 + 1):
                    z = dem[rr, cc]
                    if z != z:
                        bad = True
                    sz += z
                    sx += cc
                    sy += rr
            if bad:
                out[r, c] = np.nan
                continue
            mz = sz / n
            mx = sx / n
            my = sy / n
            sxx = 0.0
            syy = 0.0
            sxz = 0.0
            syz = 0.0
            for rr in range(r0, r1 + 1):
                for cc in range(c0, c1 + 1):
                    dz = dem[rr, cc] - mz
                    dx = cc - mx
                    dy = rr - my
                    sxx += dx * dx
                    syy += dy * dy
                    sxz += dx * dz
                    syz += dy * dz
            ax = sxz / sxx if sxx > 0 else 0.0
            ay = syz / syy if syy > 0 else 0.0
            ss = 0.0
            for rr in range(r0, r1 + 1):
                for cc in range(c0, c1 + 1):
                    resid = (dem[rr, cc] - mz) - ax * (cc - mx) - ay * (rr - my)
                    ss += resid * resid
            out[r, c] = math.sqrt(ss / n)


_rough_par, _rough_ser = _dual(_rough_impl)


def roughness(dem: np.ndarray, res: float, window_m: float = 5.0, parallel: bool = True) -> np.ndarray:
    """RMS of the residual from the best-fit plane in a ``window_m`` square window (metres)."""
    rad = max(1, int(round(window_m / res / 2.0)))
    dem = np.ascontiguousarray(dem, dtype=np.float32)
    out = np.empty(dem.shape, np.float32)
    (_rough_par if parallel else _rough_ser)(dem, rad, out)
    return out


def _step_impl(dem, out):
    h, w = dem.shape
    for r in nb.prange(h):
        for c in range(w):
            if r == 0 or c == 0 or r == h - 1 or c == w - 1:
                continue  # border is filled from the interior afterwards
            z = dem[r, c]
            best = 0.0
            nan = z != z
            # second difference through the centre in 4 directions = height of a ledge
            for k in range(4):
                if k == 0:
                    dr, dc = 0, 1
                elif k == 1:
                    dr, dc = 1, 0
                elif k == 2:
                    dr, dc = 1, 1
                else:
                    dr, dc = 1, -1
                a = dem[r + dr, c + dc]
                b = dem[r - dr, c - dc]
                v = abs(a + b - 2.0 * z)
                if v != v:
                    nan = True
                elif v > best:
                    best = v
            out[r, c] = np.nan if nan else best


_step_par, _step_ser = _dual(_step_impl)


def step_height(dem: np.ndarray, parallel: bool = True) -> np.ndarray:
    """Ledge height (m): max over 4 directions of |z(+d) + z(-d) - 2 z|; 0 on any plane.

    Slope does not inflate it (a 45 degree ramp gives 0), so it isolates discrete
    steps/rocks that a wheel must climb. Border cells copy their nearest interior cell.
    """
    dem = np.ascontiguousarray(dem, dtype=np.float32)
    out = np.zeros(dem.shape, np.float32)
    (_step_par if parallel else _step_ser)(dem, out)
    if min(dem.shape) >= 3:
        out[0, :], out[-1, :] = out[1, :], out[-2, :]
        out[:, 0], out[:, -1] = out[:, 1], out[:, -2]
    return out


# ------------------------------------------------------------------- aggregation


def _blocks(a: np.ndarray, k: int) -> np.ndarray:
    h, w = a.shape
    if h % k or w % k:
        raise ValueError(f"shape {a.shape} not divisible by {k}")
    return a.reshape(h // k, k, w // k, k).swapaxes(1, 2).reshape(h // k, w // k, k * k)


def maxpool(a: np.ndarray, k: int = 2) -> np.ndarray:
    """Conservative aggregation: worst (max) value of each k x k block; NaN if all NaN."""
    b = _blocks(a, k)
    allnan = np.isnan(b).all(axis=-1)
    out = np.where(allnan, np.nan, np.max(np.where(np.isnan(b), -np.inf, b), axis=-1))
    return out.astype(np.float32)


def meanpool(a: np.ndarray, k: int = 2) -> np.ndarray:
    b = _blocks(a, k)
    valid = ~np.isnan(b)
    n = valid.sum(axis=-1)
    s = np.where(valid, b, 0.0).sum(axis=-1)
    return np.where(n > 0, s / np.maximum(n, 1), np.nan).astype(np.float32)


def hazard_u8(
    slope: np.ndarray,
    step: np.ndarray,
    rough: np.ndarray,
    slope_limit: float = SLOPE_LIMIT_DEG,
    step_limit: float = STEP_LIMIT_M,
    rough_limit: float = ROUGH_LIMIT_M,
) -> np.ndarray:
    """0 = benign, 254 = at/above a limit (untraversable), 255 = nodata. Worst term wins."""
    with np.errstate(invalid="ignore"):
        terms = np.stack([slope / slope_limit, step / step_limit, rough / rough_limit])
    terms = np.where(np.isnan(terms), 0.0, terms)
    worst = np.clip(terms.max(axis=0), 0.0, 1.0)
    out = np.rint(worst * 254.0).astype(np.uint8)
    out[np.isnan(slope)] = HAZARD_NODATA
    return out


def angle_to_u8(deg: np.ndarray) -> np.ndarray:
    q = np.clip(np.rint(np.nan_to_num(deg, nan=0.0) / ANGLE_SCALE), 0, 254).astype(np.uint8)
    q[np.isnan(deg)] = U8_NODATA
    return q


def u8_to_angle(q: np.ndarray) -> np.ndarray:
    out = np.asarray(q, dtype=np.float32) * ANGLE_SCALE
    return np.where(np.asarray(q) == U8_NODATA, np.nan, out).astype(np.float32)


# ------------------------------------------------------------------- horizon maps


def _horizon_impl(dem, res, n_az, max_dist, out):
    h, w = dem.shape
    for r in nb.prange(h):
        for c in range(w):
            z0 = dem[r, c]
            if z0 != z0:
                for k in range(n_az):
                    out[k, r, c] = 255
                continue
            for k in range(n_az):
                az = 2.0 * math.pi * k / n_az
                dc = math.sin(az)  # east
                dr = -math.cos(az)  # north = decreasing row
                best = 0.0
                d = res
                while d <= max_dist:
                    fr = r + dr * d / res
                    fc = c + dc * d / res
                    if fr < 0.0 or fc < 0.0 or fr > h - 1.0 or fc > w - 1.0:
                        break
                    ir = int(fr)
                    ic = int(fc)
                    ir1 = min(ir + 1, h - 1)
                    ic1 = min(ic + 1, w - 1)
                    tr = fr - ir
                    tc = fc - ic
                    z = (
                        dem[ir, ic] * (1 - tr) * (1 - tc)
                        + dem[ir, ic1] * (1 - tr) * tc
                        + dem[ir1, ic] * tr * (1 - tc)
                        + dem[ir1, ic1] * tr * tc
                    )
                    if z == z:
                        ang = math.degrees(math.atan2(z - z0, d))
                        if ang > best:
                            best = ang
                    # progressive step: dense near the cell, sparse far away
                    if d <= 64.0 * res:
                        d += res
                    elif d <= 128.0 * res:
                        d += 2.0 * res
                    else:
                        d += 4.0 * res
                q = int(best / 0.5 + 0.5)
                out[k, r, c] = 254 if q > 254 else q


_hor_par, _hor_ser = _dual(_horizon_impl)


def horizon_maps(
    dem: np.ndarray, res: float, n_az: int = 16, max_dist_m: float = 600.0, parallel: bool = True
) -> np.ndarray:
    """Horizon elevation angle per cell and compass azimuth (index k = k * 360/n_az degrees).

    Returns ``u8[n_az, rows, cols]`` (0.5 degree steps, clamped at >= 0, 255 = nodata).
    Rays that leave the grid stop there, so cells near the edge can under-estimate
    terrain shadowing coming from outside the window.
    """
    dem = np.ascontiguousarray(dem, dtype=np.float32)
    out = np.zeros((n_az,) + dem.shape, np.uint8)
    (_hor_par if parallel else _hor_ser)(dem, np.float32(res), n_az, np.float32(max_dist_m), out)
    return out
