"""Independent validation of the data products (alignment, coverage, DEM slope vs rover tilt)."""

from __future__ import annotations

import math

import numpy as np
from scipy import fft
from scipy.ndimage import gaussian_filter

from . import derive


def _hann(shape: tuple[int, int]) -> np.ndarray:
    return np.outer(np.hanning(shape[0]), np.hanning(shape[1]))


def ncc_shift(a: np.ndarray, b: np.ndarray, max_shift: int = 8) -> tuple[tuple[float, float], float]:
    """Sub-pixel shift (dy, dx) such that ``b ~= shift(a, (dy, dx))`` and the NCC peak in [-1, 1].

    FFT normalised cross-correlation with a Hann window, searched within +-``max_shift`` px
    and refined with a parabolic fit. Positive dy = content moves DOWN, positive dx = RIGHT.
    Unlike phase correlation it stays robust when the two images are only partly correlated
    (a hillshade against a real image).
    """
    a = np.asarray(a, np.float64)
    b = np.asarray(b, np.float64)
    a = a - a.mean()
    b = b - b.mean()
    w = _hann(a.shape)
    a, b = a * w, b * w
    cc = np.real(fft.ifft2(fft.fft2(b) * np.conj(fft.fft2(a))))
    cc /= np.sqrt((a * a).sum() * (b * b).sum()) + 1e-12
    cc = np.fft.fftshift(cc)
    cy, cx = cc.shape[0] // 2, cc.shape[1] // 2
    sub = cc[cy - max_shift : cy + max_shift + 1, cx - max_shift : cx + max_shift + 1]
    iy, ix = np.unravel_index(np.argmax(sub), sub.shape)

    def refine(m1: float, c: float, p1: float) -> float:
        den = m1 - 2.0 * c + p1
        return 0.0 if abs(den) < 1e-15 else 0.5 * (m1 - p1) / den

    sy = refine(sub[iy - 1, ix], sub[iy, ix], sub[iy + 1, ix]) if 0 < iy < 2 * max_shift else 0.0
    sx = refine(sub[iy, ix - 1], sub[iy, ix], sub[iy, ix + 1]) if 0 < ix < 2 * max_shift else 0.0
    return (float(iy - max_shift + sy), float(ix - max_shift + sx)), float(sub[iy, ix])


def hillshade(dem: np.ndarray, res: float, az_deg: float, alt_deg: float = 30.0) -> np.ndarray:
    gx, gy = derive.gradient(dem, res)
    n = np.stack([-gx, -gy, np.ones_like(gx)])
    n /= np.sqrt((n * n).sum(axis=0))
    az, alt = math.radians(az_deg), math.radians(alt_deg)
    s = np.array([math.sin(az) * math.cos(alt), math.cos(az) * math.cos(alt), math.sin(alt)])
    return np.tensordot(s, n, axes=1).astype(np.float32)


def _highpass(a: np.ndarray, sigma: float = 6.0) -> np.ndarray:
    a = np.nan_to_num(a.astype(np.float32), nan=0.0)
    return a - gaussian_filter(a, sigma)


