import math

import numpy as np
import pytest
from rasterio.transform import from_origin

from marsx.pipeline.geo import MARS_RADIUS_M, Grid, LocalProjection
from marsx.pipeline.reproject import reproject_to_grid

SRC_PROJ4 = "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs +type=crs"


def make_lon_raster():
    """Source raster (lat_ts=0 eqc, 1 m/px) whose value is the longitude in degrees."""
    x0, y0 = 4577366.0, 1106618.0
    w = h = 3000
    cols = x0 + (np.arange(w) + 0.5)
    lon = np.degrees(cols / MARS_RADIUS_M).astype(np.float64)
    arr = np.tile(lon, (h, 1)).astype(np.float32)
    return arr, from_origin(x0, y0, 1.0, 1.0)


def test_reprojection_removes_the_east_west_stretch():
    arr, tr = make_lon_raster()
    lon0 = math.degrees((4577366.0 + 1500.0) / MARS_RADIUS_M)
    lat0 = math.degrees((1106618.0 - 1500.0) / MARS_RADIUS_M)
    proj = LocalProjection(lon0, lat0)
    g = Grid(-512.0, 512.0, 1.0, 1024, 1024)
    out = reproject_to_grid(arr, tr, SRC_PROJ4, g, proj, resampling="bilinear")
    assert out.shape == (1024, 1024) and out.dtype == np.float32
    # pixel centre is at +300.5 m east of the window centre must equal lon0 + 300 / (R cos(lat0)) in degrees
    col = 512 + 300
    expected = lon0 + math.degrees(300.5 / (MARS_RADIUS_M * math.cos(math.radians(lat0))))
    assert out[512, col] == pytest.approx(expected, abs=1.0e-5)  # float32 source: ~1 ulp = 7.6e-6 deg
    # a naive (unreprojected) pixel read would be off by ~5.4 % in distance (~16 m at 300 m)
    naive = lon0 + math.degrees(300.5 / MARS_RADIUS_M)
    assert abs(naive - expected) > 1e-4


def test_nodata_becomes_nan_and_outside_is_nan():
    arr, tr = make_lon_raster()
    arr[1400:1600, 1400:1600] = -3.4028226550889045e38
    lon0 = math.degrees((4577366.0 + 1500.0) / MARS_RADIUS_M)
    lat0 = math.degrees((1106618.0 - 1500.0) / MARS_RADIUS_M)
    proj = LocalProjection(lon0, lat0)
    g = Grid(-2000.0, 2000.0, 4.0, 1000, 1000)  # extends beyond the 3 km source
    out = reproject_to_grid(arr, tr, SRC_PROJ4, g, proj, resampling="bilinear", src_nodata=-3.4028226550889045e38)
    assert np.isnan(out[500, 500])  # centre is inside the nodata hole
    assert np.isnan(out[0, 0])  # outside source coverage
    assert not np.isnan(out[500, 400])


def test_uint8_nodata_zero_is_preserved_as_zero():
    arr = np.full((3000, 3000), 120, np.uint8)
    arr[:, :1000] = 0
    tr = from_origin(4577366.0, 1106618.0, 1.0, 1.0)
    lon0 = math.degrees((4577366.0 + 1500.0) / MARS_RADIUS_M)
    lat0 = math.degrees((1106618.0 - 1500.0) / MARS_RADIUS_M)
    proj = LocalProjection(lon0, lat0)
    g = Grid(-512.0, 512.0, 1.0, 1024, 1024)
    out = reproject_to_grid(arr, tr, SRC_PROJ4, g, proj, resampling="bilinear", dtype="uint8", src_nodata=0)
    assert out.dtype == np.uint8 and out[512, 512] == 120


def test_declare_nodata_false_keeps_zero_valued_pixels_intact():
    arr = np.zeros((3000, 3000), np.uint8)  # all black, e.g. a CRISM "not identified" colour
    tr = from_origin(4577366.0, 1106618.0, 1.0, 1.0)
    lon0 = math.degrees((4577366.0 + 1500.0) / MARS_RADIUS_M)
    lat0 = math.degrees((1106618.0 - 1500.0) / MARS_RADIUS_M)
    proj = LocalProjection(lon0, lat0)
    g = Grid(-512.0, 512.0, 1.0, 1024, 1024)
    out = reproject_to_grid(arr, tr, SRC_PROJ4, g, proj, "nearest", dtype="uint8", declare_nodata=False)
    assert out[512, 512] == 0 and out.max() == 0  # not remapped to 1
    out2 = reproject_to_grid(arr, tr, SRC_PROJ4, g, proj, "nearest", dtype="uint8", declare_nodata=True)
    assert out2[512, 512] == 1  # documents the GDAL behaviour we avoid
