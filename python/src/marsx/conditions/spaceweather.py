"""Space-weather shelter rule for the EVA astronaut ("training rule, not a forecast").

When a solar particle event (SPE/SEP) alert fires, the astronaut must reach a shelter within
N seconds. N defaults to 30 min: NESC/Helio 2050 recommends at least 30 min of warning and notes
operations with 10-30 min of warning (Parker et al.). No NASA standard fixing N for EVA was found,
so N is a team assumption exposed as a scenario parameter.

Alerts are scripted per official seed (or taken from a historical DONKI event id, recorded in
``AlertEvent.source``). States are sticky once SAFE or VIOLATED.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import ArrayLike, NDArray

from marsx.conditions.params import Param, assumption

LABEL = "training rule, not a forecast"
_PARKER = (
    "Parker et al., NESC / Helio 2050 workshop poster: "
    "https://ntrs.nasa.gov/api/citations/20210014156/downloads/Parker%20el%20al.%20Helio%202050%20workshop%20poster_final.pdf"
)

SHELTER_WINDOW = assumption(
    1800.0, "s", "time allowed to reach shelter after an SPE alert (N = 30 min)",
    note=f"30 min = minimum recommended warning; {_PARKER}",
)
P_ALERT = assumption(0.5, "-", "probability that an episode of the L2 astronaut family contains an alert")
EARLIEST_ALERT = assumption(600.0, "s", "no alert during the first 10 min of an EVA")

IDLE, ACTIVE, SAFE, VIOLATED = np.uint8(0), np.uint8(1), np.uint8(2), np.uint8(3)


@dataclass(frozen=True, slots=True)
class AlertEvent:
    t_s: float
    source: str  # "scripted" or "DONKI:<activityID>"

    def __post_init__(self) -> None:
        if not self.t_s >= 0.0:
            raise ValueError("alert time must be >= 0 s")
        if not self.source:
            raise ValueError("alert needs a source")

    def to_dict(self) -> dict[str, object]:
        return {"tS": self.t_s, "source": self.source, "label": LABEL}


def generate_alerts(
    seed: int,
    n_episodes: int,
    horizon_s: float,
    p_alert: float = P_ALERT.value,
    earliest_s: float = EARLIEST_ALERT.value,
) -> NDArray[np.float64]:
    """One alert time per episode (NaN = no alert), uniform in [earliest_s, horizon_s)."""
    if not 0.0 <= p_alert <= 1.0:
        raise ValueError("p_alert must be in [0, 1]")
    rng = np.random.default_rng(np.random.SeedSequence(seed))
    fires = rng.random(n_episodes) < p_alert
    t = rng.uniform(min(earliest_s, horizon_s), horizon_s, n_episodes)
    return np.where(fires, t, np.nan)


def update(
    state: NDArray[np.uint8],
    t_s: float | NDArray[np.float64],
    alert_t_s: NDArray[np.float64],
    in_shelter: NDArray[np.bool_],
    window_s: float = SHELTER_WINDOW.value,
) -> NDArray[np.uint8]:
    """Advance the rule for N agents at time t_s (vectorised, sticky terminal states)."""
    state = np.asarray(state, dtype=np.uint8).copy()
    t = np.asarray(t_s, dtype=np.float64)
    alert = np.asarray(alert_t_s, dtype=np.float64)
    open_ = (state == IDLE) | (state == ACTIVE)
    fired = ~np.isnan(alert) & (t >= alert)
    late = fired & (t > alert + window_s)
    state[open_ & fired] = ACTIVE
    state[open_ & fired & np.asarray(in_shelter, dtype=bool) & ~late] = SAFE
    state[open_ & late & (state == ACTIVE)] = VIOLATED
    return state


def compliant(
    alert_t_s: ArrayLike, shelter_arrival_t_s: ArrayLike, window_s: float = SHELTER_WINDOW.value
) -> NDArray[np.bool_]:
    """Post-hoc check per episode: no alert, or shelter reached within the window."""
    alert = np.asarray(alert_t_s, dtype=np.float64)
    arr = np.asarray(shelter_arrival_t_s, dtype=np.float64)
    with np.errstate(invalid="ignore"):
        on_time = (arr >= alert) & (arr <= alert + window_s)
    return np.isnan(alert) | on_time


def all_params() -> dict[str, Param]:
    return {"shelter_window": SHELTER_WINDOW, "p_alert": P_ALERT, "earliest_alert": EARLIEST_ALERT}
