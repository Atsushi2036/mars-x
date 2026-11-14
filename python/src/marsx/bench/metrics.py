"""Scorecard metrics computed from episode results (never from self-reported numbers).

- Success rate with the Wilson score interval (95 %).
- SPL, Success weighted by Path Length (Anderson et al. 2018, arXiv:1807.06757):
  SPL = 1/N * sum_i S_i * l_i / max(p_i, l_i), l_i = oracle shortest path length, p_i = agent path length.
- Energy / oracle energy over successful episodes.
- Critical violations (PO v0.1): any one fails the level.
- Shelter-rule compliance over episodes that received an SPE alert.

Values are rounded to 6 decimals so recomputation is bit-stable across platforms.
"""

from __future__ import annotations

import math
from collections import Counter, defaultdict
from collections.abc import Sequence

from marsx.contracts.run import EpisodeResult, Metrics

Z95 = 1.959963984540054
CRITICAL_OUTCOMES = frozenset({"collision", "hazard", "battery", "spe_violation"})
NDIGITS = 6


def _r(x: float | None) -> float | None:
    return None if x is None else round(float(x), NDIGITS)


def wilson_ci95(successes: int, n: int) -> tuple[float, float]:
    if n == 0:
        return (0.0, 1.0)
    p = successes / n
    z2 = Z95 * Z95
    denom = 1.0 + z2 / n
    centre = (p + z2 / (2 * n)) / denom
    half = Z95 / denom * math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))
    return (round(max(0.0, centre - half), NDIGITS), round(min(1.0, centre + half), NDIGITS))


def is_success(e: EpisodeResult) -> bool:
    return e.outcome == "success" and e.violations == 0


def is_critical(e: EpisodeResult) -> bool:
    return e.outcome in CRITICAL_OUTCOMES or e.violations > 0


def spl(episodes: Sequence[EpisodeResult]) -> float | None:
    if not episodes or any(e.oracle is None for e in episodes):
        return None
    total = 0.0
    for e in episodes:
        if not is_success(e):
            continue
        l_opt = e.oracle.path_m  # type: ignore[union-attr]
        denom = max(e.path_m, l_opt)
        total += 1.0 if denom == 0 else l_opt / denom
    return _r(total / len(episodes))


def energy_ratio(episodes: Sequence[EpisodeResult]) -> float | None:
    ratios = [
        e.energy_wh / e.oracle.energy_wh
        for e in episodes
        if is_success(e) and e.energy_wh is not None and e.oracle is not None
        and e.oracle.energy_wh is not None and e.oracle.energy_wh > 0
    ]
    return _r(sum(ratios) / len(ratios)) if ratios else None


def alert_compliance(episodes: Sequence[EpisodeResult]) -> float | None:
    alerted = [e for e in episodes if any(ev.type == "speAlert" for ev in e.events)]
    if not alerted:
        return None
    return _r(sum(e.outcome != "spe_violation" for e in alerted) / len(alerted))


def failure_taxonomy(episodes: Sequence[EpisodeResult]) -> dict[str, int]:
    return dict(sorted(Counter(e.outcome for e in episodes if not is_success(e)).items()))


def compute_metrics(episodes: Sequence[EpisodeResult]) -> Metrics:
    n = len(episodes)
    s = sum(is_success(e) for e in episodes)
    ok_paths = [e.path_m for e in episodes if is_success(e)]
    return Metrics(
        n=n,
        success=_r(s / n) if n else 0.0,
        success_ci95=list(wilson_ci95(s, n)),
        spl=spl(episodes),
        energy_ratio=energy_ratio(episodes),
        violations=sum(is_critical(e) for e in episodes),
        mean_path_m=_r(sum(ok_paths) / len(ok_paths)) if ok_paths else None,
    )


def by_family(episodes: Sequence[EpisodeResult]) -> dict[str, Metrics]:
    groups: dict[str, list[EpisodeResult]] = defaultdict(list)
    for e in episodes:
        groups[e.scenario_id or "default"].append(e)
    return {k: compute_metrics(v) for k, v in sorted(groups.items())}
