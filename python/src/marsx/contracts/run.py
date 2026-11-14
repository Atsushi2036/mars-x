"""run/1: a reproducible evaluation report (one file; validated by pydantic here and by zod in the web worker).

Reproducibility key: producer.marsxVersion + dataset.sha256 + scenario.sha256 + policy.sha256 + seeds.
"""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from marsx.contracts.scenario import Cell, Finite, Level
from marsx.contracts.traj import TrajectoryBlock
from marsx.schemas import Model, Sha256

MAX_EPISODES = 5_000
MAX_EVENTS = 1_000
MAX_BYTES = 10 * 1024 * 1024

Outcome = Literal["success", "collision", "hazard", "battery", "stuck", "spe_violation", "timeout"]
Short = Annotated[str, Field(max_length=96)]


class Producer(Model):
    marsx_version: Short
    git_sha: Short | None = None
    python: Short
    platform: Short


class SuiteRef(Model):
    id: Short
    version: Short
    level: Level
    split: Literal["train", "test"]
    root_seed: int = Field(ge=0, lt=2**63)


class DatasetRef(Model):
    id: Short
    sha256: Sha256
    layers: dict[str, Sha256] = Field(default_factory=dict, max_length=64)


class ScenarioRef(Model):
    id: Short
    sha256: Sha256


class PolicyRef(Model):
    name: Short
    kind: Literal["onnx", "python", "baseline"]
    sha256: Sha256 | None = None
    contract: Literal["policy/1"] = "policy/1"
    obs_spec: Literal["obs/1"] = "obs/1"


class ConditionsSummary(Model):
    meda_sols: list[int] = Field(default_factory=list, max_length=8)
    tau: Finite | None = None
    gravity: Finite
    owlt_min: Finite | None = None


class Oracle(Model):
    path_m: Finite = Field(ge=0)
    cost: Finite = Field(ge=0)
    energy_wh: Finite | None = None


class Risk(Model):
    time_slope_gt15_s: Finite = Field(default=0, ge=0)
    min_hazard_dist_m: Finite | None = None


class Event(Model):
    t: Finite = Field(ge=0)
    type: Literal["rockRevealed", "uplink", "speAlert", "shelterReached", "stuck", "batteryLow", "replan"]
    cell: Cell | None = None


class EpisodeResult(Model):
    index: int = Field(ge=0)
    seed: int = Field(ge=0, lt=2**63)
    scenario_id: Short | None = None
    start: Cell
    goal: Cell
    outcome: Outcome
    steps: int = Field(ge=0, le=20_000)
    path_m: Finite = Field(ge=0)
    energy_wh: Finite | None = None
    oracle: Oracle | None = None
    risk: Risk = Risk()
    violations: int = Field(default=0, ge=0)
    events: list[Event] = Field(default_factory=list, max_length=MAX_EVENTS)
    trajectory: TrajectoryBlock | None = None


class Metrics(Model):
    n: int = Field(ge=0)
    success: Finite = Field(ge=0, le=1)
    success_ci95: Annotated[list[Finite], Field(min_length=2, max_length=2)]
    spl: Finite | None = Field(default=None, ge=0, le=1)
    energy_ratio: Finite | None = None
    violations: int = Field(default=0, ge=0)
    mean_path_m: Finite | None = None


class Scorecard(Model):
    thresholds_version: Short
    passed: dict[str, bool] = Field(default_factory=dict, max_length=8)


class Run(Model):
    schema_version: Literal["run/1"] = "run/1"
    run_id: Short
    created_utc: Short
    producer: Producer
    suite: SuiteRef
    dataset: DatasetRef
    scenario: ScenarioRef
    policy: PolicyRef
    conditions: ConditionsSummary
    episodes: list[EpisodeResult] = Field(max_length=MAX_EPISODES)
    metrics: Metrics
    scorecard: Scorecard | None = None
