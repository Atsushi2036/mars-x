import json
from pathlib import Path

import jsonschema
import pytest
from pydantic import ValidationError

from marsx import schemas

REPO = Path(__file__).resolve().parents[2]


def minimal_manifest() -> dict:
    sha = "a" * 64
    grid = {
        "id": "dem", "width": 2048, "height": 2048, "resM": 1.0,
        "transform": [1.0, 0.0, -1024.0, 0.0, -1.0, 1024.0],
        "bbox": [-1024.0, -1024.0, 1024.0, 1024.0], "pixelIs": "area", "northUp": True,
    }
    return {
        "schemaVersion": "1.0.0",
        "datasetId": "jezero-v1",
        "version": "1.0.0",
        "contentHash": sha,
        "generatedAt": "2026-11-14T22:00:00Z",
        "pipeline": {"gitCommit": None, "paramsHash": sha, "tools": {"numpy": "2.5.4"}},
        "crs": {
            "geographic": "IAU_2015:49900",
            "sourceProj4": "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs",
            "localProj4": "+proj=eqc +lat_ts=18.46 +lon_0=77.39 +R=3396190 +units=m +no_defs",
            "localWkt2": "PROJCRS[...]",
            "verticalDatum": "MOLA areoid (DeltaGeoid)",
            "center": {"lon": 77.39, "lat": 18.46},
            "localOrigin": "window centre = (0, 0); x east, y north, z up (metres)",
        },
        "grid": grid,
        "grids": {"dem": grid},
        "bboxLonLat": [77.38, 18.45, 77.40, 18.47],
        "layers": [
            {
                "id": "height", "kind": "elevation", "gridId": "dem", "path": "height.u16",
                "sha256": sha, "bytes": 8388608, "shape": [2048, 2048], "axes": "row,col",
                "encoding": {"dtype": "uint16", "endian": "little", "scale": 0.002, "offset": -2551.0, "nodata": 65535},
                "stats": {"min": -2551.0, "max": -2412.0, "mean": -2488.0},
                "origin": "derived",
                "source": {
                    "title": "USGS HiRISE DTM mosaic", "doi": "10.5066/P13CPYYU", "url": None,
                    "license": "CC0-1.0", "attribution": "USGS Astrogeology / NASA / JPL / UArizona",
                    "retrievedAt": "2026-11-14T21:00:00Z", "rawSha256": sha,
                },
                "validation": {"coverage": 1.0, "alignRmseM": 0.3, "method": "phase-correlation"},
            }
        ],
    }


def test_minimal_manifest_roundtrips_and_validates_against_exported_schema():
    m = schemas.Manifest.model_validate(minimal_manifest())
    dumped = json.loads(m.model_dump_json(by_alias=True))
    jsonschema.validate(dumped, schemas.manifest_json_schema())
    assert dumped["grid"]["resM"] == 1.0 and dumped["layers"][0]["encoding"]["nodata"] == 65535


def test_unknown_fields_and_bad_values_are_rejected():
    bad = minimal_manifest()
    bad["surprise"] = 1
    with pytest.raises(ValidationError):
        schemas.Manifest.model_validate(bad)
    bad = minimal_manifest()
    bad["layers"][0]["sha256"] = "xyz"
    with pytest.raises(ValidationError):
        schemas.Manifest.model_validate(bad)
    bad = minimal_manifest()
    bad["grid"]["transform"] = [1, 0, 0]
    with pytest.raises(ValidationError):
        schemas.Manifest.model_validate(bad)
    bad = minimal_manifest()
    bad["layers"][0]["origin"] = "imagined"
    with pytest.raises(ValidationError):
        schemas.Manifest.model_validate(bad)


def test_layer_must_reference_a_declared_grid():
    bad = minimal_manifest()
    bad["layers"][0]["gridId"] = "nope"
    with pytest.raises(ValidationError, match="gridId"):
        schemas.Manifest.model_validate(bad)


def test_committed_json_schema_has_no_drift():
    path = REPO / "packages" / "schemas" / "manifest.schema.json"
    assert path.exists(), "run: uv run python -m marsx.schemas"
    assert json.loads(path.read_text(encoding="utf-8")) == schemas.manifest_json_schema()
