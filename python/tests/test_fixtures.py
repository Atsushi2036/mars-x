import base64
import json
import math
from pathlib import Path

import numpy as np
import pytest

from marsx.pipeline import fixtures

REPO = Path(__file__).resolve().parents[2]
GOLDEN = REPO / "packages" / "schemas" / "fixtures" / "golden.json"


@pytest.fixture(scope="module")
def golden() -> dict:
    return fixtures.build_golden()


def test_committed_golden_fixture_has_no_drift(golden):
    assert GOLDEN.exists(), "run: uv run python -m marsx.pipeline.fixtures"
    assert json.loads(GOLDEN.read_text(encoding="utf-8")) == json.loads(json.dumps(golden))


def test_dem8_has_nodata_as_null_and_row0_is_north(golden):
    dem = golden["dem8"]["values"]
    assert len(dem) == 8 and all(len(r) == 8 for r in dem)
    assert dem[2][5] is None  # the nodata hole
    assert golden["grid"]["transform"][4] < 0  # y decreases with row


def test_pixel_world_pairs_are_consistent(golden):
    g = golden["grid"]
    for p in golden["pixelWorld"]:
        x = g["x0"] + (p["col"] + (0.5 if p["center"] else 0.0)) * g["res"]
        y = g["y0"] - (p["row"] + (0.5 if p["center"] else 0.0)) * g["res"]
        assert (x, y) == pytest.approx((p["x"], p["y"]))


def test_u16_payload_is_little_endian_and_decodes_to_the_dem(golden):
    h = golden["heightU16"]
    raw = base64.b64decode(h["base64"])
    assert len(raw) == 8 * 8 * 2
    q = np.frombuffer(raw, dtype="<u2").reshape(8, 8)
    assert q[2, 5] == h["encoding"]["nodata"]
    dem = np.array([[np.nan if v is None else v for v in r] for r in golden["dem8"]["values"]], np.float32)
    back = q.astype(np.float32) * h["encoding"]["scale"] + h["encoding"]["offset"]
    back[q == h["encoding"]["nodata"]] = np.nan
    assert np.allclose(back, dem, atol=h["encoding"]["scale"], equal_nan=True)
    # explicit byte-order canary: value 0x1234 must be serialised as 34 12
    assert golden["endianCanary"] == {"value": 0x1234, "bytesHex": "3412"}


def test_flat_and_ramp_slopes(golden):
    assert np.allclose(np.array(golden["flat8"]["slopeDeg"]), 0.0)
    ramp = np.array(golden["ramp45East8"]["slopeDeg"])
    assert np.allclose(ramp, 45.0, atol=1e-3)
    assert golden["ramp45East8"]["values"][0][:3] == [0.0, 1.0, 2.0]  # rises towards east, +1 m per m
    n = golden["ramp45East8"]["normalRgb"][4][4]
    assert n[0] < 128 and n[2] == pytest.approx(round((math.cos(math.radians(45)) * 0.5 + 0.5) * 255), abs=1)
