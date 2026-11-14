"""End-to-end build of a region: ``uv run python -m marsx.pipeline build --region jezero-v1``."""

from __future__ import annotations

import hashlib
import importlib.metadata as md
import io
import json
import os
import platform
import subprocess
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
import rasterio
from PIL import Image

from .. import schemas
from . import derive, encode, features, fetch, tiles, validate
from .geo import Grid, LocalProjection, sample_bilinear
from .reproject import reproject_to_grid

REPO = Path(__file__).resolve().parents[4]
RAW = REPO / "data" / "raw"
PROCESSED = REPO / "data" / "processed"
LOCK = RAW / "sources.lock.json"

HIRISE = "https://planetarymaps.usgs.gov/mosaic/mars2020_trn/HiRISE/"
DEM_URL = HIRISE + "JEZ_hirise_soc_006_DTM_MOLAtopography_DeltaGeoid_1m_Eqc_latTs0_lon0_blend40.tif"
ORTHO_URL = HIRISE + "JEZ_hirise_soc_006_orthoMosaic_25cm_Eqc_latTs0_lon0_first.tif"
CRISM_URL = "https://zenodo.org/records/5575824/files/jezeroFinal.tif"
CRISM_README_URL = "https://zenodo.org/records/5575824/files/Jezero_readme.pdf"
M20 = "https://mars.nasa.gov/mmgis-maps/M20/Layers/json/"

SRC_USGS = dict(
    license="CC0-1.0",
    attribution="USGS Astrogeology Science Center; NASA/JPL-Caltech/University of Arizona (HiRISE)",
)

# CRISM prototype colours from Jezero_readme.pdf (Parente, Itoh, Saranathan 2021), key page 5.
CRISM_KEY = [
    ("Olivine", (255, 0, 0), (153, 0, 0)),
    ("Mg-carbonate", (0, 255, 0), (0, 153, 0)),
    ("Fe/Mg-smectite", (0, 255, 255), (0, 153, 153)),
    ("Olivine + smectite", (255, 128, 114), (153, 77, 68)),
    ("Olivine + smectite + 2.2 um", (128, 128, 0), (77, 77, 0)),
    ("Carbonate + 2.2 um", (255, 215, 0), (153, 129, 0)),
    ("High-Ca pyroxene", (255, 128, 0), (153, 77, 0)),
    ("Low-Ca pyroxene", (218, 165, 32), (130, 99, 19)),
    ("Kaolinite", (139, 69, 19), (83, 41, 11)),
    ("Mg-smectite 2", (0, 0, 255), (0, 0, 153)),
]


@dataclass(frozen=True)
class Region:
    id: str
    lon0: float
    lat0: float
    size_m: int = 2048
    dem_res: float = 1.0
    ortho_factor: int = 4  # ortho pixels per DEM pixel (0.25 m)
    plan_factor: int = 2  # planning cell = 2 m
    crism_res: float = 4.0
    tile: int = 512
    n_az: int = 16
    horizon_max_m: float = 600.0
    webp_quality: int = 82


REGIONS = {
    # Delta-front window: densest stretch of the real traverse inside DEM ∩ ortho ∩ CRISM (see validation report).
    "jezero-v1": Region("jezero-v1", lon0=77.3935, lat0=18.4617),
}


class Timer:
    def __init__(self) -> None:
        self.stages: dict[str, float] = {}

    def stage(self, name: str):
        t = self

        class _Ctx:
            def __enter__(self_inner):
                self_inner.t0 = time.perf_counter()
                print(f"[{name}] ...", flush=True)

            def __exit__(self_inner, *exc):
                t.stages[name] = round(time.perf_counter() - self_inner.t0, 3)
                print(f"[{name}] {t.stages[name]:.2f}s", flush=True)

        return _Ctx()


def grids_for(r: Region) -> dict[str, Grid]:
    half = r.size_m / 2.0
    dem = Grid(-half, half, r.dem_res, int(r.size_m / r.dem_res), int(r.size_m / r.dem_res))
    return {
        "dem": dem,
        "ortho": dem.scaled(r.ortho_factor),
        "plan": Grid(-half, half, r.dem_res * r.plan_factor, dem.width // r.plan_factor, dem.height // r.plan_factor),
        "crism": Grid(-half, half, r.crism_res, int(r.size_m / r.crism_res), int(r.size_m / r.crism_res)),
    }


def _git_commit() -> str | None:
    try:
        out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=REPO, capture_output=True, text=True, timeout=10)
        return out.stdout.strip() or None
    except Exception:
        return None


