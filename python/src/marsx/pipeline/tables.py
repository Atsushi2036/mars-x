"""Offline condition tables published next to the terrain (the web only reads them).

* ``sky_view_u8``   - sky view factor per 2 m cell from the 16 horizon maps.
* ``thermal_inertia_to_grid`` - THEMIS thermal inertia (100 m/px) resampled to the planning
  grid plus the slip material class (``marsx.conditions.slip`` thresholds).
* ``sun_table``     - Mars24 sun azimuth / elevation / distance per minute for a sol.
* ``owlt_table``    - hourly Earth-Mars one-way light time and link availability.

Everything is deterministic and uses the same functions as the real-time conditions engine,
so tables and live values cannot drift apart.
"""

from __future__ import annotations

from datetime import UTC, datetime

import numpy as np

from marsx.conditions import comms, mars24, slip

from . import derive
from .geo import Grid, LocalProjection
from .reproject import reproject_to_grid

SVF_ONE = 254  # u8 scale: sky view factor = q / 254, nodata 255
PERSEVERANCE_LANDING_UTC = datetime(2021, 2, 18, 20, 55, tzinfo=UTC)  # approx.; defines which sol contains landing = sol 0


def sky_view_u8(horizon: np.ndarray) -> np.ndarray:
    """mean over azimuths of cos^2(horizon elevation), as u8 (q/254); nodata 255."""
    ang = np.radians(derive.u8_to_angle(horizon))  # NaN where nodata
    svf = np.mean(np.cos(ang) ** 2, axis=0)
    out = np.clip(np.rint(np.nan_to_num(svf, nan=0.0) * SVF_ONE), 0, SVF_ONE).astype(np.uint8)
    out[np.isnan(svf)] = derive.U8_NODATA
    return out


def thermal_inertia_to_grid(arr, src_transform, src_crs, grid: Grid, proj: LocalProjection, nodata: float | None = 0.0):
    """Bilinear resample of thermal inertia onto ``grid`` and classify (0 loose, 1 mixed, 2 rocky, 255 unknown)."""
    ti = reproject_to_grid(np.asarray(arr, np.float32), src_transform, src_crs, grid, proj, "bilinear", src_nodata=nodata)
    return ti, slip.classify_thermal_inertia(ti)


def sun_table(start_ms: int, n: int, step_s: float, lat_deg: float, lon_east_deg: float) -> np.ndarray:
    """float32 [n, 3] = (azimuth deg cw from north, elevation deg, Mars-Sun distance AU)."""
    ms = int(start_ms) + np.rint(np.arange(n) * step_s * 1000.0).astype(np.int64)
    st = mars24.mars_solar_state(ms, lat_deg, lon_east_deg)
    return np.stack([np.asarray(st.azimuth_deg), np.asarray(st.elevation_deg), np.asarray(st.r_au)], axis=-1).astype(np.float32)


def perseverance_sol_start_ms(sol: int, lon_east_deg: float) -> int:
    """UTC ms of local mean solar midnight starting Perseverance sol ``sol`` (landing sol = 0)."""
    landing_ms = int(PERSEVERANCE_LANDING_UTC.timestamp() * 1000)
    day0 = np.floor(float(mars24.mars_sol_date(landing_ms)) + lon_east_deg / 360.0)
    return int(mars24.unix_ms_from_msd(day0 + sol - lon_east_deg / 360.0))


def owlt_table(start_ms: int, end_ms: int, step_h: float = 1.0) -> np.ndarray:
    """float32 [n, 2] = (one-way light time s, link available 1/0) every ``step_h`` hours."""
    ms = np.arange(int(start_ms), int(end_ms), int(step_h * 3_600_000), dtype=np.int64)
    return np.stack([np.asarray(comms.owlt_s(ms)), np.asarray(comms.link_available(ms), dtype=float)], axis=-1).astype(np.float32)


# ------------------------------------------------------------------ in-place dataset update
SUN_TABLE_ROWS = 1481  # one sol (1479.7 min) + 1 sample, every minute
HIRISE_CREDIT_OLD = "NASA/JPL-Caltech/University of Arizona"
HIRISE_CREDIT = "NASA/JPL/University of Arizona"


