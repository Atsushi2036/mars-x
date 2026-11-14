"""Built-in scenario/1 definitions used by the environment when only an id is given.

The official benchmark suite (marsx.bench) may define more; any ``Scenario`` object can be passed directly.
"""

from __future__ import annotations

from marsx.contracts.scenario import (
    NASA_BLOG_2026,
    NASA_ROVER,
    Agent,
    CommSpec,
    Conditions,
    Param,
    RockSpec,
    Scenario,
    SpeSpec,
    TimeSpec,
    Window,
)

LEMMON_2022 = "Lemmon et al. 2022, GRL 49(17) e2022GL100126, doi:10.1029/2022GL100126 (peak visible tau ~2, 5-11 Jan 2022)"

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
_SOLAR = Agent(
    kind="solar_rover",
    max_slope_deg=Param(value=24, unit="deg", provenance="assumption", note="generic solar rover; Perseverance limit reused"),
    max_step_m=Param(value=0.525, unit="m", provenance="assumption", note="Perseverance wheel diameter reused"),
    speed_m_s=Param(value=0.042, unit="m/s", provenance="assumption", note="Perseverance top speed reused"),
)
# 09:00 LTST at Jezero (Mars24): aphelion clear season (Ls 74.5) and inside the Jan-2022 regional storm (Ls 153.8).
_CLEAR = TimeSpec(start_utc="2021-07-20T15:09:00Z", sols=1)
_STORM = TimeSpec(start_utc="2022-01-07T04:14:50Z", sols=1)  # 09:00 LTST, sol 314 (Ls 153.8); tables 314-315
_TAU_CLEAR = Param(value=0.3, unit="-", provenance="assumption",
                   note="aphelion-season dust opacity; MEDA gives no per-sol tau for sol 148")
_TAU_STORM = Param(value=2.0, unit="-", provenance="source", ref=LEMMON_2022)
_ROCKS = RockSpec(enabled=True, abundance_k=Param(value=0.05, unit="fraction", provenance="assumption"),
                  sensor_radius_m=Param(value=8, unit="m", provenance="assumption"))
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
                 conditions=Conditions(hidden_rocks=_ROCKS)),
        Scenario(id="jezero-v1/l2/solar-clear", title="L2 conditions - solar rover, clear aphelion sol", level="L2",
                 window=_WINDOW, agent=_SOLAR, time=_CLEAR, max_steps=800,
                 conditions=Conditions(tau=_TAU_CLEAR, meda_sols=[148], lighting=True, energy=True)),
        Scenario(id="jezero-v1/l2/solar-storm", title="L2 conditions - solar rover, Jan-2022 dust storm", level="L2",
                 window=_WINDOW, agent=_SOLAR, time=_STORM, max_steps=800,
                 conditions=Conditions(tau=_TAU_STORM, meda_sols=[314, 315], lighting=True, energy=True)),
        Scenario(id="jezero-v1/l2/rtg-storm", title="L2 conditions - RTG rover, Jan-2022 dust storm", level="L2",
                 window=_WINDOW, agent=_ROVER, time=_STORM, max_steps=800,
                 conditions=Conditions(tau=_TAU_STORM, meda_sols=[314, 315], lighting=True, energy=True)),
        Scenario(id="jezero-v1/l2/astronaut-clear", title="L2 conditions - astronaut EVA with space-weather alert",
                 level="L2", window=_WINDOW, agent=_ASTRONAUT, time=_CLEAR, max_steps=800,
                 conditions=Conditions(tau=_TAU_CLEAR, meda_sols=[148], lighting=True, energy=True, spe=SpeSpec(enabled=True))),
        Scenario(id="jezero-v1/l3/rtg-onesol", title="L3 autonomy - hidden rocks, one plan per sol", level="L3",
                 window=_WINDOW, agent=_ROVER, time=_CLEAR, max_steps=800,
                 conditions=Conditions(tau=_TAU_CLEAR, meda_sols=[148], lighting=True, energy=True, hidden_rocks=_ROCKS,
                                       comm=CommSpec(mode="one_plan_per_sol", uplink_lmst_h=9.0))),
    )
}


def get(scenario_id: str) -> Scenario:
    try:
        return _BUILTIN[scenario_id]
    except KeyError:
        raise KeyError(f"unknown scenario {scenario_id!r}; built-in: {sorted(_BUILTIN)}") from None


def ids() -> list[str]:
    return sorted(_BUILTIN)
