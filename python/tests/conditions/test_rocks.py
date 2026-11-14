import math

import numpy as np
import pytest

from marsx.conditions import rocks


def test_q_of_k_matches_golombek_rapp_1997():
    assert rocks.q_of_k(0.05) == pytest.approx(1.79 + 0.152 / 0.05)
    assert rocks.cumulative_area_fraction(0.0, 0.05) == pytest.approx(0.05)
    assert rocks.cumulative_area_fraction(1.0, 0.05) == pytest.approx(0.05 * math.exp(-rocks.q_of_k(0.05)))


def test_rock_abundance_out_of_range_rejected():
    with pytest.raises(ValueError):
        rocks.generate_rocks(seed=1, width_m=100, height_m=100, k=0.0)
    with pytest.raises(ValueError):
        rocks.generate_rocks(seed=1, width_m=100, height_m=100, k=0.5)


def test_same_seed_same_rocks_and_digest():
    a = rocks.generate_rocks(seed=20261115, width_m=400, height_m=300, k=0.05)
    b = rocks.generate_rocks(seed=20261115, width_m=400, height_m=300, k=0.05)
    assert len(a) > 0
    np.testing.assert_array_equal(a.x_m, b.x_m)
    np.testing.assert_array_equal(a.y_m, b.y_m)
    np.testing.assert_array_equal(a.d_m, b.d_m)
    assert a.digest() == b.digest()


def test_different_seed_different_rocks():
    a = rocks.generate_rocks(seed=1, width_m=400, height_m=300, k=0.05)
    b = rocks.generate_rocks(seed=2, width_m=400, height_m=300, k=0.05)
    assert a.digest() != b.digest()


def test_rocks_inside_bounds_and_sizes_in_range():
    f = rocks.generate_rocks(seed=3, width_m=200, height_m=100, k=0.05, d_min=0.4, d_max=1.0)
    assert np.all((f.x_m >= 0) & (f.x_m < 200))
    assert np.all((f.y_m >= 0) & (f.y_m < 100))
    assert np.all((f.d_m >= 0.4) & (f.d_m <= 1.0))
    np.testing.assert_allclose(f.h_m, 0.5 * f.d_m, rtol=1e-6)


def test_count_matches_model_expectation():
    area = 1000.0 * 1000.0
    f = rocks.generate_rocks(seed=7, width_m=1000, height_m=1000, k=0.05)
    expected = rocks.expected_count(area, 0.05, 0.4, 1.0)
    assert expected > 1000
    assert abs(len(f) - expected) < 5 * math.sqrt(expected)


def test_area_covered_by_rocks_follows_cumulative_area_model():
    k, d0 = 0.05, 0.6
    f = rocks.generate_rocks(seed=11, width_m=1000, height_m=1000, k=k, d_min=0.4, d_max=1.0)
    area_frac = float(np.sum(math.pi * f.d_m[f.d_m > d0] ** 2 / 4)) / 1e6
    model = rocks.cumulative_area_fraction(d0, k) - rocks.cumulative_area_fraction(1.0, k)
    assert area_frac == pytest.approx(model, rel=0.05)


def test_hazard_and_impassable_flags():
    f = rocks.generate_rocks(seed=5, width_m=500, height_m=500, k=0.08, d_min=0.2, d_max=1.2)
    assert np.array_equal(f.hazard, f.h_m > rocks.HAZARD_HEIGHT.value)
    assert np.array_equal(f.impassable, f.h_m > rocks.IMPASSABLE_HEIGHT.value)
    assert rocks.HAZARD_HEIGHT.value == 0.20
    assert rocks.IMPASSABLE_HEIGHT.value == 0.525


def test_rasterize_max_height_puts_rock_in_its_cell():
    f = rocks.RockField.from_arrays(
        x_m=np.array([5.0, 5.5, 0.1]), y_m=np.array([3.0, 3.9, 0.1]),
        d_m=np.array([0.5, 0.8, 0.3]), meta={"seed": 0},
    )
    grid = rocks.rasterize_max_height(f, shape=(4, 4), res_m=2.0)
    assert grid.dtype == np.float32
    assert grid[1, 2] == pytest.approx(0.4)  # max(0.25, 0.4) in row 1 (y 2..4), col 2 (x 4..6)
    assert grid[0, 0] == pytest.approx(0.15)
    assert grid.sum() == pytest.approx(0.55)


def test_reveal_within_sensor_radius():
    f = rocks.RockField.from_arrays(
        x_m=np.array([0.0, 7.9, 8.1, 3.0]), y_m=np.array([0.0, 0.0, 0.0, 4.0]),
        d_m=np.array([0.5, 0.5, 0.5, 0.5]), meta={"seed": 0},
    )
    mask = rocks.reveal(f, x_m=0.0, y_m=0.0)  # default R_s = 8 m (assumption)
    assert mask.tolist() == [True, True, False, True]
    assert rocks.SENSOR_RADIUS.provenance == "assumption"


def test_field_is_labelled_synthetic_with_model_metadata():
    f = rocks.generate_rocks(seed=9, width_m=50, height_m=50, k=0.03)
    assert f.meta["label"] == "synthetic"
    assert f.meta["model"].startswith("Golombek & Rapp 1997")
    assert f.meta["seed"] == 9 and f.meta["k"] == 0.03
