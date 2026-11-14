import math

import pytest

from marsx.pipeline import features
from marsx.pipeline.geo import MARS_RADIUS_M, Grid, LocalProjection

LON0, LAT0 = 77.39, 18.46
M_PER_DEG_LON = MARS_RADIUS_M * math.radians(1.0) * math.cos(math.radians(LAT0))
M_PER_DEG_LAT = MARS_RADIUS_M * math.radians(1.0)


def lonlat(dx_m: float, dy_m: float):
    return (LON0 + dx_m / M_PER_DEG_LON, LAT0 + dy_m / M_PER_DEG_LAT)


@pytest.fixture()
def setup():
    return LocalProjection(LON0, LAT0), Grid(-1024.0, 1024.0, 1.0, 2048, 2048)


def wp(sol, lon, lat, **extra):
    props = {"sol": sol, "RMC": f"1_{sol}", "site": 1, "drive": sol, "lon": lon, "lat": lat,
             "easting": 999.0, "northing": 999.0,  # deliberately wrong: must be ignored
             "elev_geoid": -2500.0, "pitch": 1.0, "roll": -2.0, "yaw": 90.0, "tilt": 2.2,
             "dist_m": 5.0, "dist_total_m": 50.0, "final": "y", "images": [{"name": "big"}]}
    props.update(extra)
    return {"type": "Feature", "properties": props, "geometry": {"type": "Point", "coordinates": [lon, lat, -2500.0]}}


def test_waypoints_are_projected_from_lonlat_not_from_feed_eastings(setup):
    proj, grid = setup
    lon, lat = lonlat(300.0, -200.0)
    fc = features.waypoints_geojson({"features": [wp(1, lon, lat)]}, proj, grid, dem_sampler=lambda x, y: -2490.0)
    assert len(fc["features"]) == 1
    f = fc["features"][0]
    x, y, z = f["properties"]["local"]
    assert (x, y) == pytest.approx((300.0, -200.0), abs=0.01)
    assert z == -2490.0 and f["properties"]["elevGeoid"] == -2500.0
    assert f["geometry"]["coordinates"][:2] == [lon, lat]
    assert "images" not in f["properties"]
    assert f["properties"]["col"] == pytest.approx(1024 + 300.0, abs=0.01)
    assert f["properties"]["row"] == pytest.approx(1024 + 200.0, abs=0.01)


def test_waypoints_outside_the_window_are_dropped(setup):
    proj, grid = setup
    inside = wp(1, *lonlat(1000.0, 0.0))
    outside = wp(2, *lonlat(1100.0, 0.0))
    fc = features.waypoints_geojson({"features": [inside, outside]}, proj, grid, dem_sampler=lambda x, y: 0.0)
    assert [f["properties"]["sol"] for f in fc["features"]] == [1]


def test_traverse_lines_are_split_where_they_leave_the_window(setup):
    proj, grid = setup
    pts = [lonlat(x, 0.0) + (-2500.0,) for x in (-1500, -900, -100, 800, 1500, 900, 100)]
    trav = {"features": [{"type": "Feature", "properties": {"sol": 7, "length": 12.0},
                          "geometry": {"type": "LineString", "coordinates": [list(p) for p in pts]}}]}
    fc = features.traverse_geojson(trav, proj, grid, dem_sampler=lambda x, y: -2490.0)
    lines = fc["features"]
    assert len(lines) == 2  # in at -900.. 800, out at 1500, back in 900.. 100
    first, second = lines
    assert len(first["geometry"]["coordinates"]) == 3 and len(second["geometry"]["coordinates"]) == 2
    assert first["properties"]["sol"] == 7
    assert len(first["properties"]["local"]) == 3 and first["properties"]["local"][0][0] == pytest.approx(-900.0, abs=0.01)
