"""Build one scenario export package (see marsx.export) from a processed dataset directory."""

from __future__ import annotations

import hashlib
import io
import json
import math
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from marsx.contracts.scenario import Scenario
from marsx.export import mesh as M
from marsx.export import sdf as S
from marsx.export import sun as SUN

PACKAGE_SCHEMA = "export/1"
FIXED_TIME = (1980, 1, 1, 0, 0, 0)

ATTRIBUTION = """MARS-X export package - data attribution and licences

Terrain (DEM) and orthoimage: USGS Astrogeology Science Center, Mars Sample Return HiRISE mosaics for terrain relative
navigation (Bland, M.T. et al., 2025), doi:10.5066/P13CPYYU. Public domain (CC0 1.0).
HiRISE imagery: NASA/JPL/University of Arizona.
Sun position: Mars24 algorithm (Allison and McEwen, 2000). Gravity: NSSDCA Mars Fact Sheet interpolated to the site latitude.
Vertical datum: MOLA areoid (DeltaGeoid); elevations in metres.

Not affiliated with or endorsed by NASA, JPL or Caltech.
These files were produced with MARS-X, whose source code was written with the assistance of Claude Code (Anthropic)
under the direction of the team. No NASA/JPL logos are included.
"""

README = """MARS-X export package

terrain.tif          GeoTIFF float32, metres (local equirectangular CRS, lat_ts = centre latitude), NaN = no data
terrain.obj/.mtl     Z-up ENU metres (Gazebo, Isaac Lab MeshConverter); texture terrain_texture.jpg
terrain.glb          glTF 2.0, self-contained, Y up (x east, y up, -z north); web viewers, Isaac Sim importer
world.sdf            Gazebo world (Harmonic/Jetty): scenario gravity, directional Sun from Mars24, start/goal markers
scenario.json        scenario/1 document (start and goal filled in as [row, col] of the planning grid)
manifest.json        export/1: sha256 of every file, frame, Sun, gravity, mesh fidelity
ATTRIBUTION.txt      sources and licences

Frame: local ENU in metres, origin at the dataset window centre; the world.sdf and OBJ use it directly.
The generated SDF contains no <plugin>. Gazebo loads its default server plugins (physics, user commands, scene
broadcaster) when the world declares none. Wheel-slip maps or sensors are added by you, on your own responsibility.
Isaac Sim/Lab: import terrain.obj with MeshConverter (glTF is not accepted there) and set the stage up axis to Z.
The mesh is decimated (see manifest.json mesh.stepCells); the GeoTIFF holds the full-resolution elevations.
Simulation only: this is a first filter, not flight qualification.
"""


@dataclass
class ExportInputs:
    scenario: Scenario
    height: np.ndarray  # float32 (H, W) window crop at DEM resolution, NaN = nodata, metres
    res_m: float
    x_west: float  # local metres, west edge of the crop
    y_north: float  # local metres, north edge of the crop
    local_wkt2: str
    local_proj4: str
    center_lat: float
    center_lon: float
    dataset_id: str
    dataset_sha256: str | None
    texture: np.ndarray | None  # uint8 (h, w) grayscale, north up, same footprint as ``height``
    start_xy: tuple[float, float]
    goal_xy: tuple[float, float]
    start_cell: list[int] | None = None
    goal_cell: list[int] | None = None
    marker_source: str = "scenario"
    vertical_datum: str = "MOLA areoid (DeltaGeoid); elevations in metres"


def slug(scenario_id: str) -> str:
    return re.sub(r"[^a-z0-9_-]+", "-", scenario_id.lower()).strip("-")


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def sample_height(height: np.ndarray, res_m: float, x_west: float, y_north: float, x: float, y: float) -> float:
    """Bilinear DEM sample at local metres (x, y); clamps to the crop."""
    c = (x - x_west) / res_m - 0.5
    r = (y_north - y) / res_m - 0.5
    r = min(max(r, 0.0), height.shape[0] - 1.0)
    c = min(max(c, 0.0), height.shape[1] - 1.0)
    r0, c0 = math.floor(r), math.floor(c)
    r1, c1 = min(r0 + 1, height.shape[0] - 1), min(c0 + 1, height.shape[1] - 1)
    fr, fc = r - r0, c - c0
    h = np.asarray(height, dtype=np.float64)
    return float((h[r0, c0] * (1 - fc) + h[r0, c1] * fc) * (1 - fr) + (h[r1, c0] * (1 - fc) + h[r1, c1] * fc) * fr)