def utc_ms_iso(ms: int) -> str:
    """ISO-8601 UTC with millisecond precision (tables are exact to the millisecond)."""
    return datetime.fromtimestamp(ms / 1000, UTC).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def sun_layer(out_dir, sol: int, lat_deg: float, lon_east_deg: float, source):
    """Write ``sun/sol-<sol>.f32`` and return its manifest layer."""
    import hashlib
    from pathlib import Path

    from marsx import schemas

    from . import encode

    start = perseverance_sol_start_ms(sol, lon_east_deg)
    tab = sun_table(start, SUN_TABLE_ROWS, 60.0, lat_deg, lon_east_deg)
    raw = encode.to_le_bytes(tab)
    rel = f"sun/sol-{sol}.f32"
    (Path(out_dir) / "sun").mkdir(parents=True, exist_ok=True)
    (Path(out_dir) / rel).write_bytes(raw)
    return schemas.Layer(
        id=f"sun_sol_{sol}", kind="sun_table", grid_id=None, path=rel, sha256=hashlib.sha256(raw).hexdigest(),
        bytes=len(raw), shape=list(tab.shape), axes="minute,[azimuth_deg_cw_from_north, elevation_deg, mars_sun_au]",
        encoding=schemas.Encoding(dtype="float32", endian="little",
                                  description="Mars24 sun position at the window centre, every 60 s from local mean solar midnight"),
        table=schemas.TableInfo(columns=["azimuth_deg", "elevation_deg", "r_au"], start_utc=utc_ms_iso(start), step_s=60.0,
                                rows=int(tab.shape[0]), lat=lat_deg, lon_east=lon_east_deg),
        origin="derived", source=source)


def content_hash(params_hash: str, layers) -> str:
    import hashlib

    return hashlib.sha256((params_hash + "".join(f"{l.path}:{l.sha256}\n" for l in sorted(layers, key=lambda x: x.id)))
                          .encode()).hexdigest()


def update_dataset(data_dir, sun_sols=(148, 149, 313, 314, 315)) -> list[str]:
    """Add/refresh sun tables in an existing processed dataset without a full rebuild.

    Also emits table start times with millisecond precision, fixes the HiRISE credit and recomputes contentHash
    (same formula as ``marsx.pipeline.build``). Idempotent. Returns the ids of the sun layers written.
    """
    from pathlib import Path

    from marsx import schemas

    d = Path(data_dir)
    m = schemas.Manifest.model_validate_json((d / "manifest.json").read_text(encoding="utf-8"))
    lat, lon = m.crs.center.lat, m.crs.center.lon
    old_sun = [l for l in m.layers if l.kind == "sun_table"]
    if old_sun:
        source = old_sun[0].source
    else:
        source = schemas.Source(
            title="Mars24 sun position algorithm (Allison & McEwen 2000), marsx.conditions.mars24",
            url="https://www.giss.nasa.gov/tools/mars24/help/algorithm.html", license="algorithm (no data licence)",
            attribution="Allison & McEwen 2000, Planet. Space Sci. 48", retrieved_at=utc_ms_iso(0))
    wanted = sorted(set(sun_sols) | {int(l.id.removeprefix("sun_sol_")) for l in old_sun})
    new_sun = [sun_layer(d, sol, lat, lon, source) for sol in wanted]
    others = [l for l in m.layers if l.kind != "sun_table"]
    for l in others:  # credit fix in every layer source
        if HIRISE_CREDIT_OLD in l.source.attribution:
            l.source = l.source.model_copy(update={"attribution": l.source.attribution.replace(HIRISE_CREDIT_OLD, HIRISE_CREDIT)})
    layers = others + new_sun
    extras = {k: v.replace(HIRISE_CREDIT_OLD, HIRISE_CREDIT) for k, v in (m.extras or {}).items()}
    m = m.model_copy(update={"layers": layers, "extras": extras or None,
                             "content_hash": content_hash(m.pipeline.params_hash, layers)})
    m = schemas.Manifest.model_validate(m.model_dump())  # re-run validators
    (d / "manifest.json").write_text(m.model_dump_json(by_alias=True, indent=2), encoding="utf-8")
    return [l.id for l in new_sun]