def _tools() -> dict[str, str]:
    t = {"python": platform.python_version(), "gdal": rasterio.__gdal_version__}
    for p in ("numpy", "numba", "rasterio", "pyproj", "pillow", "scipy", "pydantic"):
        t[p] = md.version(p)
    return t


def _sha_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _window(url: str, grid: Grid, proj: LocalProjection, lock: dict, name: str):
    ent = lock.get("sources", {}).get(name)
    if ent and ent["url"] == url:
        return tuple(ent["window"])
    with rasterio.Env(**fetch.GDAL_ENV), rasterio.open("/vsicurl/" + url) as ds:
        return fetch.window_for_grid(grid, proj, ds.transform, ds.shape)


def _read_lock() -> dict:
    return json.loads(LOCK.read_text(encoding="utf-8")) if LOCK.exists() else {"sources": {}}


def _stats(a: np.ndarray) -> schemas.Stats:
    v = a[~np.isnan(a)] if a.dtype.kind == "f" else a.ravel()
    return schemas.Stats(
        min=float(v.min()) if v.size else None,
        max=float(v.max()) if v.size else None,
        mean=float(v.mean()) if v.size else None,
        valid_fraction=float(v.size / a.size),
    )


def classify_crism(rgb: np.ndarray) -> tuple[list[dict], dict]:
    """Count pixels per CRISM prototype colour (exact +-6 per channel), plus unclassified shades."""
    px = rgb.reshape(-1, 3).astype(int)
    white = (px == 255).all(axis=1)
    black = (px == 0).all(axis=1)
    legend, claimed = [], np.zeros(len(px), bool)
    for name, hi, med in CRISM_KEY:
        for tag, col in (("high confidence", hi), ("medium confidence", med)):
            m = (np.abs(px - np.array(col)) <= 6).all(axis=1) & ~claimed & ~white & ~black
            claimed |= m
            legend.append({"color": "#%02x%02x%02x" % col, "label": f"{name} ({tag})", "pixels": int(m.sum())})
    other = ~claimed & ~white & ~black
    summary = {
        "noCoverage": int(white.sum()),
        "notIdentified": int(black.sum()),
        "prototypeMatches": int(claimed.sum()),
        "intermediateShades": int(other.sum()),
        "total": int(len(px)),
    }
    return [e for e in legend if e["pixels"] > 0], summary