def write_geotiff(path: Path, inp: ExportInputs) -> None:
    import rasterio
    from rasterio.crs import CRS
    from rasterio.transform import Affine

    h, w = inp.height.shape
    with rasterio.open(path, "w", driver="GTiff", height=h, width=w, count=1, dtype="float32",
                       crs=CRS.from_wkt(inp.local_wkt2), transform=Affine(inp.res_m, 0, inp.x_west, 0, -inp.res_m, inp.y_north),
                       nodata=float("nan"), compress="deflate", predictor=3, tiled=True, blockxsize=256, blockysize=256) as ds:
        ds.write(np.asarray(inp.height, dtype=np.float32), 1)
        ds.update_tags(VERTICAL_DATUM=inp.vertical_datum, UNITS="metre", SOURCE_DATASET=inp.dataset_id,
                       PROJ4_LOCAL=inp.local_proj4)
        ds.set_band_description(1, "elevation_m")


def _jpeg(texture: np.ndarray, quality: int = 85) -> bytes:
    from PIL import Image

    buf = io.BytesIO()
    Image.fromarray(texture, mode="L").convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True)
    return buf.getvalue()


def mesh_error_vs_dem(height: np.ndarray, mesh: M.Mesh) -> dict:
    """Approximate vertical deviation of the decimated surface (bilinear quads) from the full DEM, per cell."""
    from scipy.ndimage import map_coordinates

    ri, ci = _grid_axes(height.shape, mesh.step_cells)
    z = mesh.positions[:, 2].reshape(mesh.rows, mesh.cols).astype(np.float64)
    rr = np.interp(np.arange(height.shape[0]), ri, np.arange(len(ri)))
    cc = np.interp(np.arange(height.shape[1]), ci, np.arange(len(ci)))
    R, C = np.meshgrid(rr, cc, indexing="ij")
    approx = map_coordinates(z, [R, C], order=1, mode="nearest")
    ref = np.where(np.isfinite(height), height, np.nanmin(height))
    err = np.abs(approx - ref)
    return {"maxM": float(err.max()), "rmsM": float(math.sqrt(float((err ** 2).mean()))),
            "p95M": float(np.percentile(err, 95)), "method": "bilinear-quad approximation vs DEM at every cell"}


def _grid_axes(shape: tuple[int, int], k: int) -> tuple[np.ndarray, np.ndarray]:
    return M._axis(shape[0], k), M._axis(shape[1], k)


def sun_light_levels(tau: float | None, elevation_deg: float) -> tuple[float, float]:
    """Visual-only scaling (ASSUMPTION, not a radiative-transfer result): direct beam attenuated by exp(-tau/sin el),
    ambient grows with the diffuse share of the dust opacity."""
    t = 0.5 if tau is None else float(tau)
    if elevation_deg <= 0:
        return 0.0, 0.05
    direct = math.exp(-t / max(math.sin(math.radians(elevation_deg)), 0.05))
    ambient = 0.10 + 0.25 * (1.0 - math.exp(-t))
    return max(0.05, min(1.0, direct * 1.0)), min(0.6, ambient)


