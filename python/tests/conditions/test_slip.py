import numpy as np
import pytest

from marsx.conditions import slip


def test_thermal_inertia_classes():
    ti = np.array([50.0, 149.9, 150.0, 399.0, 400.0, 1200.0, np.nan])
    cls = slip.classify_thermal_inertia(ti)
    assert cls.dtype == np.uint8
    assert cls.tolist() == [
        slip.LOOSE, slip.LOOSE, slip.MIXED, slip.MIXED, slip.ROCKY, slip.ROCKY, slip.UNKNOWN,
    ]


def test_slip_is_flat_below_threshold_and_grows_quadratically():
    p = slip.CLASS_PARAMS[slip.LOOSE]
    s_flat = slip.slip_ratio(0.0, slip.LOOSE)
    assert s_flat == pytest.approx(p.s0)
    assert slip.slip_ratio(p.theta0_deg, slip.LOOSE) == pytest.approx(p.s0)
    th = p.theta0_deg + 10.0
    assert slip.slip_ratio(th, slip.LOOSE) == pytest.approx(p.s0 + p.s1 * 100.0)


def test_loose_material_slips_more_than_bedrock_at_same_slope():
    for slope in (5.0, 15.0, 24.0):
        assert slip.slip_ratio(slope, slip.LOOSE) > slip.slip_ratio(slope, slip.MIXED) > slip.slip_ratio(slope, slip.ROCKY)


def test_unknown_class_uses_mixed_parameters():
    assert slip.slip_ratio(18.0, slip.UNKNOWN) == pytest.approx(slip.slip_ratio(18.0, slip.MIXED))


def test_slip_vectorised_and_clipped_to_unit_interval():
    slopes = np.array([0.0, 10.0, 30.0, 60.0])
    classes = np.array([slip.LOOSE, slip.MIXED, slip.LOOSE, slip.LOOSE], dtype=np.uint8)
    s = slip.slip_ratio(slopes, classes)
    assert s.shape == (4,)
    assert np.all((s >= 0) & (s <= 1))
    assert s[3] == 1.0


def test_stuck_threshold():
    assert slip.STUCK_THRESHOLD.value == 0.6
    assert slip.is_stuck(0.61) and not slip.is_stuck(0.59)
    assert slip.is_stuck(np.array([0.1, 0.7])).tolist() == [False, True]


def test_loose_sand_at_rover_tilt_limit_is_near_stuck():
    assert slip.slip_ratio(24.0, slip.LOOSE) > 0.5


def test_effective_speed_factor():
    assert slip.speed_factor(0.25) == pytest.approx(0.75)


def test_all_tunable_parameters_are_assumptions():
    params = slip.all_params()
    assert params["thermal_inertia_accuracy"].provenance == "measured"
    for name, p in params.items():
        if name != "thermal_inertia_accuracy":
            assert p.provenance == "assumption", name
