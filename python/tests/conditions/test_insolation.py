import numpy as np
import pytest

from marsx.conditions.insolation import (
    horizon_elevation_at,
    net_flux_f,
    shaded_irradiance,
    sky_view_factor,
    surface_irradiance,
    toa_beam_irradiance,
)


def test_top_of_atmosphere_matches_nssdca_mean():
    # NSSDCA Mars fact sheet: 586.2 W/m2 at the mean distance (1.52368 AU) for S = 1361.
    assert toa_beam_irradiance(1.52368) == pytest.approx(586.2, abs=0.3)
    assert toa_beam_irradiance(1.52369152, solar_constant=1371.0) == pytest.approx(590.5, abs=0.5)


# Appelbaum & Flood 1990 (NASA TM-103623) Table I(a), albedo 0.1: (zenith deg, tau, f).
# The polynomial fit has mean error 0.7 %, so compare within 0.01 absolute.
@pytest.mark.parametrize(
    "z,tau,expected",
    [(0, 0.1, 0.883), (0, 0.5, 0.813), (0, 1.0, 0.728), (0, 1.5, 0.649), (0, 6.0, 0.229),
     (20, 0.5, 0.804), (30, 2.0, 0.532), (40, 0.1, 0.875), (40, 1.0, 0.669)],
)
def test_net_flux_matches_table1(z, tau, expected):
    assert float(net_flux_f(float(z), tau, 0.1)) == pytest.approx(expected, abs=0.01)


def test_global_equals_direct_plus_diffuse_and_is_nonnegative():
    z = np.array([0, 20, 40, 60, 80, 85.0])
    g, b, d = surface_irradiance(z, 0.5, 1.5237, albedo=0.1)
    assert np.allclose(g, b + d)
    assert (d >= 0).all() and (b >= 0).all()
    # direct beam on horizontal: Gob cos z exp(-tau/cos z)
    gob = toa_beam_irradiance(1.5237)
    assert b[0] == pytest.approx(gob * np.exp(-0.5), rel=1e-9)
    assert b[2] == pytest.approx(gob * np.cos(np.radians(40)) * np.exp(-0.5 / np.cos(np.radians(40))), rel=1e-9)


def test_more_dust_less_direct_more_diffuse_fraction():
    _, b1, d1 = surface_irradiance(30.0, 0.5, 1.5237)
    _, b2, d2 = surface_irradiance(30.0, 2.0, 1.5237)
    assert b2 < b1 and d2 / (b2 + d2) > d1 / (b1 + d1)


def test_sun_below_horizon_is_zero():
    g, b, d = surface_irradiance(np.array([90.0, 120.0]), 0.5, 1.5237)
    assert (g == 0).all() and (b == 0).all() and (d == 0).all()


def test_rejects_out_of_range_inputs():
    with pytest.raises(ValueError):
        surface_irradiance(30.0, -0.1, 1.5)
    with pytest.raises(ValueError):
        surface_irradiance(30.0, 7.0, 1.5)
    with pytest.raises(ValueError):
        surface_irradiance(30.0, 0.5, 1.5, albedo=0.7)


def test_horizon_interpolation_16_azimuths():
    h = np.zeros(16)
    h[4] = 10.0  # azimuth 90 deg (east), 22.5 deg per bin from north, clockwise
    assert horizon_elevation_at(h, 90.0) == pytest.approx(10.0)
    assert horizon_elevation_at(h, 90.0 + 11.25) == pytest.approx(5.0)
    h2 = np.zeros(16)
    h2[15] = 8.0
    assert horizon_elevation_at(h2, 348.75) == pytest.approx(4.0)  # midpoint of bins 15 and 0 (wraps)
    assert horizon_elevation_at(h, np.array([90.0, 0.0])).shape == (2,)


def test_sky_view_factor():
    assert sky_view_factor(np.zeros(16)) == pytest.approx(1.0)
    assert sky_view_factor(np.full(16, 90.0)) == pytest.approx(0.0, abs=1e-12)
    assert sky_view_factor(np.full(16, 30.0)) == pytest.approx(np.cos(np.radians(30)) ** 2)


def test_shaded_irradiance_blocks_direct_and_scales_diffuse():
    h = np.full(16, 20.0)
    # sun at 30 deg elevation (zenith 60) above a 20 deg horizon: lit
    lit = shaded_irradiance(60.0, 100.0, 0.5, 1.5237, h)
    flat_g, flat_b, flat_d = surface_irradiance(60.0, 0.5, 1.5237)
    svf = sky_view_factor(h)
    assert lit.lit and lit.direct == pytest.approx(flat_b) and lit.diffuse == pytest.approx(flat_d * svf)
    # sun at 10 deg elevation behind the 20 deg horizon: shaded, only sky-view diffuse
    sh = shaded_irradiance(80.0, 100.0, 0.5, 1.5237, h)
    _, _, d80 = surface_irradiance(80.0, 0.5, 1.5237)
    assert (not sh.lit) and sh.direct == 0.0 and sh.diffuse == pytest.approx(d80 * svf)
    assert sh.global_ == pytest.approx(sh.diffuse)
