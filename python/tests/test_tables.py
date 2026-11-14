import math

import numpy as np
import pytest
from rasterio.transform import from_origin

from marsx.conditions import mars24
from marsx.pipeline import derive, tables
from marsx.pipeline.geo import MARS_RADIUS_M, Grid, LocalProjection

SRC_PROJ4 = "+proj=eqc +lat_ts=0 +lon_0=0 +R=3396190 +units=m +no_defs +type=crs"


def test_sky_view_is_one_on_flat_ground_and_drops_next_to_a_wall():
    flat = np.zeros((64, 64), np.float32)
    h = derive.horizon_maps(flat, 1.0, n_az=16, max_dist_m=40.0)
    svf = tables.sky_view_u8(h)
    assert svf.dtype == np.uint8 and (svf == tables.SVF_ONE).all()
    wall = np.zeros((64, 64), np.float32)
    wall[:, 40:] = 10.0
    h = derive.horizon_maps(wall, 1.0, n_az=16, max_dist_m=60.0)
    svf = tables.sky_view_u8(h)
    assert svf[32, 39] < svf[32, 5] <= tables.SVF_ONE  # next to the wall sees less sky
    # matches the scalar formula mean(cos^2(horizon)) used by conditions.insolation
    ang = np.radians(derive.u8_to_angle(h[:, 32, 39]))
    assert svf[32, 39] / tables.SVF_ONE == pytest.approx(np.mean(np.cos(ang) ** 2), abs=1.0 / 254)


def test_sky_view_propagates_nodata():
    h = np.zeros((16, 4, 4), np.uint8)
    h[:, 1, 1] = derive.U8_NODATA
    svf = tables.sky_view_u8(h)
    assert svf[1, 1] == 255 and svf[0, 0] == tables.SVF_ONE


def test_thermal_inertia_is_resampled_onto_the_local_grid_and_classified():
    # 100 m/px THEMIS-like raster: left half 100 (loose), right half 600 (rocky), 0 = null
    arr = np.full((60, 60), 100.0, np.float32)
    arr[:, 30:] = 600.0
    arr[0, 0] = 0.0
    x0, y0 = 4577366.0, 1106618.0
    tr = from_origin(x0, y0, 100.0, 100.0)
    lon0 = math.degrees((x0 + 3000.0) / MARS_RADIUS_M)
    lat0 = math.degrees((y0 - 3000.0) / MARS_RADIUS_M)
    proj = LocalProjection(lon0, lat0)
    g = Grid(-512.0, 512.0, 2.0, 512, 512)
    ti, cls = tables.thermal_inertia_to_grid(arr, tr, SRC_PROJ4, g, proj, nodata=0.0)
    assert ti.shape == cls.shape == (512, 512)
    # 100 m cells: the field changes at world x ~ 0 (pixel col 256); far sides are pure classes
    assert cls[256, 10] == 0 and cls[256, 500] == 2  # LOOSE / ROCKY from marsx.conditions.slip
    assert ti[256, 10] == pytest.approx(100.0, rel=1e-3) and ti[256, 500] == pytest.approx(600.0, rel=1e-3)


def test_sun_table_shape_range_and_noon_elevation():
    start = int(mars24.unix_ms_from_msd(math.floor(mars24.mars_sol_date(1_640_995_200_000))))
    t = tables.sun_table(start, n=1480, step_s=60.0, lat_deg=18.4617, lon_east_deg=77.3935)
    assert t.shape == (1480, 3) and t.dtype == np.float32
    az, el, r = t[:, 0], t[:, 1], t[:, 2]
    assert (az >= 0).all() and (az < 360).all() and el.max() > 40 and el.min() < -40
    assert 1.3 < r.min() and r.max() < 1.7  # Mars-Sun distance in AU
    # deterministic: same inputs, same bytes
    assert np.array_equal(t, tables.sun_table(start, 1480, 60.0, 18.4617, 77.3935))


def test_perseverance_sol_start_matches_the_published_calendar():
    # sol 313 = start of the regional dust storm window at Jezero (early January 2022)
    ms = tables.perseverance_sol_start_ms(313, lon_east_deg=77.3935)
    from datetime import UTC, datetime

    d = datetime.fromtimestamp(ms / 1000, UTC)
    assert (d.year, d.month) == (2022, 1) and 3 <= d.day <= 7
    # one sol is 88775.244 s
    assert (tables.perseverance_sol_start_ms(314, 77.3935) - ms) / 1000 == pytest.approx(88775.244, abs=0.5)
    # LMST at the sol start is midnight (local mean solar time = 0 h)
    lmst = float(mars24.mars_solar_state(ms, 18.4617, 77.3935).lmst_h)
    assert min(lmst, 24 - lmst) < 0.01


def test_owlt_table_hourly_is_within_physical_bounds_and_flags_conjunction():
    from datetime import UTC, datetime

    start = int(datetime(2023, 11, 1, tzinfo=UTC).timestamp() * 1000)
    end = int(datetime(2023, 12, 1, tzinfo=UTC).timestamp() * 1000)
    t = tables.owlt_table(start, end, step_h=1.0)
    assert t.shape[1] == 2 and t.shape[0] == 30 * 24
    owlt_min = t[:, 0] / 60.0
    assert 18 < owlt_min.min() and owlt_min.max() < 23  # Nov 2023: ~2.4-2.7 AU, near solar conjunction
    flags = t[:, 1]
    assert set(np.unique(flags)) <= {0.0, 1.0}
    day = int((datetime(2023, 11, 18, tzinfo=UTC).timestamp() * 1000 - start) / 3.6e6)
    assert flags[day] == 0.0  # link down at conjunction (mid-moratorium)
    assert flags[0] == 1.0 and flags[-1] == 1.0