def build_files(inp: ExportInputs, mesh_step: int = 8) -> tuple[dict[str, bytes], dict]:
    """Return ({relative path: bytes}, manifest document without the file hashes)."""
    sc = inp.scenario
    h, w = inp.height.shape
    mesh = M.build_heightfield_mesh(inp.height, inp.res_m, inp.x_west, inp.y_north, mesh_step)
    tex = _jpeg(inp.texture) if inp.texture is not None else None
    files: dict[str, bytes] = {}

    import tempfile

    with tempfile.TemporaryDirectory() as td:
        tif = Path(td) / "terrain.tif"
        write_geotiff(tif, inp)
        files["terrain.tif"] = tif.read_bytes()

    start_z = sample_height(inp.height, inp.res_m, inp.x_west, inp.y_north, *inp.start_xy)
    goal_z = sample_height(inp.height, inp.res_m, inp.x_west, inp.y_north, *inp.goal_xy)
    start_utc = sc.time.start_utc if sc.time else SUN.DEFAULT_START_UTC
    sun = SUN.sun_enu(start_utc, inp.center_lat, inp.center_lon)
    sun["timeSource"] = "scenario" if sc.time else "default (scenario has no time)"
    tau = sc.conditions.tau.value if sc.conditions.tau else None
    intensity, ambient = sun_light_levels(tau, sun["elevationDeg"])
    sun["visualIntensity"], sun["visualAmbient"] = round(intensity, 4), round(ambient, 4)
    sun["visualScalingNote"] = "display-only assumption: exp(-tau/sin(el)) direct beam; ambient 0.10 + 0.25*(1-exp(-tau)); tau default 0.5"
    g = float(sc.conditions.gravity.value)

    start = S.Marker(*inp.start_xy, start_z)
    goal = S.Marker(*inp.goal_xy, goal_z)
    files["world.sdf"] = S.render_world_sdf(S.WorldParams(
        scenario_id=sc.id, gravity=g, sun_vector_enu=tuple(sun["vector"]), sun_intensity=intensity, ambient=ambient,
        start=start, goal=goal)).encode("utf-8")

    files["terrain.obj"] = M.obj_bytes(mesh)
    files["terrain.mtl"] = M.mtl_text().encode("ascii")
    if tex:
        files["terrain_texture.jpg"] = tex
    files["terrain.glb"] = M.build_glb(mesh, tex, extras={
        "frame": "glTF Y up: x east, y up, z = -north; origin = dataset window centre; metres",
        "scenario": sc.id, "dataset": inp.dataset_id})

    sc_out = sc.model_copy(update={"start": inp.start_cell, "goal": inp.goal_cell}) if inp.start_cell else sc
    sc_out = Scenario.model_validate(json.loads(sc_out.model_dump_json(by_alias=True)))  # contract check
    files["scenario.json"] = (json.dumps(json.loads(sc_out.model_dump_json(by_alias=True, exclude_none=True)),
                                         indent=2, sort_keys=True) + "\n").encode("utf-8")
    files["ATTRIBUTION.txt"] = ATTRIBUTION.encode("utf-8")
    files["README.txt"] = README.encode("utf-8")

    z = inp.height[np.isfinite(inp.height)]
    meta = {
        "schema": PACKAGE_SCHEMA,
        "scenarioId": sc.id,
        "datasetId": inp.dataset_id,
        "datasetSha256": inp.dataset_sha256,
        "frame": {"description": "local ENU metres (x east, y north, z up), origin at dataset window centre; GLB is Y up",
                  "localProj4": inp.local_proj4, "verticalDatum": inp.vertical_datum,
                  "centerLonLat": [inp.center_lon, inp.center_lat]},
        "terrain": {"rows": h, "cols": w, "resM": inp.res_m, "bbox": [inp.x_west, inp.y_north - h * inp.res_m,
                                                                      inp.x_west + w * inp.res_m, inp.y_north],
                    "zMin": float(z.min()), "zMax": float(z.max())},
        "mesh": {"stepCells": mesh.step_cells, "vertices": len(mesh.positions), "triangles": len(mesh.indices),
                 "vsDem": mesh_error_vs_dem(inp.height, mesh)},
        "gravity": {"value": g, "unit": "m/s2", "provenance": sc.conditions.gravity.provenance,
                    "ref": sc.conditions.gravity.ref},
        "sun": sun,
        "markers": {"start": {"xyz": [start.x, start.y, start.z], "cell": inp.start_cell},
                    "goal": {"xyz": [goal.x, goal.y, goal.z], "cell": inp.goal_cell}, "source": inp.marker_source},
    }
    return files, meta


def finalize_package(files: dict[str, bytes], meta: dict) -> dict[str, bytes]:
    meta = dict(meta)
    meta["files"] = {k: {"sha256": sha256_bytes(v), "bytes": len(v)} for k, v in sorted(files.items())}
    out = dict(files)
    out["manifest.json"] = (json.dumps(meta, indent=2, sort_keys=True) + "\n").encode("utf-8")
    return out


def write_zip(files: dict[str, bytes], zip_path: Path, top: str) -> str:
    """Deterministic ZIP: fixed paths under ``top/``, sorted, fixed timestamps; returns the archive sha256."""
    if not re.fullmatch(r"[a-z0-9_-]+", top):
        raise ValueError("unsafe top folder name")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in sorted(files):
            if name.startswith("/") or ".." in name.split("/") or "\\" in name:
                raise ValueError(f"unsafe path {name!r}")
            zi = zipfile.ZipInfo(f"{top}/{name}", FIXED_TIME)
            zi.compress_type = zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            z.writestr(zi, files[name], compresslevel=9)
    return hashlib.sha256(Path(zip_path).read_bytes()).hexdigest()


