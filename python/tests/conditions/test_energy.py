import numpy as np
import pytest

from marsx.conditions import energy
from marsx.conditions.params import PROVENANCES, Param


def test_all_energy_parameters_carry_provenance():
    params = energy.all_params()
    assert params, "expected a parameter registry"
    for name, p in params.items():
        assert isinstance(p, Param), name
        assert p.provenance in PROVENANCES
        assert p.source.strip()
    # The team assumptions must be explicitly marked as such.
    for name in ("rolling_resistance", "drive_efficiency", "base_load_w", "solar_dust_loss",
                 "solar_reference_irradiance", "eva_duration_h", "astronaut_speed"):
        assert params[name].provenance == "assumption", name
    for name in ("rtg_bol_w", "battery_ah_each", "rover_mass_kg", "rover_speed", "solar_panel_w",
                 "met_rate_low_w", "met_rate_high_w"):
        assert params[name].provenance == "measured", name


def test_rtg_power_starts_at_110_w_and_reaches_about_72_w_at_17_years():
    assert energy.rtg_power_w(0.0) == pytest.approx(110.0)
    assert energy.rtg_power_w(17.0) == pytest.approx(72.0, abs=1.5)
    assert energy.rtg_power_w(5.0) < energy.rtg_power_w(4.0)


def test_rtg_decay_is_2_5_percent_per_year():
    assert energy.rtg_power_w(1.0) == pytest.approx(110.0 * 0.975)


def test_rtg_rejects_negative_age():
    with pytest.raises(ValueError):
        energy.rtg_power_w(-1.0)


def test_battery_capacity_is_two_43_ah_packs_at_28_v():
    assert energy.battery_capacity_wh() == pytest.approx(2 * 43 * 28)


def test_traction_power_on_flat_ground_is_positive_and_grows_with_uphill_slope():
    flat = energy.rover_drive_power_w(0.0, gravity=3.694)
    up = energy.rover_drive_power_w(10.0, gravity=3.694)
    down = energy.rover_drive_power_w(-10.0, gravity=3.694)
    assert flat > energy.PARAMS["base_load_w"].value
    assert up > flat > down
    # No regenerative braking: power never drops below the base load.
    assert down >= energy.PARAMS["base_load_w"].value


def test_traction_power_is_vectorised():
    slopes = np.array([0.0, 5.0, 20.0])
    p = energy.rover_drive_power_w(slopes, gravity=3.694)
    assert p.shape == (3,)
    assert np.all(np.diff(p) > 0)


def test_drive_energy_for_a_2_m_step_matches_power_times_time():
    e = energy.rover_drive_energy_wh(2.0, 0.0, gravity=3.694)
    p = energy.rover_drive_power_w(0.0, gravity=3.694)
    t_s = 2.0 / energy.PARAMS["rover_speed"].value
    assert e == pytest.approx(p * t_s / 3600.0)


def test_slip_increases_drive_energy():
    no_slip = energy.rover_drive_energy_wh(2.0, 5.0, gravity=3.694, slip=0.0)
    slip = energy.rover_drive_energy_wh(2.0, 5.0, gravity=3.694, slip=0.5)
    assert slip == pytest.approx(2 * no_slip)


def test_solar_power_scales_with_irradiance_and_is_zero_in_shadow():
    g_ref = energy.PARAMS["solar_reference_irradiance"].value
    clean = 1.0 - energy.PARAMS["solar_dust_loss"].value
    assert energy.solar_power_w(g_ref) == pytest.approx(140.0 * clean)
    assert energy.solar_power_w(g_ref / 2) == pytest.approx(70.0 * clean)
    assert energy.solar_power_w(g_ref, in_shadow=True) == 0.0
    assert energy.solar_power_w(0.0) == 0.0


def test_solar_power_vectorised_with_shadow_mask():
    g = np.array([0.0, 300.0, 600.0])
    shadow = np.array([False, True, False])
    p = energy.solar_power_w(g, in_shadow=shadow)
    assert p[0] == 0.0 and p[1] == 0.0 and p[2] > 0.0


def test_astronaut_metabolic_rate_spans_apollo_range():
    low = energy.astronaut_metabolic_w(0.0)
    high = energy.astronaut_metabolic_w(20.0)
    # 780 BTU/h ~ 228.6 W ~ 197 kcal/h ; 1200 BTU/h ~ 351.7 W ~ 302 kcal/h (Waligora et al. 1975)
    assert low == pytest.approx(228.6, abs=0.5)
    assert high == pytest.approx(351.7, abs=0.5)
    assert energy.w_to_kcal_per_h(low) == pytest.approx(197, abs=1)
    assert energy.w_to_kcal_per_h(high) == pytest.approx(302, abs=1)
    assert energy.astronaut_metabolic_w(30.0) == pytest.approx(high)  # clipped
    assert energy.astronaut_metabolic_w(-10.0) == pytest.approx(low)  # downhill = flat


def test_eva_consumables_budget_and_margin():
    # Suit consumables sized for the full EVA at the highest Apollo rate (worst case).
    budget = energy.eva_consumables_wh()
    assert budget == pytest.approx(4.0 * energy.astronaut_metabolic_w(90.0))  # 4 h EVA (PO v0.1)
    # 1 m at the assumed 1.0 m/s walking speed = 1 s of metabolic load.
    used = energy.astronaut_step_energy_wh(1.0, 0.0)
    assert used == pytest.approx(energy.astronaut_metabolic_w(0.0) / 3600.0)
