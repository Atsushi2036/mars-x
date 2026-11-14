"""scenario/1: one benchmark scenario (terrain window, agent, Mars conditions, reward weights).

Every physical number is a ``Param`` that states where it comes from:
``source`` (cited, ``ref`` required), ``computed`` (derived from cited numbers, ``ref`` required) or
``assumption`` (calibratable, shown as such in reports).
"""

from __future__ import annotations

import math
from typing import Annotated, Literal

from pydantic import Field, model_validator

from marsx.schemas import Model

Finite = Annotated[float, Field(allow_inf_nan=False)]
Cell = Annotated[list[int], Field(min_length=2, max_length=2)]
Level = Literal["L1", "L2", "L3"]

NSSDC_MARS = "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html"
NASA_ROVER = "https://science.nasa.gov/mission/mars-2020-perseverance/rover-components/"
NASA_BLOG_2026 = "https://science.nasa.gov/blog/tracks-along-the-longest-drive-on-another-world/"
NESC_SPE = "https://ntrs.nasa.gov/api/citations/20210014156/downloads/Parker%20el%20al.%20Helio%202050%20workshop%20poster_final.pdf"


class Param(Model):
    value: Finite
    unit: str = Field(max_length=32)
    provenance: Literal["source", "computed", "assumption"]
    ref: str | None = Field(default=None, max_length=512)
    note: str | None = Field(default=None, max_length=512)

    @model_validator(mode="after")
    def _ref_required(self) -> Param:
        if self.provenance in ("source", "computed") and not self.ref:
            raise ValueError(f"provenance={self.provenance!r} requires ref")
        return self


def _jezero_gravity(lat_deg: float = 18.49) -> Param:
    g_eq, g_pole = 3.69, 3.73  # NSSDC: surface acceleration (eq), (pole)
    g = g_eq + (g_pole - g_eq) * math.sin(math.radians(lat_deg)) ** 2
    return Param(value=round(g, 4), unit="m/s2", provenance="computed", ref=NSSDC_MARS,
                 note="g_eq + (g_pole - g_eq) * sin^2(lat), lat 18.49 N (Jezero window centre)")


JEZERO_GRAVITY = _jezero_gravity()
SPE_WARNING_MIN = Param(value=30, unit="min", provenance="assumption", ref=NESC_SPE,
                        note="NESC recommends >= 30 min SEP warning; no NASA rule fixes EVA return time")


class Window(Model):
    dataset_id: str = Field(max_length=64)
    grid_id: str = Field(max_length=64)
    row0: int = Field(ge=0)
    col0: int = Field(ge=0)
    rows: int = Field(gt=0, le=4096)
    cols: int = Field(gt=0, le=4096)


class Agent(Model):
    kind: Literal["rtg_rover", "solar_rover", "astronaut"]
    max_slope_deg: Param
    max_step_m: Param
    speed_m_s: Param
    params: dict[str, Param] = Field(default_factory=dict)


class TimeSpec(Model):
    start_utc: str = Field(max_length=32)
    sols: Finite = Field(gt=0, le=30)


class CommSpec(Model):
    mode: Literal["none", "delayed", "one_plan_per_sol"] = "none"
    uplink_lmst_h: Finite | None = Field(default=None, ge=0, lt=24.7)


class SpeSpec(Model):
    enabled: bool = False
    warning_min: Param = SPE_WARNING_MIN


class RockSpec(Model):
    enabled: bool = False
    abundance_k: Param | None = None
    sensor_radius_m: Param | None = None


class Conditions(Model):
    gravity: Param = JEZERO_GRAVITY
    meda_sols: list[int] = Field(default_factory=list, max_length=8)
    tau: Param | None = None
    comm: CommSpec = CommSpec()
    spe: SpeSpec = SpeSpec()
    hidden_rocks: RockSpec = RockSpec()
    lighting: bool = False
    energy: bool = False
    slip: bool = False


class RewardWeights(Model):
    energy: Finite = 0.0
    risk: Finite = 0.0
    time: Finite = 0.0
    progress: Finite = 0.3
    goal: Finite = 10.0
    failure: Finite = 10.0
    hazard_attempt: Finite = 1.0
    step_cost: Finite = 0.1


class Scenario(Model):
    schema_version: Literal["scenario/1"] = "scenario/1"
    id: str = Field(max_length=96, pattern=r"^[a-z0-9][a-z0-9_./-]*$")
    title: str = Field(max_length=160)
    level: Level
    window: Window
    agent: Agent
    time: TimeSpec | None = None
    conditions: Conditions = Conditions()
    reward: RewardWeights = RewardWeights()
    max_steps: int = Field(default=600, gt=0, le=20_000)
    start: Cell | None = None
    goal: Cell | None = None
