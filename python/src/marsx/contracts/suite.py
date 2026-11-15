"""suite/1: a fixed-seed benchmark suite (levels, scenarios, pre-generated episodes, pass criteria)."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import Field

from marsx.contracts.scenario import Cell, Finite, Level
from marsx.schemas import Model, Sha256

MAX_SUITE_EPISODES = 20_000
# Seeds travel through JSON to JavaScript (IEEE double): exact integers in [0, 2^53 - 1].
MAX_SEED = 2**53 - 1
Seed = Annotated[int, Field(ge=0, le=MAX_SEED)]


class PassCriterion(Model):
    level: Level
    metric: Literal["success", "successWilson95Lower", "spl"]
    op: Literal[">="] = ">="
    threshold: Finite = Field(ge=0, le=1)
    min_episodes: int = Field(default=1, ge=1)
    version: str = Field(default="v0.1", max_length=16)


# Product-owner decision for v0.1 (2026-11-14).
DEFAULT_PASS_CRITERIA = (
    PassCriterion(level="L1", metric="success", threshold=0.80),
    PassCriterion(level="L2", metric="success", threshold=0.70),
    PassCriterion(level="L3", metric="successWilson95Lower", threshold=0.60, min_episodes=20),
)


class EpisodeSpec(Model):
    index: int = Field(ge=0)
    seed: Seed
    scenario_id: str = Field(max_length=96)
    start: Cell
    goal: Cell
    oracle_cost: Finite | None = None
    oracle_path_m: Finite | None = None


class LevelSpec(Model):
    level: Level
    scenario_ids: list[str] = Field(min_length=1, max_length=32)
    episodes: int = Field(gt=0, le=MAX_SUITE_EPISODES)


class Suite(Model):
    schema_version: Literal["suite/1"] = "suite/1"
    id: str = Field(max_length=64)
    version: str = Field(max_length=16)
    dataset_sha256: Sha256 | None = None
    root_seed: Seed
    split: Literal["train", "test"] = "test"
    levels: Annotated[list[LevelSpec], Field(min_length=1, max_length=8)]
    pass_criteria: list[PassCriterion] = Field(default_factory=lambda: list(DEFAULT_PASS_CRITERIA))
    episodes: list[EpisodeSpec] | None = Field(default=None, max_length=MAX_SUITE_EPISODES)
