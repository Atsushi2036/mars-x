import math

import numpy as np
import pytest

from marsx.pipeline import derive


def ramp(deg: float, n: int = 16, res: float = 1.0, axis: str = "x") -> np.ndarray:
    k = math.tan(math.radians(deg)) * res
    v = np.arange(n, dtype=np.float32) * k
    return np.tile(v, (n, 1)) if axis == "x" else np.tile(v[:, None], (1, n))


def test_flat_plane_has_zero_slope_roughness_and_step():
    dem = np.full((16, 16), -2500.0, np.float32)
    assert np.allclose(derive.slope_deg(dem, 1.0), 0.0)
    assert np.allclose(derive.roughness(dem, 1.0), 0.0)
    assert np.allclose(derive.step_height(dem), 0.0)


@pytest.mark.parametrize("axis", ["x", "y"])
def test_45_degree_ramp_has_45_degree_slope_everywhere_including_edges(axis):
    dem = ramp(45.0, axis=axis)
    s = derive.slope_deg(dem, 1.0)
    assert np.allclose(s, 45.0, atol=1e-3)  # edges too: no "highways" at the border


def test_slope_respects_cell_size():
    dem = ramp(30.0, res=2.0)  # 2 m cells, rise matches 30 deg
    assert np.allclose(derive.slope_deg(dem, 2.0), 30.0, atol=1e-3)


def test_slope_propagates_nodata_as_nan_only_around_the_hole():
    dem = np.zeros((8, 8), np.float32)
    dem[3, 3] = np.nan
    s = derive.slope_deg(dem, 1.0)
    assert np.isnan(s[2:5, 2:5]).all()
    assert not np.isnan(s[0, 0]) and not np.isnan(s[7, 7])
    assert int(np.isnan(s).sum()) == 9


def test_roughness_of_a_plane_is_zero_but_of_a_spike_is_not():
    dem = ramp(20.0)
    assert np.allclose(derive.roughness(dem, 1.0), 0.0, atol=1e-3)
    dem[8, 8] += 1.0
    r = derive.roughness(dem, 1.0)
    assert r[8, 8] > 0.1 and r[0, 0] < 1e-3


def test_step_height_is_ledge_height_and_ignores_slope():
    dem = np.zeros((8, 8), np.float32)
    dem[4, 4] = 0.5  # a single-cell bump: second difference = 2 * 0.5
    st = derive.step_height(dem)
    assert st[4, 4] == pytest.approx(1.0)
    assert st[4, 3] == pytest.approx(0.5)  # neighbour sees half of it
    assert st[3, 3] == pytest.approx(0.5)  # diagonal neighbour too
    assert st[0, 0] == 0.0
    # a 45 degree ramp has no steps: slope must not inflate the layer
    assert np.allclose(derive.step_height(ramp(45.0)), 0.0, atol=1e-5)
    ledge = np.zeros((8, 8), np.float32)
    ledge[:, 4:] = 0.6
    assert derive.step_height(ledge)[4, 3] == pytest.approx(0.6)


def test_maxpool_is_conservative_and_nan_aware():
    a = np.array([[1, 2, 5, np.nan], [3, 4, np.nan, np.nan]], np.float32)
    p = derive.maxpool(a, 2)
    assert p.shape == (1, 2)
    assert p[0, 0] == 4.0 and p[0, 1] == 5.0
    assert np.isnan(derive.maxpool(np.full((2, 2), np.nan, np.float32), 2)).all()


def test_meanpool_height_ignores_nan_unless_all_nan():
    a = np.array([[1, 3, np.nan, np.nan], [5, 7, np.nan, np.nan]], np.float32)
    p = derive.meanpool(a, 2)
    assert p[0, 0] == 4.0 and np.isnan(p[0, 1])


def test_hazard_scales_to_limits_and_flags_nodata():
    slope = np.array([0.0, 15.0, 30.0, 60.0, np.nan], np.float32)
    zeros = np.zeros_like(slope)
    h = derive.hazard_u8(slope, zeros, zeros)
    assert list(h[:4]) == [0, 127, 254, 254]  # saturates below nodata
    assert h[4] == derive.HAZARD_NODATA == 255
    step = np.array([0.30, 0, 0, 0, 0], np.float32)
    assert derive.hazard_u8(zeros, step, zeros)[0] == 254  # worst term wins


def test_normal_map_flat_points_up_and_ramp_tilts_toward_downhill():
    flat = derive.normal_map(np.zeros((8, 8), np.float32), 1.0)
    assert flat.dtype == np.uint8 and flat.shape == (8, 8, 3)
    assert tuple(flat[4, 4]) == (128, 128, 255)  # +Z, tangent space (x east, y north)
    n = derive.normal_map(ramp(45.0, n=8), 1.0)[4, 4].astype(float) / 255 * 2 - 1
    # terrain rises to the east, so the normal leans west (-x) and up
    assert n[0] < -0.6 and n[2] == pytest.approx(math.cos(math.radians(45)), abs=0.02)
    assert abs(n[1]) < 0.02


def test_u8_angle_quantisation_roundtrips_within_half_step():
    deg = np.array([0.0, 12.3, 89.9, np.nan], np.float32)
    q = derive.angle_to_u8(deg)
    assert q[3] == 255
    back = derive.u8_to_angle(q)
    assert np.allclose(back[:3], deg[:3], atol=0.25 + 1e-6)


def test_horizon_flat_is_zero_and_wall_gives_atan_h_over_d():
    flat = np.zeros((64, 64), np.float32)
    assert (derive.horizon_maps(flat, 1.0, n_az=16, max_dist_m=40.0) == 0).all()
    dem = np.zeros((64, 64), np.float32)
    dem[:, 40:] = 10.0  # wall rising to the east, 10 m tall
    h = derive.horizon_maps(dem, 1.0, n_az=16, max_dist_m=60.0)
    assert h.shape == (16, 64, 64)
    # azimuth index 4 = 90 deg (east); cell (32, 30): wall edge ~9.5-10 m away
    ang = derive.u8_to_angle(h[4, 32, 30])
    assert ang == pytest.approx(math.degrees(math.atan2(10.0, 9.5)), abs=1.5)
    assert derive.u8_to_angle(h[12, 32, 30]) == 0.0  # looking west: nothing
    assert derive.u8_to_angle(h[0, 32, 10]) == 0.0  # north along the flat: nothing


def test_parallel_kernels_equal_serial_reference():
    rng = np.random.default_rng(0)
    dem = rng.normal(0, 3, (96, 96)).astype(np.float32).cumsum(0).cumsum(1) * 0.01
    a = derive.horizon_maps(dem, 2.0, n_az=8, max_dist_m=100.0, parallel=True)
    b = derive.horizon_maps(dem, 2.0, n_az=8, max_dist_m=100.0, parallel=False)
    assert np.array_equal(a, b)
