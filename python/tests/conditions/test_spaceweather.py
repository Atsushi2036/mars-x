import numpy as np
import pytest

from marsx.conditions import spaceweather as sw

NAN = float("nan")


def test_shelter_window_defaults_to_30_minutes_and_is_an_assumption():
    assert sw.SHELTER_WINDOW.value == 1800.0
    assert sw.SHELTER_WINDOW.unit == "s"
    assert sw.SHELTER_WINDOW.provenance == "assumption"
    assert "ntrs.nasa.gov" in sw.SHELTER_WINDOW.note
    assert sw.LABEL == "training rule, not a forecast"


def test_alert_schedule_is_deterministic_per_seed():
    a = sw.generate_alerts(seed=42, n_episodes=500, horizon_s=8 * 3600)
    b = sw.generate_alerts(seed=42, n_episodes=500, horizon_s=8 * 3600)
    np.testing.assert_array_equal(a, b)
    c = sw.generate_alerts(seed=43, n_episodes=500, horizon_s=8 * 3600)
    assert not np.array_equal(a, c, equal_nan=True)


def test_alert_schedule_probability_and_bounds():
    t = sw.generate_alerts(seed=1, n_episodes=4000, horizon_s=3600.0, p_alert=0.5, earliest_s=600.0)
    fired = ~np.isnan(t)
    assert 0.45 < fired.mean() < 0.55
    assert np.all((t[fired] >= 600.0) & (t[fired] < 3600.0))
    assert np.all(~np.isnan(sw.generate_alerts(seed=1, n_episodes=10, horizon_s=3600.0, p_alert=1.0)))


def test_status_transitions_vectorised():
    alert = np.array([NAN, 100.0, 100.0, 100.0, 100.0])
    state = np.zeros(5, dtype=np.uint8)
    # t=50: nothing fired yet
    state = sw.update(state, t_s=50.0, alert_t_s=alert, in_shelter=np.zeros(5, bool))
    assert state.tolist() == [sw.IDLE] * 5
    # t=200: alerts active; agent 2 reaches shelter
    state = sw.update(state, t_s=200.0, alert_t_s=alert, in_shelter=np.array([0, 0, 1, 0, 0], bool))
    assert state.tolist() == [sw.IDLE, sw.ACTIVE, sw.SAFE, sw.ACTIVE, sw.ACTIVE]
    # t=1900 = alert + 1800: still on time for agent 3
    state = sw.update(state, t_s=1900.0, alert_t_s=alert, in_shelter=np.array([0, 0, 0, 1, 0], bool))
    assert state.tolist() == [sw.IDLE, sw.ACTIVE, sw.SAFE, sw.SAFE, sw.ACTIVE]
    # t=1901: agents 1 and 4 too late -> violated (sticky, even if they shelter afterwards)
    state = sw.update(state, t_s=1901.0, alert_t_s=alert, in_shelter=np.array([0, 1, 0, 0, 0], bool))
    assert state.tolist() == [sw.IDLE, sw.VIOLATED, sw.SAFE, sw.SAFE, sw.VIOLATED]
    state = sw.update(state, t_s=5000.0, alert_t_s=alert, in_shelter=np.ones(5, bool))
    assert state.tolist() == [sw.IDLE, sw.VIOLATED, sw.SAFE, sw.SAFE, sw.VIOLATED]


def test_post_hoc_compliance():
    alert = np.array([NAN, 100.0, 100.0, 100.0])
    arrival = np.array([NAN, 1900.0, 1900.1, NAN])
    assert sw.compliant(alert, arrival).tolist() == [True, True, False, False]


def test_custom_window():
    assert sw.compliant(np.array([0.0]), np.array([700.0]), window_s=600.0).tolist() == [False]


def test_scripted_event_records_source():
    ev = sw.AlertEvent(t_s=1200.0, source="scripted")
    assert ev.to_dict() == {"tS": 1200.0, "source": "scripted", "label": sw.LABEL}
    with pytest.raises(ValueError):
        sw.AlertEvent(t_s=-1.0, source="scripted")
