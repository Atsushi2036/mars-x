"""Golden fixtures must match what the Python oracle generates today (fail if behaviour changed without regenerating).

Regenerate with: uv run --project python python python/tests/parity/golden_gen.py
Float payloads tolerate cross-platform libm noise (f32 blobs 1e-5, scalars 1e-9 relative); everything else is exact.
"""

from __future__ import annotations

import base64
import hashlib
import json
import math

import numpy as np
import pytest

import golden_gen as gen

REGEN = "fixtures changed: regenerate with `uv run --project python python python/tests/parity/golden_gen.py` and review the diff"


@pytest.fixture(scope="module")
def fresh() -> dict[str, str]:
    return gen.build_all()


def _f32(s: str) -> np.ndarray:
    return np.frombuffer(base64.b64decode(s), dtype="<f4")


def _same(a, b, path: str, f32: bool = False) -> None:
    if isinstance(a, dict):
        assert isinstance(b, dict) and a.keys() == b.keys(), f"{path}: keys differ"
        for k in a:
            _same(a[k], b[k], f"{path}.{k}", f32 or k in gen.F32_KEYS or k == "obs")
    elif isinstance(a, list):
        assert isinstance(b, list) and len(a) == len(b), f"{path}: length {len(a)} vs {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            _same(x, y, f"{path}[{i}]", f32)
    elif isinstance(a, str) and f32 and a != b:
        np.testing.assert_allclose(_f32(a), _f32(b), rtol=1e-5, atol=1e-5, err_msg=path)
    elif isinstance(a, float) or isinstance(b, float):
        assert math.isclose(a, b, rel_tol=1e-9, abs_tol=1e-9), f"{path}: {a} vs {b}"
    else:
        assert a == b, f"{path}: {a!r} vs {b!r}"


@pytest.mark.parametrize("rel", sorted(gen.BUILDERS))
def test_committed_fixture_matches_oracle(rel, fresh):
    committed = json.loads((gen.GOLDEN / rel).read_text(encoding="utf-8"))
    try:
        _same(json.loads(fresh[rel]), committed, rel)
    except AssertionError as e:
        raise AssertionError(f"{REGEN}\n{e}") from None


def test_manifest_hashes_match_committed_files():
    manifest = json.loads((gen.GOLDEN / "manifest.json").read_text(encoding="utf-8"))
    assert set(manifest["files"]) == set(gen.BUILDERS)
    for rel, meta in manifest["files"].items():
        data = (gen.GOLDEN / rel).read_bytes().replace(b"\r\n", b"\n")
        assert hashlib.sha256(data).hexdigest() == meta["sha256"], f"{rel}: edited by hand or stale manifest. {REGEN}"


def test_l2_cases_cover_the_required_behaviours():
    doc = json.loads((gen.GOLDEN / "env/env-l2-golden.json").read_text(encoding="utf-8"))
    ids = {c["id"] for c in doc["cases"]}
    for need in ("shadow-open-sky", "shadow-wall-80deg", "solar-balance-clear", "solar-balance-storm",
                 "comms-one-plan-per-sol", "spe-alert-then-shelter", "spe-violation"):
        assert need in ids
    by = {c["id"]: c["rows"] for c in doc["cases"]}
    assert by["shadow-open-sky"][0]["lit"] and not by["shadow-wall-80deg"][0]["lit"]
    assert by["solar-balance-clear"][-1]["soc"] > 0.5 > by["solar-storm-early-drain"][-1]["soc"]
    assert any(not r["linkAvailable"] for r in doc["commsDirect"])  # solar-conjunction moratorium is covered
    assert by["spe-violation"][-1]["after"]["outcome"] == "spe_violation"
