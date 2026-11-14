import pytest

from marsx.bench import metrics as m
from marsx.contracts.run import EpisodeResult, Event, Oracle


def ep(i, outcome="success", path=10.0, oracle_path=8.0, energy=None, oracle_energy=None, violations=0,
       events=(), scenario="jezero-v1/l2/rtg"):
    return EpisodeResult(
        index=i, seed=i, scenario_id=scenario, start=[0, 0], goal=[1, 1], outcome=outcome, steps=5,
        path_m=path, energy_wh=energy,
        oracle=Oracle(path_m=oracle_path, cost=oracle_path, energy_wh=oracle_energy),
        violations=violations, events=list(events),
    )


def test_wilson_interval_known_values():
    lo, hi = m.wilson_ci95(1, 1)
    assert lo == pytest.approx(0.2065, abs=1e-4) and hi == pytest.approx(1.0)
    lo, hi = m.wilson_ci95(80, 100)
    assert lo == pytest.approx(0.7112, abs=1e-3) and hi == pytest.approx(0.8666, abs=1e-3)
    assert m.wilson_ci95(0, 0) == (0.0, 1.0)


def test_spl_anderson_2018():
    # SPL = 1/N sum S_i * l_i / max(p_i, l_i)
    eps = [ep(0, path=10, oracle_path=8), ep(1, path=6, oracle_path=8), ep(2, outcome="timeout", path=3, oracle_path=8)]
    assert m.spl(eps) == pytest.approx((0.8 + 1.0 + 0.0) / 3)


def test_spl_requires_oracle_for_every_episode():
    e = ep(0)
    e2 = e.model_copy(update={"oracle": None})
    assert m.spl([e, e2]) is None


def test_energy_ratio_over_successful_episodes_with_oracle_energy():
    eps = [ep(0, energy=12, oracle_energy=10), ep(1, energy=30, oracle_energy=10),
           ep(2, outcome="battery", energy=99, oracle_energy=10), ep(3)]
    assert m.energy_ratio(eps) == pytest.approx((1.2 + 3.0) / 2)
    assert m.energy_ratio([ep(0)]) is None


def test_critical_violation_detection():
    assert m.is_critical(ep(0, outcome="collision"))
    assert m.is_critical(ep(0, outcome="hazard"))
    assert m.is_critical(ep(0, outcome="battery"))
    assert m.is_critical(ep(0, outcome="spe_violation"))
    assert m.is_critical(ep(0, outcome="success", violations=1))
    assert not m.is_critical(ep(0, outcome="timeout"))
    assert not m.is_critical(ep(0, outcome="stuck"))


def test_alert_compliance():
    alert = Event(t=10, type="speAlert")
    eps = [ep(0, events=[alert]), ep(1, outcome="spe_violation", events=[alert]), ep(2)]
    assert m.alert_compliance(eps) == pytest.approx(0.5)
    assert m.alert_compliance([ep(2)]) is None


def test_compute_metrics_contract_object():
    eps = [ep(0), ep(1), ep(2, outcome="collision"), ep(3, outcome="timeout")]
    met = m.compute_metrics(eps)
    assert met.n == 4
    assert met.success == pytest.approx(0.5)
    assert met.success_ci95 == pytest.approx(list(m.wilson_ci95(2, 4)))
    assert met.violations == 1
    assert met.spl == pytest.approx(0.8 * 2 / 4)
    assert met.mean_path_m == pytest.approx(10.0)


def test_failure_taxonomy_and_families():
    eps = [ep(0), ep(1, outcome="collision", scenario="a"), ep(2, outcome="collision", scenario="a"),
           ep(3, outcome="timeout", scenario="a")]
    tax = m.failure_taxonomy(eps)
    assert tax == {"collision": 2, "timeout": 1}
    fam = m.by_family(eps)
    assert set(fam) == {"jezero-v1/l2/rtg", "a"}
    assert fam["a"].n == 3 and fam["a"].success == 0.0


def test_metrics_round_to_stable_precision():
    met = m.compute_metrics([ep(0, path=10.123456789, oracle_path=8.0)])
    assert met.spl == round(8.0 / 10.123456789, 6)
