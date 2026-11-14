"""Data contract between the Python pipeline and the web frontend (single source of truth).

``Manifest`` is validated by the pipeline before it is written and exported as JSON Schema
2020-12 to ``packages/schemas/manifest.schema.json`` (CI fails on drift). JSON keys are camelCase.

Regenerate with:  ``uv run python -m marsx.schemas``
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator
from pydantic.alias_generators import to_camel

Sha256 = Annotated[str, StringConstraints(pattern=r"^[0-9a-f]{64}$")]
Transform6 = Annotated[list[float], Field(min_length=6, max_length=6)]
BBox4 = Annotated[list[float], Field(min_length=4, max_length=4)]


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Grid(Model):
    id: str
    width: int = Field(gt=0)
    height: int = Field(gt=0)
    res_m: float = Field(gt=0)
    # GDAL affine (a, b, c, d, e, f): x = a*col + b*row + c, y = d*col + e*row + f; (c, f) = upper-left CORNER
    transform: Transform6
    bbox: BBox4  # xmin, ymin, xmax, ymax in local metres
    pixel_is: Literal["area"] = "area"
    north_up: bool = True


class Center(Model):
    lon: float
    lat: float


class Crs(Model):
    geographic: str
    source_proj4: str
    local_proj4: str
    local_wkt2: str
    vertical_datum: str
    center: Center
    local_origin: str



class Pipeline(Model):
    git_commit: str | None
    params_hash: Sha256
    tools: dict[str, str]


class Encoding(Model):
    dtype: Literal["uint8", "uint16", "float32", "image/webp", "image/png"]
    endian: Literal["little", "n/a"] = "little"
    scale: float | None = None
    offset: float | None = None
    nodata: float | None = None
    description: str | None = None


class Stats(Model):
    min: float | None = None
    max: float | None = None
    mean: float | None = None
    valid_fraction: float | None = None


class Source(Model):
    title: str
    doi: str | None = None
    url: str | None = None
    license: str
    attribution: str
    retrieved_at: str
    raw_sha256: Sha256 | None = None


class LayerValidation(Model):
    coverage: float = Field(ge=0, le=1)
    align_rmse_m: float | None = None
    method: str


class Tiling(Model):
    tile_size: int
    format: Literal["webp"]
    levels: list[dict[str, int]]  # lod, size (px), tiles (per side)
    path_template: str  # e.g. "ortho/{lod}/{x}_{y}.webp"; lod 0 = full resolution, y = row from north


class LegendItem(Model):
    color: str
    label: str
    pixels: int | None = None


class Layer(Model):
    id: str
    kind: Literal[
        "elevation", "slope", "aspect", "roughness", "step", "hazard", "normal",
        "horizon", "orthoimage", "mineral", "vector",
    ]
    grid_id: str
    path: str
    sha256: Sha256
    bytes: int = Field(ge=0)
    shape: list[int] | None = None
    axes: str | None = None
    encoding: Encoding
    stats: Stats | None = None
    legend: list[LegendItem] | None = None
    tiling: Tiling | None = None
    notes: str | None = None
    origin: Literal["observed", "derived", "simulated"]
    source: Source
    validation: LayerValidation | None = None


class Manifest(Model):
    schema_version: str
    dataset_id: str
    version: str
    content_hash: Sha256
    generated_at: str
    pipeline: Pipeline
    crs: Crs
    grid: Grid
    grids: dict[str, Grid]
    bbox_lon_lat: BBox4
    layers: list[Layer]
    extras: dict[str, str] | None = None

    @model_validator(mode="after")
    def _layers_reference_grids(self) -> Manifest:
        for layer in self.layers:
            if layer.grid_id not in self.grids:
                raise ValueError(f"layer {layer.id}: gridId {layer.grid_id!r} is not declared in grids")
        return self


def manifest_json_schema() -> dict:
    schema = Manifest.model_json_schema(by_alias=True, mode="serialization")
    schema["$schema"] = "https://json-schema.org/draft/2020-12/schema"
    schema["$id"] = "https://mars-x.dev/schemas/manifest.schema.json"
    return json.loads(json.dumps(schema, sort_keys=True))


def export_schemas(out_dir: Path) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / "manifest.schema.json"
    path.write_text(json.dumps(manifest_json_schema(), indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


if __name__ == "__main__":
    repo = Path(__file__).resolve().parents[3]
    print(export_schemas(repo / "packages" / "schemas"))
