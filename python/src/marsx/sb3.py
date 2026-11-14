"""Stable-Baselines3 adapter: exposes NavBatch as an SB3 VecEnv (same-step autoreset, no SubprocVecEnv).

SubprocVecEnv is rejected on Windows (slower for cheap envs and ``WinError 1455`` with CUDA torch; ADR-0005).
"""

from __future__ import annotations

import numpy as np
from gymnasium import spaces
from stable_baselines3.common.vec_env.base_vec_env import VecEnv

from marsx.contracts import obs as spec
from marsx.env.core import NavBatch


class SB3VecAdapter(VecEnv):
    def __init__(self, engine: NavBatch):
        if not engine.autoreset:
            raise ValueError("SB3 needs an autoresetting engine (NavBatch(autoreset=True))")
        self.engine = engine
        super().__init__(engine.N, spaces.Box(-1.0, 1.0, shape=(spec.OBS_DIM,), dtype=np.float32),
                         spaces.Discrete(spec.N_ACTIONS))
        self._actions = np.zeros(engine.N, np.int64)

    def reset(self):
        seeds = getattr(self, "_seeds", None)
        o = self.engine.reset(seed=seeds[0] if seeds and seeds[0] is not None else None)
        self._reset_seeds()
        self.reset_infos = [{} for _ in range(self.num_envs)]
        return o

    def step_async(self, actions):
        self._actions = np.asarray(actions, np.int64).reshape(self.num_envs)

    def step_wait(self):
        o, r, term, trunc, info = self.engine.step(self._actions)
        done = term | trunc
        infos: list[dict] = [{} for _ in range(self.num_envs)]
        for i in np.flatnonzero(done):
            infos[i] = {"terminal_observation": info["final_obs"][i],
                        "TimeLimit.truncated": bool(trunc[i] and not term[i]),
                        "outcome": info["outcome"][i], "pathM": float(info["pathM"][i]),
                        "is_success": info["outcome"][i] == "success"}
        return o, r, done, infos

    def close(self):
        pass

    def get_attr(self, attr_name, indices=None):
        return [getattr(self.engine, attr_name)] * len(self._idx(indices))

    def set_attr(self, attr_name, value, indices=None):
        setattr(self.engine, attr_name, value)

    def env_method(self, method_name, *args, indices=None, **kwargs):
        return [getattr(self.engine, method_name)(*args, **kwargs)]

    def env_is_wrapped(self, wrapper_class, indices=None):
        return [False] * len(self._idx(indices))

    def _idx(self, indices):
        if indices is None:
            return range(self.num_envs)
        return [indices] if isinstance(indices, int) else list(indices)