def build(region: Region, workers: int | None = None, bench: bool = True, refresh: bool = False) -> Path:
    workers = workers or min(os.cpu_count() or 4, 16)
    tm = Timer()
    par: dict[str, dict] = {}
    out = PROCESSED / region.id
    out.mkdir(parents=True, exist_ok=True)
    proj = LocalProjection(region.lon0, region.lat0)
    G = grids_for(region)
    lock0 = _read_lock()

    # ------------------------------------------------------------------ ingest
    with tm.stage("ingest"):
        dem_win = _window(DEM_URL, G["dem"], proj, lock0, f"{region.id}_dem")
        ortho_win = _window(ORTHO_URL, G["ortho"], proj, lock0, f"{region.id}_ortho")
        dem_path = fetch.fetch_cached(
            DEM_URL, dem_win, RAW, f"{region.id}_dem", LOCK, workers=workers, **SRC_USGS,
            title="Mars 2020 TRN HiRISE DTM mosaic (MOLA topography, DeltaGeoid), 1 m", doi="10.5066/P9REJ9JN")
        ortho_path = fetch.fetch_cached(
            ORTHO_URL, ortho_win, RAW, f"{region.id}_ortho", LOCK, workers=workers, **SRC_USGS,
            title="Mars 2020 TRN HiRISE orthorectified image mosaic (RED), 0.25 m", doi="10.5066/P9QJDP48")
        crism_path = fetch.fetch_file(
            CRISM_URL, RAW / "crism", "crism", "jezeroFinal.tif", LOCK, refresh=refresh,
            title="Jezero crater CRISM mineral map (Parente, Itoh, Saranathan)", doi="10.5281/zenodo.5575824",
            license="CC-BY-4.0", attribution="M. Parente, Y. Itoh, A. M. Saranathan (UMass Amherst), Zenodo 5575824")
        fetch.fetch_file(
            CRISM_README_URL, RAW / "crism", "crism_readme", "Jezero_readme.pdf", LOCK, refresh=refresh,
            title="CRISM Jezero map README (colour key)", license="CC-BY-4.0", attribution="Parente et al.")
        trav_path = fetch.fetch_file(
            M20 + "M20_traverse.json", RAW / "m20", "m20_traverse", "M20_traverse.json", LOCK, refresh=refresh,
            title="Mars 2020 Perseverance traverse (MMGIS)", license="NASA public data (no licence text published)",
            attribution="NASA/JPL-Caltech, Mars 2020 MMGIS")
        wp_path = fetch.fetch_file(
            M20 + "M20_waypoints.json", RAW / "m20", "m20_waypoints", "M20_waypoints.json", LOCK, refresh=refresh,
            title="Mars 2020 Perseverance waypoints (MMGIS)", license="NASA public data (no licence text published)",
            attribution="NASA/JPL-Caltech, Mars 2020 MMGIS")
    lock = _read_lock()["sources"]

    # --------------------------------------------------------------- reproject
    with tm.stage("reproject"):
        with rasterio.open(dem_path) as ds:
            dem = reproject_to_grid(ds.read(1), ds.transform, ds.crs, G["dem"], proj, "bilinear",
                                    src_nodata=ds.nodata, threads=workers)
        with rasterio.open(ortho_path) as ds:
            ortho = reproject_to_grid(ds.read(1), ds.transform, ds.crs, G["ortho"], proj, "bilinear",
                                      src_nodata=ds.nodata, dtype="uint8", threads=workers)
        with rasterio.open(crism_path) as ds:
            crism = np.stack(
                [reproject_to_grid(ds.read(b), ds.transform, ds.crs, G["crism"], proj, "nearest", dtype="uint8",
                                   threads=workers, declare_nodata=False) for b in (1, 2, 3)], axis=-1)
        # outside the CRISM mosaic every band is 0 (black); mark it as "no coverage" like the white fill
        with rasterio.open(crism_path) as ds:
            inside = reproject_to_grid(np.ones((ds.height, ds.width), np.uint8), ds.transform, ds.crs, G["crism"],
                                       proj, "nearest", dtype="uint8", threads=workers, declare_nodata=False) == 1
        crism[~inside] = 255
    if np.isnan(dem).all():
        raise RuntimeError("DEM window is empty after reprojection")

    # ------------------------------------------------------------------ derive
    with tm.stage("derive"):
        slope = derive.slope_deg(dem, region.dem_res)
        rough = derive.roughness(dem, region.dem_res)
        step = derive.step_height(dem)
        f = region.plan_factor
        plan_h = derive.meanpool(dem, f)
        plan_slope, plan_step, plan_rough = (derive.maxpool(a, f) for a in (slope, step, rough))
        hazard = derive.hazard_u8(plan_slope, plan_step, plan_rough)
        normals = derive.normal_map(dem, region.dem_res)
        horizon = derive.horizon_maps(plan_h, region.dem_res * f, region.n_az, region.horizon_max_m)

    if bench:
        with tm.stage("bench-derive"):
            # kernels are JIT-compiled and warm: time parallel vs serial on the real data
            def timed(fn, **kw):
                t = time.perf_counter()
                fn(**kw)
                return time.perf_counter() - t

            for name, fn, kw in [
                ("slope+roughness+step 2048^2",
                 lambda parallel: (derive.slope_deg(dem, 1.0, parallel), derive.roughness(dem, 1.0, parallel=parallel),
                                   derive.step_height(dem, parallel)), {}),
                ("horizon 16 az 1024^2",
                 lambda parallel: derive.horizon_maps(plan_h, 2.0, region.n_az, region.horizon_max_m, parallel), {}),
            ]:
                s = min(timed(fn, parallel=False) for _ in range(2))
                p = min(timed(fn, parallel=True) for _ in range(2))
                par[name] = {"serialS": round(s, 3), "parallelS": round(p, 3), "speedup": round(s / p, 2),
                             "threads": int(__import__("numba").get_num_threads())}

    # ------------------------------------------------------------------ write
    layers: list[schemas.Layer] = []
    dem_lock, ortho_lock = lock[f"{region.id}_dem"], lock[f"{region.id}_ortho"]

    def src(entry: dict, derived_from: bool = False) -> schemas.Source:
        title = entry["title"] + (" -> derived by the marsx pipeline" if derived_from else "")
        return schemas.Source(
            title=title, doi=entry.get("doi"), url=entry["url"], license=entry["license"],
            attribution=entry["attribution"], retrieved_at=entry["retrievedAt"],
            raw_sha256=entry.get("dataSha256") or entry["sha256"])

    def write_raw(rel: str, data: bytes) -> tuple[str, int]:
        (out / rel).write_bytes(data)
        return _sha_bytes(data), len(data)

    with tm.stage("encode"):
        # alignment first: it is attached to the layers it validates
        ortho_1m = ortho.reshape(G["dem"].height, region.ortho_factor, G["dem"].width, region.ortho_factor)
        ortho_1m = ortho_1m.astype(np.float32).mean(axis=(1, 3))
        align = validate.alignment_report(ortho_1m, dem, region.dem_res)
        cov_dem = float(1 - np.isnan(dem).mean())
        cov_ortho = float((ortho > 0).mean())

        q, enc_h = encode.height_to_u16(dem)
        sha, nb = write_raw("height.u16", encode.to_le_bytes(q))
        layers.append(schemas.Layer(
            id="height", kind="elevation", grid_id="dem", path="height.u16", sha256=sha, bytes=nb,
            shape=[G["dem"].height, G["dem"].width], axes="row,col",
            encoding=schemas.Encoding(**enc_h, description="z[m] = q * scale + offset; vertical datum MOLA areoid (DeltaGeoid)"),
            stats=_stats(dem), origin="derived", source=src(dem_lock),
            validation=schemas.LayerValidation(coverage=cov_dem, align_rmse_m=align["rmseM"], method=align["method"])))

        def u8_layer(id_, kind, grid_id, arr, scale, desc, notes=None, nodata=255):
            sha, nb = write_raw(f"{id_}.u8", np.ascontiguousarray(arr, np.uint8).tobytes())
            decoded = np.where(arr == nodata, np.nan, arr.astype(np.float32) * scale)
            layers.append(schemas.Layer(
                id=id_, kind=kind, grid_id=grid_id, path=f"{id_}.u8", sha256=sha, bytes=nb, shape=list(arr.shape),
                axes="row,col", encoding=schemas.Encoding(dtype="uint8", endian="n/a", scale=scale, offset=0.0,
                                                          nodata=nodata, description=desc),
                stats=_stats(decoded), origin="derived", source=src(dem_lock, True), notes=notes,
                validation=schemas.LayerValidation(coverage=cov_dem, method="derived from the validated DEM")))

        a = derive.ANGLE_SCALE
        u8_layer("slope", "slope", "dem", derive.angle_to_u8(slope), a, "slope in degrees = q * 0.5 (Horn, 3x3)")
        u8_layer("roughness", "roughness", "dem", np.where(np.isnan(rough), 255, np.clip(np.rint(rough / 0.01), 0, 254)).astype(np.uint8),
                 0.01, "RMS residual from best-fit plane in a 5 m window, metres = q * 0.01 (clipped at 2.54 m)")
        u8_layer("step", "step", "dem", np.where(np.isnan(step), 255, np.clip(np.rint(step / 0.01), 0, 254)).astype(np.uint8),
                 0.01, "ledge height (max |z(+d)+z(-d)-2z|, 4 directions), metres = q * 0.01 (clipped at 2.54 m)")
        qp, enc_p = encode.height_to_u16(plan_h)
        sha, nb = write_raw("plan_height.u16", encode.to_le_bytes(qp))
        layers.append(schemas.Layer(
            id="plan_height", kind="elevation", grid_id="plan", path="plan_height.u16", sha256=sha, bytes=nb,
            shape=list(plan_h.shape), axes="row,col", encoding=schemas.Encoding(**enc_p, description="2x2 mean of the 1 m DEM"),
            stats=_stats(plan_h), origin="derived", source=src(dem_lock, True),
            validation=schemas.LayerValidation(coverage=cov_dem, method="derived from the validated DEM")))
        u8_layer("plan_slope", "slope", "plan", derive.angle_to_u8(plan_slope), a,
                 "degrees = q * 0.5; CONSERVATIVE: max of the four 1 m slopes in each 2 m cell",
                 notes="max-pool aggregation (worst case) so a planner never under-estimates a steep cell")
        u8_layer("plan_step", "step", "plan",
                 np.where(np.isnan(plan_step), 255, np.clip(np.rint(plan_step / 0.01), 0, 254)).astype(np.uint8), 0.01,
                 "metres = q * 0.01; max-pool of the 1 m ledge heights")
        u8_layer("plan_roughness", "roughness", "plan",
                 np.where(np.isnan(plan_rough), 255, np.clip(np.rint(plan_rough / 0.01), 0, 254)).astype(np.uint8), 0.01,
                 "metres = q * 0.01; max-pool of the 1 m roughness")
        sha, nb = write_raw("plan_hazard.u8", hazard.tobytes())
        layers.append(schemas.Layer(
            id="plan_hazard", kind="hazard", grid_id="plan", path="plan_hazard.u8", sha256=sha, bytes=nb,
            shape=list(hazard.shape), axes="row,col",
            encoding=schemas.Encoding(dtype="uint8", endian="n/a", scale=1.0 / 254.0, offset=0.0, nodata=255,
                                      description=(f"0 = benign .. 254 = at/above a limit (slope {derive.SLOPE_LIMIT_DEG} deg, "
                                                   f"step {derive.STEP_LIMIT_M} m, roughness {derive.ROUGH_LIMIT_M} m); worst term wins; "
                                                   "limits are engineering assumptions, not official Mars 2020 constraints")),
            stats=_stats(np.where(hazard == 255, np.nan, hazard / 254.0)), origin="derived", source=src(dem_lock, True),
            validation=schemas.LayerValidation(coverage=cov_dem, method="derived from the validated DEM")))
        sha, nb = write_raw("horizon.u8", horizon.tobytes())
        layers.append(schemas.Layer(
            id="horizon", kind="horizon", grid_id="plan", path="horizon.u8", sha256=sha, bytes=nb,
            shape=list(horizon.shape), axes="azimuth,row,col",
            encoding=schemas.Encoding(dtype="uint8", endian="n/a", scale=derive.ANGLE_SCALE, offset=0.0, nodata=255,
                                      description=(f"horizon elevation angle (deg) = q * 0.5; azimuth index k = k*{360 // region.n_az} deg "
                                                   f"clockwise from north; rays up to {region.horizon_max_m:g} m, clamped at 0, "
                                                   "rays stop at the window edge")),
            stats=_stats(np.where(horizon == 255, np.nan, horizon * derive.ANGLE_SCALE)), origin="derived",
            source=src(dem_lock, True),
            validation=schemas.LayerValidation(coverage=cov_dem, method="derived from the validated DEM")))

        buf = io.BytesIO()
        Image.fromarray(normals, mode="RGB").save(buf, format="WEBP", lossless=True, method=4)
        sha, nb = write_raw("normals.webp", buf.getvalue())
        layers.append(schemas.Layer(
            id="normals", kind="normal", grid_id="dem", path="normals.webp", sha256=sha, bytes=nb,
            shape=[G["dem"].height, G["dem"].width, 3], axes="row,col,channel",
            encoding=schemas.Encoding(dtype="image/webp", endian="n/a", description="lossless WebP, RGB = (east, north, up) mapped [-1,1] -> [0,255]; tangent space, y north"),
            stats=None, origin="derived", source=src(dem_lock, True),
            validation=schemas.LayerValidation(coverage=cov_dem, method="derived from the validated DEM")))

        # ortho pyramid (parallel encode) + serial benchmark on the same 32 tiles
        pyr = tiles.write_pyramid(ortho, out, tile=region.tile, quality=region.webp_quality, workers=workers)
        if bench:
            sample = [np.ascontiguousarray(ortho[(i // 16) * region.tile:(i // 16 + 1) * region.tile,
                                                 (i % 16) * region.tile:(i % 16 + 1) * region.tile]) for i in range(32)]
            t = time.perf_counter()
            for s_ in sample:
                tiles.encode_tile((s_, region.webp_quality))
            ser = time.perf_counter() - t
            from concurrent.futures import ProcessPoolExecutor

            with ProcessPoolExecutor(max_workers=workers) as ex:
                list(ex.map(tiles.encode_tile, [(s_, 1) for s_ in sample[:workers]]))  # warm the pool
                t = time.perf_counter()
                list(ex.map(tiles.encode_tile, [(s_, region.webp_quality) for s_ in sample], chunksize=1))
                parl = time.perf_counter() - t
            par["webp tiles (32 x 512^2)"] = {"serialS": round(ser, 3), "parallelS": round(parl, 3),
                                              "speedup": round(ser / parl, 2), "processes": workers}
        h = hashlib.sha256()
        for p in sorted((out / "ortho").rglob("*.webp")):
            h.update(p.read_bytes())
        layers.append(schemas.Layer(
            id="ortho", kind="orthoimage", grid_id="ortho", path="ortho", sha256=h.hexdigest(), bytes=pyr["bytes"],
            shape=[G["ortho"].height, G["ortho"].width], axes="row,col",
            encoding=schemas.Encoding(dtype="image/webp", endian="n/a",
                                      description="8-bit grayscale (HiRISE RED band) stored as WebP, quality %d; 0 = no data" % region.webp_quality),
            stats=None, tiling=schemas.Tiling(tile_size=pyr["tileSize"], format="webp", levels=pyr["levels"],
                                              path_template=pyr["pathTemplate"]),
            notes="monochrome: HiRISE RED band; tint in the client", origin="observed", source=src(ortho_lock),
            validation=schemas.LayerValidation(coverage=cov_ortho, align_rmse_m=align["rmseM"], method=align["method"])))

        # CRISM
        legend, csum = classify_crism(crism)
        detected = (~(crism == 255).all(-1)) & (~(crism == 0).all(-1))
        rgba = np.dstack([crism, (detected * 255).astype(np.uint8)])
        buf = io.BytesIO()
        Image.fromarray(rgba, mode="RGBA").save(buf, format="PNG", optimize=True)
        sha, nb = write_raw("crism.png", buf.getvalue())
        covered = 1 - csum["noCoverage"] / csum["total"]
        crism_lock = lock["crism"]
        layers.append(schemas.Layer(
            id="crism", kind="mineral", grid_id="crism", path="crism.png", sha256=sha, bytes=nb,
            shape=[G["crism"].height, G["crism"].width, 4], axes="row,col,channel",
            encoding=schemas.Encoding(dtype="image/png", endian="n/a", description=(
                "RGBA; RGB = CRISM prototype colour (bold = high confidence, subdued = medium); alpha 0 where not identified or "
                "outside CRISM coverage; reprojected with NEAREST from 36 m to 4 m so classes are never blended")),
            legend=[schemas.LegendItem(**e) for e in legend], origin="derived",
            notes="machine-learning mineral map from CRISM (Saranathan & Parente 2021), preliminary attributions; not the raw PDS MTRDR",
            source=schemas.Source(title=crism_lock["title"], doi=crism_lock["doi"], url=crism_lock["url"],
                                  license=crism_lock["license"], attribution=crism_lock["attribution"],
                                  retrieved_at=crism_lock["retrievedAt"], raw_sha256=crism_lock["sha256"]),
            validation=schemas.LayerValidation(coverage=float(covered), method="fraction of the window inside CRISM scenes (non-white fill)")))

        # vector layers
        trav = json.loads(trav_path.read_text(encoding="utf-8"))
        wps = json.loads(wp_path.read_text(encoding="utf-8"))
        sampler = lambda x, y: sample_bilinear(np.nan_to_num(dem, nan=0.0), G["dem"], x, y)  # noqa: E731
        trav_fc = features.traverse_geojson(trav, proj, G["dem"], sampler)
        wp_fc = features.waypoints_geojson(wps, proj, G["dem"], sampler)
        for fn, fc, key, lid in (("traverse.geojson", trav_fc, "m20_traverse", "traverse"),
                                 ("waypoints.geojson", wp_fc, "m20_waypoints", "waypoints")):
            sha, nb = write_raw(fn, json.dumps(fc, separators=(",", ":")).encode())
            e = lock[key]
            layers.append(schemas.Layer(
                id=lid, kind="vector", grid_id="dem", path=fn, sha256=sha, bytes=nb,
                encoding=schemas.Encoding(dtype="application/geo+json", endian="n/a",
                                          description="GeoJSON; geometry [lon, lat, elev]; properties.local = [x east, y north, z DEM] local metres"),
                origin="observed", source=schemas.Source(title=e["title"], url=e["url"], license=e["license"],
                                                         attribution=e["attribution"], retrieved_at=e["retrievedAt"],
                                                         raw_sha256=e["sha256"]),
                validation=None))

    # -------------------------------------------------------------- validation
    with tm.stage("validate"):
        report = build_validation(region, G, proj, dem, slope, wp_fc, trav_fc, align, cov_dem, cov_ortho, covered, csum, legend)
        (out / "validation_report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")

    # ---------------------------------------------------------------- manifest
    with tm.stage("manifest"):
        params = {"region": asdict(region), "hazard": [derive.SLOPE_LIMIT_DEG, derive.STEP_LIMIT_M, derive.ROUGH_LIMIT_M]}
        params_hash = _sha_bytes(json.dumps(params, sort_keys=True).encode())
        content_hash = _sha_bytes((params_hash + "".join(f"{l.path}:{l.sha256}\n" for l in sorted(layers, key=lambda x: x.id))).encode())
        # the layer sha256 of the ortho pyramid hashes every tile in sorted order (deterministic)
        manifest = schemas.Manifest(
            schema_version="1.0.0", dataset_id=region.id, version="1.0.0", content_hash=content_hash,
            generated_at=datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
            pipeline=schemas.Pipeline(git_commit=_git_commit(), params_hash=params_hash, tools=_tools()),
            crs=schemas.Crs(
                geographic="IAU_2015:49900", source_proj4=fetch.SRC_PROJ4, local_proj4=proj.proj4,
                local_wkt2=proj.crs.to_wkt(), vertical_datum="MOLA areoid (DeltaGeoid); elevations in metres",
                center=schemas.Center(lon=region.lon0, lat=region.lat0),
                local_origin="window centre = (0, 0); x east, y north, z up (metres); equirectangular on a sphere R=3396190 m with lat_ts = centre latitude (true E-W scale)"),
            grid=_grid_model("dem", G["dem"]), grids={k: _grid_model(k, g) for k, g in G.items()},
            bbox_lon_lat=_lonlat_bbox(G["dem"], proj), layers=layers,
            extras={"disclaimer": "Not affiliated with or endorsed by NASA, JPL or Caltech. Data credits: USGS Astrogeology, NASA/JPL-Caltech/University of Arizona, CRISM team (Parente et al.).",
                    "hazardLimits": "engineering assumptions, not official rover limits"})
        (out / "manifest.json").write_text(manifest.model_dump_json(by_alias=True, indent=2), encoding="utf-8")
        schemas.export_schemas(REPO / "packages" / "schemas")

    timings = {"stagesSeconds": tm.stages, "totalSeconds": round(sum(tm.stages.values()), 2), "workers": workers,
               "cpuCount": os.cpu_count(), "parallelism": par,
               "note": "bench-derive and the tiles benchmark are extra runs used only to measure the speed-up"}
    (out / "timings.json").write_text(json.dumps(timings, indent=2), encoding="utf-8")
    print(json.dumps(timings, indent=2))
    return out


def _grid_model(id_: str, g: Grid) -> schemas.Grid:
    return schemas.Grid(id=id_, width=g.width, height=g.height, res_m=g.res, transform=list(g.transform), bbox=list(g.bbox))


def _lonlat_bbox(g: Grid, proj: LocalProjection) -> list[float]:
    xmin, ymin, xmax, ymax = g.bbox
    xs = [xmin, xmax, xmin, xmax]
    ys = [ymin, ymin, ymax, ymax]
    lon, lat = proj.inverse(xs, ys)
    return [float(min(lon)), float(min(lat)), float(max(lon)), float(max(lat))]


def build_validation(region, G, proj, dem, slope, wp_fc, trav_fc, align, cov_dem, cov_ortho, covered, csum, legend) -> dict:
    import math

    from scipy.ndimage import gaussian_filter

    wps = wp_fc["features"]
    xy = np.array([w["properties"]["local"][:2] for w in wps]) if wps else np.zeros((0, 2))
    s_pt = np.array([sample_bilinear(np.nan_to_num(slope, nan=0.0), G["dem"], x, y) for x, y in xy]) if len(xy) else np.zeros(0)
    dem_s = gaussian_filter(np.nan_to_num(dem, nan=float(np.nanmean(dem))), 1.5)
    from . import derive as dv

    gx, gy = dv.gradient(dem_s.astype(np.float32), region.dem_res)
    gxp = np.array([sample_bilinear(gx, G["dem"], x, y) for x, y in xy]) if len(xy) else np.zeros(0)
    gyp = np.array([sample_bilinear(gy, G["dem"], x, y) for x, y in xy]) if len(xy) else np.zeros(0)
    s_smooth = np.degrees(np.arctan(np.hypot(gxp, gyp)))
    P = lambda k: np.array([np.nan if w["properties"][k] is None else float(w["properties"][k]) for w in wps])  # noqa: E731
    tilt, pitch, roll, yaw, elev = P("tilt"), P("pitch"), P("roll"), P("yaw"), P("elevGeoid")
    pp, rr = [], []
    for a, b, yw in zip(gxp, gyp, yaw, strict=False):
        p_, r_ = validate.predict_pitch_roll(float(a), float(b), float(yw))
        pp.append(p_)
        rr.append(r_)
    pp, rr = np.array(pp), np.array(rr)
    z_dem = np.array([w["properties"]["local"][2] for w in wps])
    length_m = 0.0
    for f in trav_fc["features"]:
        loc = np.array(f["properties"]["local"])
        length_m += float(np.hypot(*np.diff(loc[:, :2], axis=0).T).sum())
    sols = [w["properties"]["sol"] for w in wps]
    return {
        "datasetId": region.id,
        "generatedAt": datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "window": {"centerLon": region.lon0, "centerLat": region.lat0, "sizeM": region.size_m,
                   "why": "densest stretch of the real Perseverance traverse (delta front) inside DEM ∩ orthoimage ∩ CRISM"},
        "alignmentDemOrtho": align,
        "coverage": {"dem": cov_dem, "ortho": cov_ortho,
                     "crismCoveredFraction": covered,
                     "crismDetectedFraction": 1 - (csum["noCoverage"] + csum["notIdentified"]) / csum["total"],
                     "crismPixelCounts": csum, "crismLegend": legend,
                     "traverseLengthM": length_m, "waypoints": len(wps),
                     "solRange": [min(sols), max(sols)] if sols else None},
        "demHeightAtWaypoints_vs_published_elevGeoid": validate.agreement_stats(z_dem, elev),
        "slopeVsRoverTilt": {
            "note": "DEM slope (Horn, 1 m) vs rover tilt at end-of-drive waypoints; the DEM is a 1 m orbital product and the rover "
                    "wheelbase is ~2.7 m, so agreement is statistical, not per-point",
            "tiltDeg_vs_demSlope1m": validate.agreement_stats(s_pt, tilt),
            "tiltDeg_vs_demSlopeSmoothed1p5m": validate.agreement_stats(s_smooth, tilt),
            "pitchDeg_vs_predicted(yaw=heading cw from north, assumption)": validate.agreement_stats(pp, pitch),
            "absRollDeg_vs_predicted": validate.agreement_stats(np.abs(rr), np.abs(roll)),
            "rollSigned_vs_predicted(roll>0 = right side down)": validate.agreement_stats(rr, roll),
            "tiltRobustMedianDeg": float(np.nanmedian(tilt)) if len(tilt) else None,
            "demSlopeMedianDeg": float(np.median(s_pt)) if len(s_pt) else None,
        },
        "notes": [
            "Ortho is the HiRISE RED band (monochrome); DEM and ortho come from the same USGS mosaic (same georeferenced grid, 4x).",
            "CRISM layer is a machine-learning mineral map with preliminary attributions, not raw PDS data.",
            "Hazard limits are engineering assumptions, not official rover constraints.",
        ],
    }
