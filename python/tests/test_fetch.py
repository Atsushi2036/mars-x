import json

import numpy as np
import pytest
import rasterio
from rasterio.transform import from_origin

from marsx.pipeline import fetch
from marsx.pipeline.geo import Grid, LocalProjection

SRC_PROJ4 = "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs +type=crs"


@pytest.fixture()
def src_tif(tmp_path):
    rng = np.random.default_rng(1)
    data = rng.normal(-2500, 20, (300, 400)).astype(np.float32)
    data[10, 10] = -3.4028226550889045e38  # nodata
    path = tmp_path / "src.tif"
    with rasterio.open(
        path, "w", driver="GTiff", height=300, width=400, count=1, dtype="float32",
        crs=SRC_PROJ4, transform=from_origin(4577366.0, 1106618.0, 1.0, 1.0), nodata=-3.4028226550889045e38,
    ) as ds:
        ds.write(data, 1)
    return path, data


def test_concurrent_window_read_equals_direct_read(src_tif):
    path, data = src_tif
    win = (37, 21, 111, 203)  # col_off, row_off, width, height
    got, meta = fetch.read_window(str(path), win, workers=4, band_rows=17)
    assert got.shape == (203, 111)
    assert np.array_equal(got, data[21:224, 37:148])
    assert meta["transform"].c == pytest.approx(4577366.0 + 37)
    assert meta["transform"].f == pytest.approx(1106618.0 - 21)


def test_window_for_grid_contains_all_corners_with_margin():
    p = LocalProjection(77.39, 18.46)
    g = Grid(-1024.0, 1024.0, 1.0, 2048, 2048)
    tr = from_origin(4577366.0, 1106618.0, 1.0, 1.0)
    col, row, w, h = fetch.window_for_grid(g, p, tr, (21488, 21400), margin_px=8)
    from pyproj import Transformer

    t = Transformer.from_crs(p.crs, SRC_PROJ4, always_xy=True)
    for x, y in [(-1024, 1024), (1024, 1024), (-1024, -1024), (1024, -1024), (0, 0)]:
        sx, sy = t.transform(x, y)
        c = (sx - tr.c) / tr.a
        r = (tr.f - sy) / -tr.e
        assert col + 8 <= c <= col + w - 8 and row + 8 <= r <= row + h - 8
    # source pixels are stretched E-W by 1/cos(lat): window must be wider than 2048 px
    assert w > 2048 + 16 and h >= 2048 + 16


def test_window_outside_source_raises():
    p = LocalProjection(10.0, 0.0)
    g = Grid(-100.0, 100.0, 1.0, 200, 200)
    with pytest.raises(ValueError, match="outside"):
        fetch.window_for_grid(g, p, from_origin(4577366.0, 1106618.0, 1.0, 1.0), (300, 400), 8)


def test_fetch_cached_writes_lock_with_sha256_and_reuses_cache(src_tif, tmp_path):
    path, data = src_tif
    lock = tmp_path / "sources.lock.json"
    cache = tmp_path / "raw"
    win = (5, 6, 50, 60)
    p1 = fetch.fetch_cached(str(path), win, cache, "dem", lock, workers=2, license="CC0-1.0")
    entry = json.loads(lock.read_text())["sources"]["dem"]
    assert entry["sha256"] == fetch.sha256_file(p1)
    assert entry["window"] == list(win) and entry["url"] == str(path)
    assert entry["license"] == "CC0-1.0"
    mtime = p1.stat().st_mtime_ns
    p2 = fetch.fetch_cached(str(path), win, cache, "dem", lock, workers=2, license="CC0-1.0")
    assert p2 == p1 and p1.stat().st_mtime_ns == mtime  # cache hit: not rewritten
    # a corrupted cache file is detected via sha256 and refetched
    p1.write_bytes(b"corrupt")
    p3 = fetch.fetch_cached(str(path), win, cache, "dem", lock, workers=2, license="CC0-1.0")
    assert fetch.sha256_file(p3) == json.loads(lock.read_text())["sources"]["dem"]["sha256"]
    with rasterio.open(p3) as ds:
        assert np.array_equal(ds.read(1), data[6:66, 5:55])


def test_download_budget_guard_refuses_over_2gb():
    with pytest.raises(fetch.DownloadTooLarge):
        fetch.check_budget(width=40000, height=30000, bytes_per_px=4)  # 4.8 GB
    fetch.check_budget(width=2300, height=2200, bytes_per_px=4)  # ~20 MB ok


def test_fetch_file_records_sha256_and_detects_tampering(tmp_path):
    import functools
    import http.server
    import threading

    srv_dir = tmp_path / "srv"
    srv_dir.mkdir()
    (srv_dir / "a.json").write_bytes(b'{"x": 1}')
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(srv_dir))
    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{httpd.server_address[1]}/a.json"
        lock = tmp_path / "lock.json"
        p = fetch.fetch_file(url, tmp_path / "raw", "a", "a.json", lock, license="CC0-1.0", allow_http=True)
        import hashlib

        entry = json.loads(lock.read_text())["sources"]["a"]
        assert entry["sha256"] == hashlib.sha256(b'{"x": 1}').hexdigest() == fetch.sha256_file(p)
        # upstream changes: the locked hash no longer matches -> refuse to use silently
        (srv_dir / "a.json").write_bytes(b'{"x": 2}')
        p.unlink()
        with pytest.raises(fetch.ChecksumMismatch):
            fetch.fetch_file(url, tmp_path / "raw", "a", "a.json", lock, license="CC0-1.0", allow_http=True)
        p2 = fetch.fetch_file(url, tmp_path / "raw", "a", "a.json", lock, license="CC0-1.0", allow_http=True, refresh=True)
        assert p2.read_bytes() == b'{"x": 2}'
    finally:
        httpd.shutdown()


def test_fetch_file_rejects_plain_http_by_default(tmp_path):
    with pytest.raises(ValueError, match="https"):
        fetch.fetch_file("http://example.com/a", tmp_path, "a", "a", tmp_path / "l.json")
