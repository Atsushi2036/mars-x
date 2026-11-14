"""Terrain for the environment: the pipeline's 2 m planning grid (or a deterministic synthetic map for tests)."""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from marsx.nav.costmap import cost_from_slope


@dataclass
class Terrain:
    slope_deg: np.ndarray  # float32 (H, W), NaN = nodata
    step_m: np.ndarray  # float32 (H, W), NaN = nodata
    height_m: np.ndarray  # float32 (H, W), NaN = nodata
    res_m: float = 2.0
    source: str = "synthetic"
    dataset_sha256: str | None = None
    horizon_deg: np.ndarray | None = None  # float16 (16, H, W): horizon elevation per azimuth k*22.5 deg from north
    center_lat_deg: float = 18.49
    center_lon_east_deg: float = 77.40
    sky_view: np.ndarray | None = None  # float32 (H, W) from the pipeline's sky_view layer
    slip_class: np.ndarray | None = None  # float32 (H, W): 0 fines, 1 mixed, 2 rock, NaN unknown (THEMIS proxy)
    tables: dict[str, tuple[np.ndarray, dict]] | None = None  # time tables (sun_table, owlt_table): id -> (rows, meta)

    @property
    def shape(self) -> tuple[int, int]:
        return self.slope_deg.shape


def _decode(data_dir: Path, layer: dict) -> np.ndarray:
    raw = (data_dir / layer["path"]).read_bytes()
    if hashlib.sha256(raw).hexdigest() != layer["sha256"]:
        raise ValueError(f"sha256 mismatch for {layer['path']}")
    enc = layer["encoding"]
    dt = {"uint8": "u1", "uint16": "<u2", "float32": "<f4"}[enc["dtype"]]
    q = np.frombuffer(raw, dtype=dt).reshape(layer["shape"])
    out = q.astype(np.float32) * np.float32(enc.get("scale") or 1.0) + np.float32(enc.get("offset") or 0.0)
    if enc.get("nodata") is not None:
        out[q == enc["nodata"]] = np.nan
    return out


def load_terrain(data_dir: str | Path, grid_id: str = "plan") -> Terrain:
    """Load slope/step/height of the planning grid from a processed dataset (manifest.json + raw layers)."""
    data_dir = Path(data_dir)
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    layers = {(l["kind"], l["gridId"]): l for l in manifest["layers"]}
    get = lambda kind: _decode(data_dir, layers[(kind, grid_id)])  # noqa: E731
    opt = lambda kind: get(kind) if (kind, grid_id) in layers else None  # noqa: E731
    hz = opt("horizon")
    horizon = None if hz is None else np.nan_to_num(hz, nan=0.0).astype(np.float16)  # nodata -> open sky
    sky = opt("sky_view")
    tables = {l["id"]: (_decode(data_dir, l), l["table"]) for l in manifest["layers"]
              if l["kind"] in ("sun_table", "owlt_table") and l.get("table")}
    center = manifest.get("crs", {}).get("center") or {}
    return Terrain(slope_deg=get("slope"), step_m=get("step"), height_m=get("elevation"),
                   res_m=float(manifest["grids"][grid_id]["resM"]), source=f"{manifest['datasetId']}:{grid_id}",
                   dataset_sha256=manifest.get("contentHash"), horizon_deg=horizon,
                   center_lat_deg=float(center.get("lat", 18.49)), center_lon_east_deg=float(center.get("lon", 77.40)),
                   sky_view=None if sky is None else np.nan_to_num(sky, nan=1.0), slip_class=opt("slip_class"),
                   tables=tables or None)


def synthetic_terrain(n: int = 128, seed: int = 0, res_m: float = 2.0, relief_m: float = 4.0) -> Terrain:
    """Deterministic rolling terrain with a few rock-like bumps (tests, demos, CI without data)."""
    rng = np.random.default_rng(seed)
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    ph, ang = rng.uniform(0, 2 * np.pi, 6), rng.uniform(0, 2 * np.pi, 6)
    h = sum((relief_m / (k + 1)) * np.sin(0.04 * (k + 1) * (np.cos(ang[k]) * x + np.sin(ang[k]) * y) + ph[k])
            for k in range(6))
    for _ in range(n * n // 400):
        r, c = rng.integers(0, n, 2)
        h[max(0, r - 1):r + 2, max(0, c - 1):c + 2] += rng.uniform(0.3, 1.5)
    h += rng.random((n, n)) * 0.05
    gy, gx = np.gradient(h, res_m)
    slope = np.degrees(np.arctan(np.hypot(gx, gy)))
    # same definition as marsx.pipeline.derive.step_height: max over 4 directions of |z(+d) + z(-d) - 2z|
    pad = np.pad(h, 1, mode="edge")
    sh = lambda dy, dx: pad[1 + dy:1 + dy + n, 1 + dx:1 + dx + n]  # noqa: E731
    step = np.max([np.abs(sh(dy, dx) + sh(-dy, -dx) - 2 * h) for dy, dx in ((0, 1), (1, 0), (1, 1), (1, -1))], axis=0)
    return Terrain(slope.astype(np.float32), step.astype(np.float32), h.astype(np.float32), res_m, f"synthetic:{seed}")


def cost_map(terrain: Terrain, max_slope_deg: float, max_step_m: float, slope_weight: float = 4.0) -> np.ndarray:
    """Traversal cost per cell (1..1+slope_weight), inf where slope/step exceed the agent limits or nodata."""
    blocked = ~np.isfinite(terrain.step_m) | (terrain.step_m > max_step_m) | ~np.isfinite(terrain.height_m)
    return cost_from_slope(terrain.slope_deg, max_slope_deg, slope_weight, blocked_mask=blocked)
