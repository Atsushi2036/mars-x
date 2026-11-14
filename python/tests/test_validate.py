import math

import numpy as np
import pytest
from scipy.ndimage import gaussian_filter, shift

from marsx.pipeline import validate


def smooth_noise(n=256, seed=3):
    rng = np.random.default_rng(seed)
    return gaussian_filter(rng.normal(size=(n, n)), 3.0)


@pytest.mark.parametrize("dy,dx", [(0.0, 0.0), (2.0, -3.0), (0.4, 0.7), (-1.3, 0.25)])
def test_ncc_shift_recovers_known_subpixel_shifts(dy, dx):
    a = smooth_noise()
    b = shift(a, (dy, dx), order=3, mode="wrap")
    (ry, rx), quality = validate.ncc_shift(a, b)
    assert (ry, rx) == pytest.approx((dy, dx), abs=0.15)
    assert quality > 0.5


def test_ncc_shift_quality_is_low_for_unrelated_images():
    a, b = smooth_noise(seed=1), smooth_noise(seed=2)
    _, q_bad = validate.ncc_shift(a, b)
    _, q_good = validate.ncc_shift(a, a)
    assert q_good > 0.9 and q_bad < 0.3


def test_predicted_pitch_and_roll_from_dem_gradient_and_heading():
    # terrain rises 10 deg towards the east; rover heading east (yaw 90, clockwise from north)
    gx, gy = math.tan(math.radians(10.0)), 0.0
    pitch, roll = validate.predict_pitch_roll(gx, gy, yaw_deg=90.0)
    assert pitch == pytest.approx(10.0, abs=1e-6) and roll == pytest.approx(0.0, abs=1e-6)
    # heading north over the same terrain: no pitch, a 10 degree roll
    pitch, roll = validate.predict_pitch_roll(gx, gy, yaw_deg=0.0)
    assert pitch == pytest.approx(0.0, abs=1e-6) and roll == pytest.approx(-10.0, abs=1e-6)  # right side DOWN is positive: terrain rises to the east = right side up here -> negative


def test_agreement_stats_perfect_and_biased():
    x = np.array([1.0, 2.0, 3.0, 4.0, 5.0])
    s = validate.agreement_stats(x, x)
    assert s["n"] == 5 and s["pearson"] == pytest.approx(1.0) and s["mae"] == 0.0 and s["bias"] == 0.0
    s = validate.agreement_stats(x + 2.0, x)
    assert s["bias"] == pytest.approx(2.0) and s["rmse"] == pytest.approx(2.0)
    assert validate.agreement_stats(np.array([1.0]), np.array([1.0]))["pearson"] is None  # too few points
