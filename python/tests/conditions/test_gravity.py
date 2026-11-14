import math

import pytest

from marsx.conditions import gravity
from marsx.conditions.params import Param


def test_equatorial_and_polar_values_come_from_nssdc():
    assert gravity.G_EQUATORIAL.value == 3.69
    assert gravity.G_POLAR.value == 3.73
    for p in (gravity.G_EQUATORIAL, gravity.G_POLAR):
        assert p.provenance == "measured"
        assert "nssdc.gsfc.nasa.gov" in p.source


def test_gravity_at_equator_and_pole():
    assert gravity.gravity_at_latitude(0.0) == pytest.approx(3.69)
    assert gravity.gravity_at_latitude(90.0) == pytest.approx(3.73)
    assert gravity.gravity_at_latitude(-90.0) == pytest.approx(3.73)


def test_gravity_is_monotonic_in_absolute_latitude():
    values = [gravity.gravity_at_latitude(lat) for lat in (0, 15, 30, 45, 60, 75, 90)]
    assert values == sorted(values)


def test_jezero_gravity_is_3_694_and_derived_with_source():
    g = gravity.JEZERO_GRAVITY
    expected = 3.69 + 0.04 * math.sin(math.radians(18.4447)) ** 2
    assert g.value == pytest.approx(round(expected, 3))
    assert g.value == pytest.approx(3.694)
    assert g.unit == "m/s^2"
    assert g.provenance == "derived"
    assert "nssdc" in g.source.lower()


def test_latitude_out_of_range_rejected():
    with pytest.raises(ValueError):
        gravity.gravity_at_latitude(91.0)


def test_param_rejects_unknown_provenance_and_empty_source():
    with pytest.raises(ValueError):
        Param(1.0, "m", "guess", "x")  # type: ignore[arg-type]
    with pytest.raises(ValueError):
        Param(1.0, "m", "assumption", "")


def test_param_serialises_to_camel_friendly_dict():
    p = Param(3.0, "m", "assumption", "team assumption: sensor range", note="calibrable")
    assert p.to_dict() == {
        "value": 3.0, "unit": "m", "provenance": "assumption",
        "source": "team assumption: sensor range", "note": "calibrable",
    }


def test_param_maps_to_scenario_contract_provenance():
    from marsx.conditions.gravity import G_EQUATORIAL, JEZERO_GRAVITY
    from marsx.conditions.params import assumption

    c = JEZERO_GRAVITY.to_contract()
    assert c.provenance == "computed" and c.value == 3.694 and c.ref
    assert G_EQUATORIAL.to_contract().provenance == "source"
    a = assumption(8.0, "m", "sensor range").to_contract()
    assert a.provenance == "assumption" and a.note
