"""Windowed, concurrent, cached reads of remote (or local) rasters.

The USGS Jezero mosaics are uncompressed strip TIFFs (1 row per strip) served over
HTTP range requests, so reading a 2 km window needs ~thousands of small ranges.
Each worker thread opens its own GDAL handle and reads a band of rows, which makes
the transfer latency-bound work overlap. TLS is always verified.
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import rasterio
from rasterio.transform import Affine
from rasterio.windows import Window

from .geo import Grid, LocalProjection

SRC_PROJ4 = "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs +type=crs"
MAX_DOWNLOAD_BYTES = 2_000_000_000

GDAL_ENV = dict(
    GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR",
    CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif,.tiff",
    GDAL_HTTP_MAX_RETRY="4",
    GDAL_HTTP_RETRY_DELAY="1",
    GDAL_HTTP_TIMEOUT="60",
    GDAL_HTTP_MERGE_CONSECUTIVE_RANGES="YES",
    VSI_CACHE="FALSE",
)


class DownloadTooLarge(RuntimeError):
    pass


def check_budget(width: int, height: int, bytes_per_px: int) -> None:
    need = width * height * bytes_per_px
    if need > MAX_DOWNLOAD_BYTES:
        raise DownloadTooLarge(f"window needs {need / 1e9:.2f} GB (> {MAX_DOWNLOAD_BYTES / 1e9:.0f} GB budget)")


def _open_path(src: str) -> str:
    return "/vsicurl/" + src if src.startswith("https://") else src


def window_for_grid(
    grid: Grid,
    proj: LocalProjection,
    src_transform: Affine,
    src_shape: tuple[int, int],
    margin_px: int = 8,
    src_proj4: str = SRC_PROJ4,
) -> tuple[int, int, int, int]:
    """Smallest source pixel window (col_off, row_off, w, h) that covers ``grid``."""
    from pyproj import Transformer

    t = Transformer.from_crs(proj.crs, src_proj4, always_xy=True)
    n = 33
    xmin, ymin, xmax, ymax = grid.bbox
    xs = np.concatenate([np.linspace(xmin, xmax, n)] * 2 + [np.full(n, xmin), np.full(n, xmax)])
    ys = np.concatenate([np.full(n, ymin), np.full(n, ymax)] + [np.linspace(ymin, ymax, n)] * 2)
    sx, sy = t.transform(xs, ys)
    cols = (np.asarray(sx) - src_transform.c) / src_transform.a
    rows = (src_transform.f - np.asarray(sy)) / -src_transform.e
    c0 = math.floor(cols.min()) - margin_px
    c1 = math.ceil(cols.max()) + margin_px
    r0 = math.floor(rows.min()) - margin_px
    r1 = math.ceil(rows.max()) + margin_px
    if c0 < 0 or r0 < 0 or c1 > src_shape[1] or r1 > src_shape[0]:
        raise ValueError(f"grid is outside the source raster (window {c0, r0, c1, r1} vs {src_shape})")
    return (c0, r0, c1 - c0, r1 - r0)


def read_window(src: str, window: tuple[int, int, int, int], workers: int = 8, band_rows: int = 64):
    """Read ``window`` = (col_off, row_off, width, height) with concurrent row-band reads."""
    col, row, w, h = window
    bands = [(r, min(band_rows, row + h - r)) for r in range(row, row + h, band_rows)]

    def job(band):
        r, nrows = band
        with rasterio.Env(**GDAL_ENV), rasterio.open(_open_path(src)) as ds:
            return r, ds.read(1, window=Window(col, r, w, nrows))

    with rasterio.Env(**GDAL_ENV), rasterio.open(_open_path(src)) as ds:
        meta = {
            "transform": ds.transform @ Affine.translation(col, row),
            "crs": ds.crs,
            "nodata": ds.nodata,
            "dtype": ds.dtypes[0],
        }
    check_budget(w, h, np.dtype(meta["dtype"]).itemsize)
    out = np.empty((h, w), dtype=meta["dtype"])
    if workers <= 1:
        results = map(job, bands)
    else:
        pool = ThreadPoolExecutor(max_workers=workers)
        results = pool.map(job, bands)
    for r, block in results:
        out[r - row : r - row + block.shape[0]] = block
    if workers > 1:
        pool.shutdown()
    return out, meta


def sha256_file(path: Path | str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _remote_info(src: str) -> dict:
    if not src.startswith("https://"):
        return {}
    import requests

    r = requests.head(src, timeout=30, allow_redirects=True)  # TLS verified (default)
    r.raise_for_status()
    return {
        "remoteBytes": int(r.headers.get("Content-Length", 0)) or None,
        "remoteLastModified": r.headers.get("Last-Modified"),
        "remoteEtag": r.headers.get("ETag"),
    }


def _load_lock(lock_path: Path) -> dict:
    if lock_path.exists():
        return json.loads(lock_path.read_text(encoding="utf-8"))
    return {"schemaVersion": 1, "sources": {}}


def fetch_cached(
    src: str,
    window: tuple[int, int, int, int],
    cache_dir: Path,
    name: str,
    lock_path: Path,
    workers: int = 8,
    license: str = "",
    attribution: str = "",
    title: str = "",
    doi: str | None = None,
) -> Path:
    """Fetch ``window`` of ``src`` into ``cache_dir/name.tif`` once; verify by sha256 afterwards."""
    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / f"{name}.tif"
    lock = _load_lock(lock_path)
    entry = lock["sources"].get(name)
    if (
        entry
        and entry["url"] == src
        and entry["window"] == list(window)
        and path.exists()
        and sha256_file(path) == entry["sha256"]
    ):
        return path

    t0 = time.perf_counter()
    data, meta = read_window(src, window, workers=workers)
    kw = dict(
        driver="GTiff", height=data.shape[0], width=data.shape[1], count=1, dtype=meta["dtype"],
        crs=meta["crs"], transform=meta["transform"], nodata=meta["nodata"], compress="deflate",
        predictor=3 if data.dtype.kind == "f" else 2, tiled=True, blockxsize=256, blockysize=256,
    )
    with rasterio.open(path, "w", **kw) as ds:
        ds.write(data, 1)
    lock["sources"][name] = {
        "url": src,
        "window": list(window),
        "sha256": sha256_file(path),
        "dataSha256": hashlib.sha256(np.ascontiguousarray(data).tobytes()).hexdigest(),
        "bytes": path.stat().st_size,
        "pixels": [data.shape[1], data.shape[0]],
        "retrievedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "fetchSeconds": round(time.perf_counter() - t0, 2),
        "workers": workers,
        "license": license,
        "attribution": attribution,
        "title": title,
        "doi": doi,
        **_remote_info(src),
    }
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True), encoding="utf-8")
    return path


class ChecksumMismatch(RuntimeError):
    pass


def fetch_file(
    url: str,
    cache_dir: Path,
    name: str,
    filename: str,
    lock_path: Path,
    license: str = "",
    attribution: str = "",
    title: str = "",
    doi: str | None = None,
    allow_http: bool = False,
    refresh: bool = False,
) -> Path:
    """Download a small file (TLS verified) and pin it by sha256 in the lock file.

    First download = trust on first use. Later runs refuse a changed upstream file
    (``ChecksumMismatch``) unless ``refresh=True`` is passed on purpose.
    """
    if not url.startswith("https://") and not allow_http:
        raise ValueError("only https URLs are allowed")
    import requests

    cache_dir.mkdir(parents=True, exist_ok=True)
    path = cache_dir / filename
    lock = _load_lock(lock_path)
    entry = lock["sources"].get(name)
    if entry and not refresh and path.exists() and sha256_file(path) == entry["sha256"]:
        return path
    r = requests.get(url, timeout=120)  # verify=True by default
    r.raise_for_status()
    digest = hashlib.sha256(r.content).hexdigest()
    if entry and not refresh and entry["sha256"] != digest:
        raise ChecksumMismatch(f"{name}: upstream sha256 {digest} != locked {entry['sha256']}")
    path.write_bytes(r.content)
    lock["sources"][name] = {
        "url": url,
        "sha256": digest,
        "bytes": len(r.content),
        "retrievedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "license": license,
        "attribution": attribution,
        "title": title,
        "doi": doi,
    }
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    lock_path.write_text(json.dumps(lock, indent=2, sort_keys=True), encoding="utf-8")
    return path
