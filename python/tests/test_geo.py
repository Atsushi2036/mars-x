import math

import numpy as np
import pytest

from marsx.pipeline.geo import MARS_RADIUS_M, Grid, LocalProjection


def test_grid_corners_and_y_axis_points_down():
    g = Grid(x0=-4.0, y0=4.0, res=1.0, width=8, height=8)
    # upper-left corner of pixel (0,0) is (x0, y0); row index grows southwards
    assert g.pixel_to_world(0, 0, center=False) == (-4.0, 4.0)
    assert g.pixel_to_world(0, 0, center=True) == (-3.5, 3.5)
    assert g.pixel_to_world(7, 7, center=True) == (3.5, -3.5)
    assert g.transform == (1.0, 0.0, -4.0, 0.0, -1.0, 4.0)
    assert g.bbox == (-4.0, -4.0, 4.0, 4.0)


def test_pixel_world_roundtrip_is_half_pixel_exact():
    g = Grid(x0=-1024.0, y0=1024.0, res=0.25, width=8192, height=8192)
    for col, row in [(0, 0), (1, 5), (8191, 8191), (4096, 123)]:
        x, y = g.pixel_to_world(col, row, center=True)
        c, r = g.world_to_pixel(x, y)  # continuous coords: centre of pixel = +0.5
        assert (c, r) == pytest.approx((col + 0.5, row + 0.5))
    assert g.world_to_pixel(-1024.0, 1024.0) == (0.0, 0.0)


def test_grid_arrays_vectorised():
    g = Grid(x0=0.0, y0=10.0, res=2.0, width=4, height=5)
    cols, rows = g.world_to_pixel(np.array([0.0, 8.0]), np.array([10.0, 0.0]))
    assert list(cols) == [0.0, 4.0]
    assert list(rows) == [0.0, 5.0]


def test_local_projection_center_is_origin_and_roundtrips():
    p = LocalProjection(lon0=77.39, lat0=18.46)
    x, y = p.forward(77.39, 18.46)
    assert (x, y) == pytest.approx((0.0, 0.0), abs=1e-6)
    lon, lat = p.inverse(123.4, -567.8)
    x2, y2 = p.forward(lon, lat)
    assert (x2, y2) == pytest.approx((123.4, -567.8), abs=1e-6)


def test_local_projection_has_true_ew_scale_at_center_latitude():
    p = LocalProjection(lon0=77.39, lat0=18.46)
    x, _ = p.forward(77.39 + 0.01, 18.46)
    expected = MARS_RADIUS_M * math.radians(0.01) * math.cos(math.radians(18.46))
    assert x == pytest.approx(expected, rel=1e-9)
    # one degree of latitude = R * pi/180 northwards (no stretching in Y)
    _, y = p.forward(77.39, 18.46 + 0.01)
    assert y == pytest.approx(MARS_RADIUS_M * math.radians(0.01), rel=1e-9)


def test_proj_string_declares_sphere_and_center():
    s = LocalProjection(lon0=77.39, lat0=18.46).proj4
    assert "+proj=eqc" in s and "+R=3396190" in s and "+units=m" in s
    assert "+lat_ts=18.46" in s and "+lon_0=77.39" in s
