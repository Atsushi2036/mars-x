"""WebP tile pyramid for the orthoimage (parallel encoding with a process pool)."""

from __future__ import annotations

import io
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
from PIL import Image

from .encode import pyramid_levels


def downsample2(a: np.ndarray) -> np.ndarray:
    """2x2 area mean (uint8 in, uint8 out)."""
    h, w = a.shape
    s = a.reshape(h // 2, 2, w // 2, 2).astype(np.uint16).sum(axis=(1, 3))
    return ((s + 2) // 4).astype(np.uint8)


def encode_tile(args: tuple[np.ndarray, int]) -> bytes:
    arr, quality = args
    buf = io.BytesIO()
    Image.fromarray(arr, mode="L").save(buf, format="WEBP", quality=quality, method=4)
    return buf.getvalue()


def _jobs(img: np.ndarray, tile: int, quality: int):
    levels = pyramid_levels(img.shape[0], tile)
    cur = img
    for lv in levels:
        n = lv["tiles"]
        ts = cur.shape[0] // n
        for y in range(n):
            for x in range(n):
                yield lv["lod"], x, y, np.ascontiguousarray(cur[y * ts : (y + 1) * ts, x * ts : (x + 1) * ts]), quality
        if cur.shape[0] > tile:
            cur = downsample2(cur)


def write_pyramid(
    img: np.ndarray, out_dir: Path, tile: int = 512, quality: int = 82, workers: int = 8, subdir: str = "ortho"
) -> dict:
    """Write ``{subdir}/{lod}/{x}_{y}.webp`` (lod 0 = full res, x from west, y from north)."""
    if img.shape[0] != img.shape[1] or img.shape[0] % tile:
        raise ValueError("image must be square and a multiple of the tile size")
    jobs = list(_jobs(img, tile, quality))
    datas = []
    if workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            datas = list(ex.map(encode_tile, [(j[3], j[4]) for j in jobs], chunksize=4))
    else:
        datas = [encode_tile((j[3], j[4])) for j in jobs]
    total = 0
    for (lod, x, y, _, _), data in zip(jobs, datas, strict=True):
        d = out_dir / subdir / str(lod)
        d.mkdir(parents=True, exist_ok=True)
        (d / f"{x}_{y}.webp").write_bytes(data)
        total += len(data)
    return {
        "levels": pyramid_levels(img.shape[0], tile),
        "count": len(jobs),
        "bytes": total,
        "tileSize": tile,
        "pathTemplate": subdir + "/{lod}/{x}_{y}.webp",
    }
