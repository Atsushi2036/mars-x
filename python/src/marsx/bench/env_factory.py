"""Builds the official vectorised env (JezeroVecEnv) for the runner, sharing one loaded terrain."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Any

from marsx.contracts.scenario import Scenario


@lru_cache(maxsize=4)
def load_terrain_cached(data_dir: str | Path) -> Any:
    from marsx.env.terrain import load_terrain

    return load_terrain(Path(data_dir))


def vec_env_factory(data_dir: str | Path, **engine_kwargs: Any):
    """``make_env(scenario, num_envs)`` for :func:`marsx.bench.runner.run_episodes`."""
    terrain = load_terrain_cached(str(data_dir))

    def make_env(scenario: Scenario, num_envs: int) -> Any:
        from marsx.env.vector import JezeroVecEnv

        return JezeroVecEnv(num_envs=num_envs, scenario=scenario, terrain=terrain, **engine_kwargs)

    return make_env
