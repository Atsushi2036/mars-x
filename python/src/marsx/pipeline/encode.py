"""Binary encodings consumed by the browser (little-endian, no parsing needed)."""

from __future__ import annotations

import numpy as np

U16_NODATA = 65535


def height_to_u16(dem: np.ndarray) -> tuple[np.ndarray, dict]:
    """Quantise heights to u16 (LE). z = q * scale + offset; q == 65535 is nodata."""
    valid = ~np.isnan(dem)
    if not valid.any():
        raise ValueError("DEM has no valid pixels")
    lo = float(dem[valid].min())
    hi = float(dem[valid].max())
    span = hi - lo
    scale = span / 65534.0 if span > 0 else 1.0
    q = np.full(dem.shape, U16_NODATA, dtype="<u2")
    q[valid] = np.rint((dem[valid] - lo) / scale).astype("<u2")
    return q, {"dtype": "uint16", "endian": "little", "scale": scale, "offset": lo, "nodata": U16_NODATA}


def u16_to_height(q: np.ndarray, enc: dict) -> np.ndarray:
    out = q.astype(np.float32) * np.float32(enc["scale"]) + np.float32(enc["offset"])
    return np.where(q == enc["nodata"], np.nan, out).astype(np.float32)


def to_le_bytes(a: np.ndarray) -> bytes:
    """Raw little-endian row-major bytes, regardless of the host byte order."""
    a = np.ascontiguousarray(a)
    return a.astype(a.dtype.newbyteorder("<"), copy=False).tobytes()


def pyramid_levels(size: int, tile: int) -> list[dict]:
    """LOD 0 = full resolution; each level halves until it fits in a single tile."""
    out, lod, s = [], 0, size
    while True:
        out.append({"lod": lod, "size": s, "tiles": max(1, s // tile)})
        if s <= tile:
            return out
        s //= 2
        lod += 1
