from marsx.bench import scorecard as sc
from marsx.contracts.run import EpisodeResult, Oracle
from marsx.contracts.suite import DEFAULT_PASS_CRITERIA


def eps(n_ok, n_fail, outcome_fail="timeout", family="jezero-v1/l1/rtg-geometry", start=0):
    out = []
    for i in range(n_ok + n_fail):
        out.append(EpisodeResult(
            index=start + i, seed=start + i, scenario_id=family, start=[0, 0], goal=[1, 1],
            outcome="success" if i < n_ok else outcome_fail, steps=3, path_m=4.0,
            oracle=Oracle(path_m=4.0, cost=4.0),
        ))
    return out


def verdict(level, episodes, verified=True):
    return sc.evaluate_level(level, episodes, DEFAULT_PASS_CRITERIA, verified=verified)


def test_l1_passes_at_80_percent():
    v = verdict("L1", eps(80, 20))
    assert v.passed and v.reasons == []


def test_l1_fails_below_80_percent_with_reason():
    v = verdict("L1", eps(79, 21))
    assert not v.passed
    assert any("success 0.79 < 0.80" in r for r in v.reasons)


def test_any_critical_violation_fails_the_level():
    v = verdict("L2", eps(99, 1, outcome_fail="collision", family="jezero-v1/l2/rtg"))
    assert not v.passed
    assert any("critical violation" in r for r in v.reasons)


def test_l2_threshold_is_70_percent():
    assert verdict("L2", eps(70, 30)).passed
    assert not verdict("L2", eps(69, 31)).passed


def test_l3_needs_wilson_lower_bound_per_family_and_min_episodes():
    good = eps(20, 0, family="f1") + eps(20, 0, family="f2", start=20)
    assert verdict("L3", good).passed
    # 14/20 -> Wilson lower 0.481 < 0.60
    weak = eps(20, 0, family="f1") + eps(14, 6, family="f2", start=20)
    v = verdict("L3", weak)
    assert not v.passed and any("f2" in r and "Wilson" in r for r in v.reasons)
    small = eps(19, 0, family="f1")
    v = verdict("L3", small)
    assert not v.passed and any("n=19 < 20" in r for r in v.reasons)


def test_unverified_run_never_gets_a_level():
    v = verdict("L1", eps(100, 0), verified=False)
    assert not v.passed and any("Not verifiable" in r for r in v.reasons)


def test_empty_level_fails():
    assert not verdict("L1", []).passed


def test_seal_requires_all_lower_levels():
    passed = {"L1": True, "L2": True, "L3": False}
    assert sc.seal(passed, "v0.1") == (
        "Passed MARS-X First Filter · L2 · suite v0.1 · simulation only — necessary, not sufficient."
    )
    assert sc.seal({"L1": False, "L2": True}, "v0.1") is None
    assert sc.seal({}, "v0.1") is None


def test_not_covered_list_is_fixed_po_list():
    assert len(sc.NOT_COVERED) == 9
    assert sc.NOT_COVERED[0].startswith("Wheel-soil interaction")


def test_contract_scorecard_object():
    card = sc.to_contract({"L1": True, "L2": False}, "v0.1")
    assert card.thresholds_version == "v0.1" and card.passed == {"L1": True, "L2": False}


def test_no_forbidden_marketing_terms_in_fixed_texts():
    texts = " ".join([sc.SEAL_TEMPLATE, sc.DISCLAIMER, *sc.NOT_COVERED]).lower()
    for term in ("trl", "validated", "certified", "flight-ready", "mission-ready", "mars-ready",
                 "digital twin", "nasa-approved"):
        assert term not in texts
