"""marsx.data.fetch: download the env layers of a published dataset, verify sha256, cache, refuse unsafe input."""

from __future__ import annotations

import functools
import hashlib
import http.server
import json
import threading
from pathlib import Path

import pytest
from marsx import data


def _layer(lid, kind, grid, path, raw):
    return {"id": lid, "kind": kind, "gridId": grid, "path": path, "sha256": hashlib.sha256(raw).hexdigest(),
            "bytes": len(raw)}


@pytest.fixture()
def site(tmp_path):
    root = tmp_path / "site" / "jezero-v1"
    (root / "sun").mkdir(parents=True)
    (root / "meda").mkdir()
    files = {"plan_slope.u8": b"s" * 16, "plan_step.u8": b"t" * 16, "plan_height.u16": b"h" * 32,
             "horizon.u8": b"z" * 64, "sky_view.u8": b"v" * 16, "sun/sol-148.f32": b"\x00" * 24,
             "owlt.f32": b"\x01" * 16, "ortho/0/0_0.webp": b"big image not needed by the env"}
    for p, raw in files.items():
        (root / p).parent.mkdir(parents=True, exist_ok=True)
        (root / p).write_bytes(raw)
    kinds = {"plan_slope.u8": ("slope", "plan"), "plan_step.u8": ("step", "plan"), "plan_height.u16": ("elevation", "plan"),
             "horizon.u8": ("horizon", "plan"), "sky_view.u8": ("sky_view", "plan"), "sun/sol-148.f32": ("sun_table", None),
             "owlt.f32": ("owlt_table", None), "ortho/0/0_0.webp": ("orthoimage", "ortho")}
    manifest = {"datasetId": "jezero-v1", "layers": [_layer(p, k, g, p, files[p]) for p, (k, g) in kinds.items()]}
    (root / "manifest.json").write_text(json.dumps(manifest))
    (root / "meda" / "sol-0148.json").write_text(json.dumps({"sol": 148, "hours": [{"hour": 9, "temperatureK": 230.0}],
                                                             "tau": None}))
    hits: list[str] = []

    class Handler(http.server.SimpleHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def do_GET(self):
            hits.append(self.path)
            super().do_GET()

    srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Handler, directory=str(tmp_path / "site")))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{srv.server_address[1]}", root, hits
    srv.shutdown()


def test_fetch_downloads_only_env_layers_and_verifies(site, tmp_path):
    base, _root, hits = site
    out = data.fetch(base_url=base, region="jezero-v1", dest=tmp_path / "cache", meda_sols=[148, 999])
    assert (out / "manifest.json").exists() and (out / "plan_slope.u8").read_bytes() == b"s" * 16
    assert (out / "sun" / "sol-148.f32").exists() and (out / "meda" / "sol-0148.json").exists()
    assert not (out / "ortho").exists()
    assert not any("ortho" in h for h in hits)


def test_fetch_uses_cache_on_second_call(site, tmp_path):
    base, _root, hits = site
    data.fetch(base_url=base, dest=tmp_path / "c", meda_sols=[])
    n = len(hits)
    data.fetch(base_url=base, dest=tmp_path / "c", meda_sols=[])
    assert len(hits) == n + 1  # only the manifest is re-read


def test_fetch_rejects_tampered_file(site, tmp_path):
    base, root, _ = site
    (root / "sky_view.u8").write_bytes(b"evil" * 4)
    with pytest.raises(data.IntegrityError, match="sky_view"):
        data.fetch(base_url=base, dest=tmp_path / "c", meda_sols=[])


def test_fetch_rejects_path_traversal_in_manifest(site, tmp_path):
    base, root, _ = site
    m = json.loads((root / "manifest.json").read_text())
    m["layers"][0]["path"] = "../../outside.u8"
    (root / "manifest.json").write_text(json.dumps(m))
    with pytest.raises(ValueError, match="unsafe path"):
        data.fetch(base_url=base, dest=tmp_path / "c", meda_sols=[])


def test_plain_http_only_for_localhost():
    with pytest.raises(ValueError, match="https"):
        data.fetch(base_url="http://example.com/data", dest=Path("unused"), meda_sols=[])


def test_base_url_from_environment(monkeypatch, site, tmp_path):
    base, _, _ = site
    monkeypatch.setenv("MARSX_DATA_URL", base)
    out = data.fetch(dest=tmp_path / "e", meda_sols=[])
    assert (out / "horizon.u8").exists()


def test_fetch_retries_transient_network_errors(site, tmp_path, monkeypatch):
    import urllib.error
    import urllib.request

    base, _, _ = site
    real = urllib.request.urlopen
    calls = {"n": 0}

    def flaky(*a, **k):
        calls["n"] += 1
        if calls["n"] in (1, 3):  # first manifest try and one layer try are reset by the "remote host"
            raise urllib.error.URLError(ConnectionResetError(10054, "connection reset"))
        return real(*a, **k)

    monkeypatch.setattr(urllib.request, "urlopen", flaky)
    monkeypatch.setattr(data, "RETRY_BASE_S", 0.0)
    out = data.fetch(base_url=base, dest=tmp_path / "r", meda_sols=[])
    assert (out / "horizon.u8").exists()
