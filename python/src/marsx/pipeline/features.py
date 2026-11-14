"""Perseverance traverse and waypoints -> GeoJSON clipped to the window.

Geometry stays standard GeoJSON ([lon, lat, elev]); ``properties.local`` carries local
metres ``[x east, y north, z]`` computed from lon/lat with the window projection
(NOT from the feed's own eastings, which use a different eqc latitude of true scale).
``z`` in ``local`` is the DEM height at that point so the rover sits on the rendered terrain.
"""

from __future__ import annotations

from collections.abc import Callable

from .geo import Grid, LocalProjection

Sampler = Callable[[float, float], float]


def _inside(grid: Grid, x: float, y: float) -> bool:
    xmin, ymin, xmax, ymax = grid.bbox
    return xmin <= x <= xmax and ymin <= y <= ymax


def waypoints_geojson(src: dict, proj: LocalProjection, grid: Grid, dem_sampler: Sampler) -> dict:
    out = []
    for f in src["features"]:
        p = f["properties"]
        lon, lat = float(p["lon"]), float(p["lat"])
        x, y = proj.forward(lon, lat)
        if not _inside(grid, x, y):
            continue
        z = float(dem_sampler(x, y))
        col, row = grid.world_to_pixel(x, y)
        out.append(
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat, p.get("elev_geoid")]},
                "properties": {
                    "sol": p.get("sol"),
                    "rmc": p.get("RMC"),
                    "site": p.get("site"),
                    "drive": p.get("drive"),
                    "elevGeoid": p.get("elev_geoid"),
                    "pitch": p.get("pitch"),
                    "roll": p.get("roll"),
                    "yaw": p.get("yaw"),
                    "tilt": p.get("tilt"),
                    "distM": p.get("dist_m"),
                    "distTotalM": p.get("dist_total_m"),
                    "final": p.get("final"),
                    "local": [round(x, 3), round(y, 3), round(z, 3)],
                    "col": round(float(col), 3),
                    "row": round(float(row), 3),
                },
            }
        )
    return {"type": "FeatureCollection", "name": "m20_waypoints_window", "features": out}


def traverse_geojson(src: dict, proj: LocalProjection, grid: Grid, dem_sampler: Sampler) -> dict:
    out = []
    for f in src["features"]:
        coords = f["geometry"]["coordinates"]
        runs: list[list[tuple[list[float], list[float]]]] = []
        cur: list[tuple[list[float], list[float]]] = []
        last = None
        for c in coords:
            key = (c[0], c[1])
            if key == last:  # stationary samples
                continue
            last = key
            x, y = proj.forward(c[0], c[1])
            if _inside(grid, x, y):
                cur.append((list(c), [round(x, 3), round(y, 3), round(float(dem_sampler(x, y)), 3)]))
            elif cur:
                runs.append(cur)
                cur = []
        if cur:
            runs.append(cur)
        for run in runs:
            if len(run) < 2:
                continue
            props = {k: v for k, v in f["properties"].items() if k in ("sol", "length")}
            props["local"] = [loc for _, loc in run]
            out.append(
                {"type": "Feature", "properties": props,
                 "geometry": {"type": "LineString", "coordinates": [g for g, _ in run]}}
            )
    return {"type": "FeatureCollection", "name": "m20_traverse_window", "features": out}
