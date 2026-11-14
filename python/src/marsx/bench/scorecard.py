"""Level verdicts (PO v0.1) and the scorecard document.

Levels (MARS-X First Filter, simulation):
- Pre-check "Integration check": run re-simulated and verified (not a level).
- L1 Nominal navigation: success >= 0.80 and 0 critical violations.
- L2 Under Mars conditions: success >= 0.70 and 0 critical violations.
- L3 Consistent across sols & seeds: in EVERY family (scenario id), Wilson 95 % lower bound >= 0.60
  with n >= 20, and 0 critical violations.
A run that is not verifiable gets no level.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field

from marsx.bench import metrics as m
from marsx.contracts.run import EpisodeResult, Scorecard
from marsx.contracts.suite import PassCriterion

LEVELS = ("L1", "L2", "L3")
LEVEL_NAMES = {
    "L1": "Nominal navigation",
    "L2": "Under Mars conditions",
    "L3": "Consistent across sols & seeds",
}
PROGRAM = "MARS-X First Filter (simulation)"
SEAL_TEMPLATE = "Passed MARS-X First Filter · {level} · suite {version} · simulation only — necessary, not sufficient."
DISCLAIMER = "Uses NASA open data. Not affiliated with or endorsed by NASA, JPL or Caltech."
NOT_COVERED = (
    "Wheel-soil interaction (slip, sinkage) beyond a slope and thermal-inertia proxy",
    "Real sensor noise and localisation drift",
    "Sub-metre terrain (only statistical, synthetic rocks)",
    "Thermal and mechanical faults",
    "Flight software and its timing",
    "DSN and relay scheduling",
    "Local weather variability and dust devils",
    "Human factors beyond the EVA budget",
    "Terrain outside the crop",
)


@dataclass
class LevelVerdict:
    level: str
    passed: bool
    reasons: list[str] = field(default_factory=list)
    metrics: m.Metrics | None = None
    families: dict[str, m.Metrics] = field(default_factory=dict)

    def to_dict(self) -> dict[str, object]:
        return {
            "level": self.level,
            "name": LEVEL_NAMES.get(self.level, self.level),
            "passed": self.passed,
            "reasons": self.reasons,
            "metrics": self.metrics.model_dump(by_alias=True) if self.metrics else None,
            "families": {k: v.model_dump(by_alias=True) for k, v in self.families.items()},
        }


def _criteria_for(level: str, criteria: Iterable[PassCriterion]) -> list[PassCriterion]:
    return [c for c in criteria if c.level == level]


def evaluate_level(
    level: str, episodes: Sequence[EpisodeResult], criteria: Iterable[PassCriterion], verified: bool
) -> LevelVerdict:
    reasons: list[str] = []
    met = m.compute_metrics(episodes)
    fams = m.by_family(episodes)
    if not verified:
        reasons.append("Not verifiable: re-simulation did not reproduce the reported run")
    if not episodes:
        reasons.append("no episodes")
    if met.violations:
        reasons.append(f"{met.violations} critical violation(s) (any one fails the level)")
    for c in _criteria_for(level, criteria):
        if c.metric == "success":
            if met.n < c.min_episodes:
                reasons.append(f"n={met.n} < {c.min_episodes}")
            if met.success < c.threshold:
                reasons.append(f"success {met.success:.2f} < {c.threshold:.2f}")
        elif c.metric == "spl":
            if met.spl is None or met.spl < c.threshold:
                reasons.append(f"SPL {met.spl} < {c.threshold:.2f}")
        elif c.metric == "successWilson95Lower":
            for fam, fm in fams.items():
                if fm.n < c.min_episodes:
                    reasons.append(f"family {fam}: n={fm.n} < {c.min_episodes}")
                if fm.success_ci95[0] < c.threshold:
                    reasons.append(
                        f"family {fam}: Wilson 95% lower bound {fm.success_ci95[0]:.3f} < {c.threshold:.2f}"
                    )
    return LevelVerdict(level, not reasons, reasons, met, fams)


def seal(passed: Mapping[str, bool], suite_version: str) -> str | None:
    """Seal for the highest level L such that L and every lower level passed."""
    best = None
    for lv in LEVELS:
        if passed.get(lv):
            best = lv
        else:
            break
    return SEAL_TEMPLATE.format(level=best, version=suite_version) if best else None


def to_contract(passed: Mapping[str, bool], thresholds_version: str) -> Scorecard:
    return Scorecard(thresholds_version=thresholds_version, passed=dict(passed))



def build_report(runs: Sequence, verifications: Sequence, suite, suite_sha256: str) -> dict[str, object]:
    """Scorecard document (PO §1.4): header, verdict + seal, metrics per level/family, failures, limits.

    Levels are granted only from re-simulated episodes of verified runs.
    """
    from marsx.bench.verify import NOT_VERIFIABLE, VERIFIED, label

    all_ok = bool(runs) and all(v.status == VERIFIED for v in verifications)
    first = runs[0] if runs else None
    by_level = {r.suite.level: (r, v) for r, v in zip(runs, verifications)}
    levels, passed = [], {}
    for lv in LEVELS:
        if lv not in by_level:
            verdict = LevelVerdict(lv, False, ["not run"])
        else:
            run, ver = by_level[lv]
            eps = ver.episodes if ver.status == VERIFIED else run.episodes
            verdict = evaluate_level(lv, eps, suite.pass_criteria, verified=ver.status == VERIFIED)
        passed[lv] = verdict.passed
        levels.append(verdict.to_dict())
    version = next((c.version for c in suite.pass_criteria), "v0.1")
    return {
        "schemaVersion": "scorecard/1",
        "program": PROGRAM,
        "header": {
            "model": first.policy.name if first else None,
            "modelSha256": first.policy.sha256 if first else None,
            "via": first.policy.kind if first else None,
            "suite": {"id": suite.id, "version": suite.version, "sha256": suite_sha256},
            "marsx": {"version": first.producer.marsx_version, "gitSha": first.producer.git_sha} if first else None,
            "date": first.created_utc if first else None,
            "status": label(VERIFIED if all_ok else NOT_VERIFIABLE),
        },
        "verdict": {
            "precheck": {"name": "Integration check", "passed": all_ok,
                         "reasons": [f"{r.suite.level}: {x}" for r, v in zip(runs, verifications) for x in v.reasons]},
            "levels": levels,
            "seal": seal(passed, version) if all_ok else None,
            "thresholdsVersion": version,
        },
        "failureTaxonomy": {r.suite.level: m.failure_taxonomy(r.episodes) for r in runs},
        "alertCompliance": {r.suite.level: m.alert_compliance(r.episodes) for r in runs},
        "conditions": {r.suite.level: r.conditions.model_dump(by_alias=True, exclude_none=True) for r in runs},
        "reproducibility": {
            "rootSeed": suite.root_seed,
            "datasetSha256": suite.dataset_sha256,
            "runIds": {r.suite.level: r.run_id for r in runs},
            "command": "marsx evaluate --policy <model.onnx> --suite bench/jezero-v1/suite.json --level <L1|L2|L3>",
        },
        "notCovered": list(NOT_COVERED),
        "disclaimer": DISCLAIMER,
    }
