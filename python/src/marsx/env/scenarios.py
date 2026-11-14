"""Built-in scenario/1 definitions used by the environment when only an id is given.

The official benchmark suite (marsx.bench) may define more; any ``Scenario`` object can be passed directly.
"""

from __future__ import annotations

from marsx.contracts.scenario import (
    NASA_BLOG_2026,
    NASA_ROVER,
    Agent,
    Conditions,
    Param,
    RockSpec,
    Scenario,
    Window,
)

_ROVER = Agent(
    kind="rtg_rover",
    max_slope_deg=Param(value=24, unit="deg", provenance="source", ref=NASA_BLOG_2026,
                        note="Perseverance tilt limit raised to 24 deg (Oct 2026)"),
    max_step_m=Param(value=0.525, unit="m", provenance="source", ref=NASA_ROVER, note="wheel diameter"),
    speed_m_s=Param(value=0.042, unit="m/s", provenance="source", ref=NASA_ROVER, note="152 m/h top speed"),
)
_ASTRONAUT = Agent(
    kind="astronaut",
    max_slope_deg=Param(value=15, unit="deg", provenance="assumption", note="PO decision v0.1"),
    max_step_m=Param(value=0.3, unit="m", provenance="assumption"),
    speed_m_s=Param(value=1.0, unit="m/s", provenance="assumption"),
    params={"evaDuration": Param(value=4, unit="h", provenance="assumption", note="PO decision v0.1")},
)
_WINDOW = Window(dataset_id="jezero-v1", grid_id="plan", row0=0, col0=0, rows=1024, cols=1024)

_BUILTIN = {
    s.id: s
    for s in (
        Scenario(id="jezero-v1/l1/rtg-geometry", title="L1 geometry - RTG rover", level="L1", window=_WINDOW,
                 agent=_ROVER, max_steps=600),
        Scenario(id="jezero-v1/l1/astronaut-geometry", title="L1 geometry - astronaut", level="L1", window=_WINDOW,
                 agent=_ASTRONAUT, max_steps=600),
        Scenario(id="jezero-v1/l3/rtg-hidden-rocks", title="L3 autonomy - RTG rover with hidden rocks", level="L3",
                 window=_WINDOW, agent=_ROVER, max_steps=800,
                 conditions=Conditions(hidden_rocks=RockSpec(
                     enabled=True,
                     abundance_k=Param(value=0.05, unit="fraction", provenance="assumption"),
                     sensor_radius_m=Param(value=8, unit="m", provenance="assumption")))),
    )
}


def get(scenario_id: str) -> Scenario:
    try:
        return _BUILTIN[scenario_id]
    except KeyError:
        raise KeyError(f"unknown scenario {scenario_id!r}; built-in: {sorted(_BUILTIN)}") from None


def ids() -> list[str]:
    return sorted(_BUILTIN)
