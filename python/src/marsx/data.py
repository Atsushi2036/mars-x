"""Download the processed Jezero dataset (only what the environment needs) from a published MARS-X site.

    from marsx import data
    path = data.fetch()                      # -> ~/.cache/marsx/jezero-v1 (or $MARSX_DATA_CACHE/jezero-v1)
    os.environ["MARSX_DATA"] = str(path)

- Source: ``base_url`` argument, else ``$MARSX_DATA_URL``, else the production site. ``<base_url>/<region>/manifest.json``.
- Only layers used by ``marsx.env`` are downloaded (planning-grid slope/step/elevation, horizon, sky view, slip
  class, sun and OWLT tables) plus optional daily MEDA summaries ``meda/sol-NNNN.json``.
- TLS is always verified (stdlib default context); plain http is allowed only for localhost (tests).
- Every file listed in the manifest is checked against its sha256; cached files with the right hash are reused.
- MEDA summaries are not listed in the manifest (no hash to check): they are size-capped, schema-checked and their
  sha256 is recorded in ``meda/index.json`` with ``"verifiedAgainstManifest": false``.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
import ssl
import urllib.parse
import urllib.request
from collections.abc import Iterable
from pathlib import Path, PurePosixPath

DEFAULT_BASE_URL = "https://mars-x-7k9.pages.dev/data"
ENV_KINDS = {("slope", "plan"), ("step", "plan"), ("elevation", "plan"), ("horizon", "plan"), ("sky_view", "plan"),
             ("slip_class", "plan"), ("sun_table", None), ("owlt_table", None)}
MAX_MANIFEST_BYTES = 2_000_000
MAX_LAYER_BYTES = 64_000_000
MAX_MEDA_BYTES = 1_000_000
TIMEOUT_S = 60
RETRIES = 4
RETRY_BASE_S = 2.0  # exponential backoff: 2, 4, 8 s


class IntegrityError(RuntimeError):
    """A downloaded file does not match the sha256 in the manifest."""


def _check_base(url: str) -> str:
    u = urllib.parse.urlparse(url)
    local = u.hostname in ("127.0.0.1", "localhost", "::1")
    if u.scheme != "https" and not (u.scheme == "http" and local):
        raise ValueError(f"base_url must use https (plain http only for localhost): {url!r}")
    return url.rstrip("/")


def _safe_rel(path: str) -> PurePosixPath:
    p = PurePosixPath(path)
    if p.is_absolute() or ".." in p.parts or "\\" in path or not p.parts or ":" in p.parts[0]:
        raise ValueError(f"unsafe path in manifest: {path!r}")
    return p


def _get_once(url: str, limit: int, timeout: float) -> bytes:
    # Certificate + hostname verification, always. Prefer certifi's CA bundle: on some Windows machines the system
    # store hands OpenSSL an expired root and verification of valid sites fails ("certificate has expired").
    try:
        import certifi

        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        ctx = ssl.create_default_context()
    req = urllib.request.Request(url, headers={"User-Agent": "marsx-sdk"})
    with urllib.request.urlopen(req, timeout=timeout, context=ctx if url.startswith("https") else None) as r:
        data = r.read(limit + 1)
    if len(data) > limit:
        raise ValueError(f"{url}: larger than {limit} bytes")
    return data


def _get(url: str, limit: int, timeout: float) -> bytes:
    """GET with retries on transient network errors (connection reset, timeouts); HTTP errors are not retried."""
    import time
    import urllib.error

    for attempt in range(RETRIES):
        try:
            return _get_once(url, limit, timeout)
        except urllib.error.HTTPError:
            raise
        except (urllib.error.URLError, ConnectionError, TimeoutError, OSError):
            if attempt == RETRIES - 1:
                raise
            time.sleep(RETRY_BASE_S * 2**attempt)
    raise AssertionError("unreachable")


def _sha(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _valid_meda(doc: object, sol: int) -> bool:
    if not isinstance(doc, dict) or doc.get("sol") != sol or not isinstance(doc.get("hours", []), list):
        return False
    for h in doc.get("hours", [])[:48]:
        if not isinstance(h, dict) or not isinstance(h.get("hour"), int) or not 0 <= h["hour"] < 24:
            return False
        for k in ("temperatureK", "windSpeedMs"):
            v = h.get(k)
            if v is not None and not (isinstance(v, (int, float)) and math.isfinite(v)):
                return False
    tau = doc.get("tau")
    return tau is None or (isinstance(tau, (int, float)) and math.isfinite(tau) and tau >= 0)


def default_meda_sols() -> list[int]:
    from marsx.conditions.meda import SOLS

    return sorted(SOLS)


def fetch(base_url: str | None = None, region: str = "jezero-v1", dest: str | Path | None = None,
          meda_sols: Iterable[int] | None = None, timeout: float = TIMEOUT_S) -> Path:
    """Fetch (or reuse from cache) the env layers of ``region``; returns the local dataset directory."""
    if not region.replace("-", "").isalnum():
        raise ValueError(f"invalid region {region!r}")
    base = _check_base(base_url or os.environ.get("MARSX_DATA_URL") or DEFAULT_BASE_URL)
    if dest is None:
        dest = Path(os.environ.get("MARSX_DATA_CACHE") or Path.home() / ".cache" / "marsx") / region
    out = Path(dest)
    out.mkdir(parents=True, exist_ok=True)
    raw = _get(f"{base}/{region}/manifest.json", MAX_MANIFEST_BYTES, timeout)
    manifest = json.loads(raw)
    for layer in manifest.get("layers", []):
        if (layer.get("kind"), layer.get("gridId")) not in ENV_KINDS:
            continue
        rel = _safe_rel(layer["path"])
        target = out.joinpath(*rel.parts)
        if target.exists() and _sha(target.read_bytes()) == layer["sha256"]:
            continue  # cached
        blob = _get(f"{base}/{region}/{rel.as_posix()}", MAX_LAYER_BYTES, timeout)
        if _sha(blob) != layer["sha256"]:
            raise IntegrityError(f"sha256 mismatch for layer {layer.get('id')} ({rel})")
        target.parent.mkdir(parents=True, exist_ok=True)
        tmp = target.with_suffix(target.suffix + ".part")
        tmp.write_bytes(blob)
        tmp.replace(target)
    index = {}
    for sol in default_meda_sols() if meda_sols is None else meda_sols:
        name = f"sol-{int(sol):04d}.json"
        try:
            blob = _get(f"{base}/{region}/meda/{name}", MAX_MEDA_BYTES, timeout)
        except (OSError, ValueError):  # not published for this sol (HTTP 404) or unreachable: L2 reports MISSING
            continue
        try:
            doc = json.loads(blob)
        except ValueError:
            continue
        if not _valid_meda(doc, int(sol)):
            continue
        (out / "meda").mkdir(exist_ok=True)
        (out / "meda" / name).write_bytes(blob)
        index[name] = {"sha256": _sha(blob), "verifiedAgainstManifest": False}
    if index:
        (out / "meda" / "index.json").write_text(json.dumps(index, indent=1, sort_keys=True), encoding="utf-8")
    (out / "manifest.json").write_bytes(raw)  # last: a complete directory only has a manifest once layers are in
    return out
