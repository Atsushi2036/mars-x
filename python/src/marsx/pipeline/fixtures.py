"""Golden fixtures shared by pytest and Vitest (``packages/schemas/fixtures/golden.json``).

They pin the conventions that silently break 3D terrain code: half-pixel offsets, inverted Y,
byte order, nodata handling and slope units. Regenerate with
``uv run python -m marsx.pipeline.fixtures``.
"""

from __future__ import annotations

import base64
import json
from pathlib import Path

import numpy as np

from . import derive, encode
from .geo import Grid


def _list(a: np.ndarray, digits: int = 4) -> list:
    if a.ndim == 1:
        return [None if np.isnan(v) else round(float(v), digits) for v in a]
    return [_list(r, digits) for r in a]


def build_golden() -> dict:
    grid = Grid(x0=-4.0, y0=4.0, res=1.0, width=8, height=8)
    rng = np.random.default_rng(42)
    dem = (-2500.0 + np.cumsum(rng.normal(0, 0.4, (8, 8)), axis=1)).astype(np.float32)
    dem = np.round(dem, 3)
    dem[2, 5] = np.nan  # nodata hole
    flat = np.full((8, 8), -2500.0, np.float32)
    ramp = np.tile(np.arange(8, dtype=np.float32), (8, 1))  # +1 m per metre eastwards = 45 degrees
    q, enc = encode.height_to_u16(dem)

    pixel_world = []
    for col, row, center in [(0, 0, False), (0, 0, True), (7, 7, True), (7, 0, True), (0, 7, True), (3, 5, True)]:
        x, y = grid.pixel_to_world(col, row, center=center)
        pixel_world.append({"col": col, "row": row, "center": center, "x": x, "y": y})

    return {
        "description": "MARS-X golden fixtures. Row 0 = north, col 0 = west, pixel corner origin (GDAL).",
        "grid": {"x0": grid.x0, "y0": grid.y0, "res": grid.res, "width": 8, "height": 8,
                 "transform": list(grid.transform), "bbox": list(grid.bbox)},
        "pixelWorld": pixel_world,
        "dem8": {"values": _list(dem, 3), "slopeDeg": _list(derive.slope_deg(dem, 1.0), 3)},
        "heightU16": {
            "encoding": {**enc, "scale": float(f"{enc['scale']:.12g}"), "offset": float(f"{enc['offset']:.6f}")},
            "base64": base64.b64encode(encode.to_le_bytes(q)).decode("ascii"),
        },
        "endianCanary": {"value": 0x1234, "bytesHex": encode.to_le_bytes(np.array([0x1234], np.uint16)).hex()},
        "flat8": {"values": _list(flat, 1), "slopeDeg": _list(derive.slope_deg(flat, 1.0), 3)},
        "ramp45East8": {
            "values": _list(ramp, 1),
            "slopeDeg": _list(derive.slope_deg(ramp, 1.0), 3),
            "normalRgb": derive.normal_map(ramp, 1.0).tolist(),
        },
        "maxpool2": {
            "input": _list(np.array([[1, 2, 5, np.nan], [3, 4, np.nan, np.nan]], np.float32), 1),
            "output": _list(derive.maxpool(np.array([[1, 2, 5, np.nan], [3, 4, np.nan, np.nan]], np.float32), 2), 1),
        },
    }


def export(out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(build_golden(), indent=1) + "\n", encoding="utf-8")
    return out_path


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[4]
    print(export(repo / "packages" / "schemas" / "fixtures" / "golden.json"))