# ------------------------------------------------------------------ dataset loading

def load_inputs(data_dir: Path, scenario: Scenario, start_cell, goal_cell, marker_source: str,
                texture_px: int = 2048) -> ExportInputs:
    from marsx.env.terrain import _decode

    data_dir = Path(data_dir)
    mf = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    grids = mf["grids"]
    if scenario.window.dataset_id != mf["datasetId"]:
        raise ValueError("scenario window targets another dataset")
    pg, dg = grids[scenario.window.grid_id], grids["dem"]
    layers = {(lay["kind"], lay["gridId"]): lay for lay in mf["layers"]}
    # window bbox in local metres (plan grid transform: x = a*col + c, y = e*row + f)
    a, _, c0, _, e, f0 = pg["transform"]
    w = scenario.window
    x0, x1 = c0 + w.col0 * a, c0 + (w.col0 + w.cols) * a
    y1, y0 = f0 + w.row0 * e, f0 + (w.row0 + w.rows) * e
    da, _, dc, _, de, df = dg["transform"]
    r_lo, r_hi = round((y1 - df) / de), round((y0 - df) / de)
    c_lo, c_hi = round((x0 - dc) / da), round((x1 - dc) / da)
    dem = _decode(data_dir, layers[("elevation", "dem")])
    crop = np.ascontiguousarray(dem[r_lo:r_hi, c_lo:c_hi])
    x_west, y_north = dc + c_lo * da, df + r_lo * de
    tex = _load_ortho(data_dir, mf, layers.get(("orthoimage", "ortho")), (x0, y0, x1, y1), texture_px)

    def cell_xy(cell):
        r, c = cell
        return c0 + (w.col0 + c + 0.5) * a, f0 + (w.row0 + r + 0.5) * e

    center = mf["crs"]["center"]
    return ExportInputs(
        scenario=scenario, height=crop, res_m=float(da), x_west=x_west, y_north=y_north,
        local_wkt2=mf["crs"]["localWkt2"], local_proj4=mf["crs"]["localProj4"], center_lat=float(center["lat"]),
        center_lon=float(center["lon"]), dataset_id=mf["datasetId"], dataset_sha256=mf.get("contentHash"),
        texture=tex, start_xy=cell_xy(start_cell), goal_xy=cell_xy(goal_cell), start_cell=list(start_cell),
        goal_cell=list(goal_cell), marker_source=marker_source, vertical_datum=mf["crs"].get("verticalDatum", ""))


def _load_ortho(data_dir: Path, mf: dict, layer: dict | None, bbox: tuple[float, float, float, float], px: int):
    if layer is None or not layer.get("tiling"):
        return None
    from PIL import Image

    og = mf["grids"]["ortho"]
    tl = layer["tiling"]
    levels = tl["levels"]
    x0, y0, x1, y1 = bbox
    ext = max(x1 - x0, y1 - y0)
    # level whose pixel count over the window is closest to the requested texture size
    best = min(levels, key=lambda lv: abs(ext / (og["resM"] * og["width"] / lv["size"]) - px))
    n, size = best["tiles"], best["size"]
    img = np.zeros((size, size), np.uint8)
    for ty in range(n):
        for tx in range(n):
            t = np.asarray(Image.open(data_dir / tl["pathTemplate"].format(lod=best["lod"], x=tx, y=ty)).convert("L"))
            img[ty * t.shape[0]:(ty + 1) * t.shape[0], tx * t.shape[1]:(tx + 1) * t.shape[1]] = t
    s = og["resM"] * og["width"] / size  # metres per pixel at this level
    _, _, tc, _, _, tf = og["transform"]
    c_lo, c_hi = round((x0 - tc) / s), round((x1 - tc) / s)
    r_lo, r_hi = round((y1 - tf) / -s), round((y0 - tf) / -s)
    crop = img[max(r_lo, 0):r_hi, max(c_lo, 0):c_hi]
    if max(crop.shape) > px:
        k = px / max(crop.shape)
        crop = np.asarray(Image.fromarray(crop, mode="L").resize((round(crop.shape[1] * k), round(crop.shape[0] * k)),
                                                                   Image.Resampling.LANCZOS))
    return crop
