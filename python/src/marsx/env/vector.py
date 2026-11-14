"""NumPy-vectorised Gymnasium VectorEnv: thousands of episodes per call, no subprocesses.

Interface agreed with marsx.bench (T5):
- autoreset NEXT_STEP (Gymnasium 1.x default): the step after an env ends resets it (random episode) and
  ignores its action; reward 0, terminated/truncated False, outcome "".
- ``reset(seed=int | list[int], options={"episodes": list[EpisodeSpec], "scenario": Scenario, "rockSeed": int})``:
  env i starts at episodes[i] (start, goal; cells of the full planning grid). A new scenario rebuilds the engine.
  Hidden rocks are one fixed field per engine, seeded by ``rockSeed`` (default 20261115).
- info arrays every step: cell int[N,2], tS, soc, energyWh, pathM, outcome object[N] ("" while running),
  violations, timeSlopeGt15S, plus pathCost, steps, outcomeCode, shieldInterventions.
"""

from __future__ import annotations

import numpy as np
from gymnasium import spaces
from gymnasium.vector import AutoresetMode, VectorEnv
from gymnasium.vector.utils import batch_space

from marsx.contracts import obs as spec
from marsx.contracts.scenario import Scenario
from marsx.contracts.suite import EpisodeSpec
from marsx.env._build import fit_window, resolve_scenario, resolve_terrain
from marsx.env.core import DEFAULT_ROCK_SEED, NavBatch


class JezeroVecEnv(VectorEnv):
    metadata = {"render_modes": [], "autoreset_mode": AutoresetMode.NEXT_STEP}

    def __init__(self, num_envs: int = 1, scenario=None, terrain=None, **engine_kwargs):
        self.num_envs = int(num_envs)
        self.terrain = resolve_terrain(terrain)
        self._kwargs = engine_kwargs
        self._build(fit_window(resolve_scenario(scenario), self.terrain), engine_kwargs.pop("rock_seed", DEFAULT_ROCK_SEED))
        self.single_observation_space = spaces.Box(-1.0, 1.0, shape=(spec.OBS_DIM,), dtype=np.float32)
        self.single_action_space = spaces.Discrete(spec.N_ACTIONS)
        self.observation_space = batch_space(self.single_observation_space, self.num_envs)
        self.action_space = batch_space(self.single_action_space, self.num_envs)

    def _build(self, scenario: Scenario, rock_seed: int) -> None:
        self.scenario, self.rock_seed = scenario, rock_seed
        self.engine = NavBatch(self.terrain, scenario, num_envs=self.num_envs, seed=None, autoreset=False,
                               rock_seed=rock_seed, **self._kwargs)
        self._needs_reset = np.zeros(self.num_envs, bool)

    def reset(self, *, seed=None, options=None):
        options = options or {}
        sc = options.get("scenario")
        rock_seed = int(options.get("rockSeed", self.rock_seed))
        if sc is not None:
            sc = fit_window(resolve_scenario(sc), self.terrain)
        if (sc is not None and sc.model_dump() != self.scenario.model_dump()) or rock_seed != self.rock_seed:
            self._build(sc or self.scenario, rock_seed)
        first = seed[0] if isinstance(seed, (list, tuple, np.ndarray)) else seed
        if first is not None:
            self._np_random_seed = int(first)
        self.engine.seed(first)
        eps = options.get("episodes")
        if eps is not None:
            eps = [e if isinstance(e, EpisodeSpec) else EpisodeSpec.model_validate(e) for e in eps]
            if len(eps) != self.num_envs:
                raise ValueError(f"need exactly num_envs={self.num_envs} episodes, got {len(eps)}")
            o = self.engine.reset_to(np.arange(self.num_envs), [e.start for e in eps], [e.goal for e in eps])
        else:
            o = self.engine.reset()
        self._needs_reset[:] = False
        return o, self.engine.info()

    def step(self, actions):
        resetting = self._needs_reset.copy()
        obs, rew, term, trunc, info = self.engine.step(np.asarray(actions), active=~resetting)
        if resetting.any():
            idx = np.flatnonzero(resetting)
            self.engine._sample(idx)
            obs[idx] = self.engine.observe(idx)
            info = self.engine.info(info["outcomeCode"] * ~resetting)
        self._needs_reset = term | trunc
        return obs, rew, term, trunc, info