def alignment_report(ortho_1m: np.ndarray, dem: np.ndarray, grid_res: float = 1.0, n: int = 4, min_quality: float = 0.3) -> dict:
    """DEM hillshade vs ortho on the same 1 m grid: one global shift plus ``n x n`` local patches.

    The sun azimuth/elevation of the image is unknown: they are chosen to maximise the
    (sign-free) correlation of the high-passed ortho with the high-passed hillshade.
    Shifts are in DEM pixels (``grid_res`` metres); only patches with NCC peak >= ``min_quality`` count.
    """
    o = _highpass(ortho_1m)
    best = (0.0, 0.0, 30.0)
    o_s = _highpass(ortho_1m[::2, ::2], 3.0).ravel()  # coarse scan on a 2x subsample (4x cheaper)
    dem_s = np.ascontiguousarray(dem[::2, ::2])
    for alt in (15.0, 25.0, 35.0, 45.0):
        for az in range(0, 360, 15):
            hs = _highpass(hillshade(dem_s, grid_res * 2.0, float(az), alt), 3.0)
            c = float(np.corrcoef(o_s, hs.ravel())[0, 1])
            if abs(c) > abs(best[1]):
                best = (float(az), c, alt)
    az, corr, alt = best
    h = _highpass(hillshade(dem, grid_res, az, alt)) * (1.0 if corr >= 0 else -1.0)
    (gdy, gdx), gq = ncc_shift(h, o, 12)
    height, width = dem.shape
    ph, pw = height // n, width // n
    pts = []
    for i in range(n):
        for j in range(n):
            sl = (slice(i * ph, (i + 1) * ph), slice(j * pw, (j + 1) * pw))
            (dy, dx), q = ncc_shift(h[sl], o[sl])
            pts.append({"row": i * ph + ph // 2, "col": j * pw + pw // 2, "dy": dy, "dx": dx, "quality": q})
    good = [p for p in pts if p["quality"] >= min_quality]
    mags = np.array([math.hypot(p["dx"], p["dy"]) for p in good]) if good else np.array([np.nan])
    return {
        "method": "normalised cross-correlation of DEM hillshade vs ortho (both on the DEM grid): global shift + 4x4 patches with NCC >= 0.3",
        "sunAzimuthDeg": az,
        "sunElevationDeg": alt,
        "globalCorrelation": round(abs(corr), 4),
        "globalShiftPx": {"dy": gdy, "dx": gdx, "magnitude": math.hypot(gdy, gdx), "quality": gq},
        "patches": len(pts),
        "validPatches": len(good),
        "shiftPxMedian": float(np.nanmedian(mags)),
        "shiftPxP95": float(np.nanpercentile(mags, 95)),
        "shiftPxMax": float(np.nanmax(mags)),
        "rmseM": float(math.sqrt(np.nanmean(mags**2)) * grid_res),
        "globalShiftM": math.hypot(gdy, gdx) * grid_res,
        "pixelSizeM": grid_res,
        "orthoPixelSizeM": grid_res / 4.0,
        "controlPoints": [{k: (round(v, 3) if isinstance(v, float) else v) for k, v in p.items()} for p in pts],
    }


def predict_pitch_roll(gx: float, gy: float, yaw_deg: float) -> tuple[float, float]:
    """Pitch/roll (deg) a rover would show on terrain with gradient (dz/dE, dz/dN).

    Assumes yaw = heading in degrees clockwise from north. Pitch > 0 = nose up; roll > 0 =
    right side DOWN (the sign that matches the published Mars 2020 roll at Jezero, Pearson +0.95;
    with the opposite sign it was -0.95).
    """
    y = math.radians(yaw_deg)
    pitch = math.degrees(math.atan(gx * math.sin(y) + gy * math.cos(y)))
    roll = -math.degrees(math.atan(gx * math.cos(y) - gy * math.sin(y)))
    return pitch, roll


def agreement_stats(pred: np.ndarray, meas: np.ndarray) -> dict:
    pred = np.asarray(pred, float)
    meas = np.asarray(meas, float)
    ok = ~(np.isnan(pred) | np.isnan(meas))
    pred, meas = pred[ok], meas[ok]
    n = int(ok.sum())
    out: dict = {"n": n, "pearson": None, "mae": None, "bias": None, "rmse": None}
    if n == 0:
        return out
    d = pred - meas
    out.update(mae=float(np.mean(np.abs(d))), bias=float(np.mean(d)), rmse=float(np.sqrt(np.mean(d**2))),
               meanPred=float(pred.mean()), meanMeas=float(meas.mean()))
    if n >= 3 and pred.std() > 0 and meas.std() > 0:
        out["pearson"] = float(np.corrcoef(pred, meas)[0, 1])
    return out
