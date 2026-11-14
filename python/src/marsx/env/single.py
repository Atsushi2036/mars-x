"""Single-agent Gymnasium env (NavBatch with num_envs=1, so it matches the vector env exactly)."""

from __future__ import annotations

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from marsx.contracts import obs as spec
from marsx.env._build import fit_window, resolve_scenario, resolve_terrain
from marsx.env.core import NavBatch


class JezeroEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, scenario=None, terrain=None, **engine_kwargs):
        t = resolve_terrain(terrain)
        sc = fit_window(resolve_scenario(scenario), t)
        self.engine = NavBatch(t, sc, num_envs=1, seed=None, autoreset=False, **engine_kwargs)
        self.observation_space = spaces.Box(-1.0, 1.0, shape=(spec.OBS_DIM,), dtype=np.float32)
        self.action_space = spaces.Discrete(spec.N_ACTIONS)
        self.scenario = sc

    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)
        self.engine.seed(int(self.np_random.integers(0, 2**62)) if seed is None else seed)
        if options and "start" in options and "goal" in options:
            o = self.engine.reset_to([0], [options["start"]], [options["goal"]])
        else:
            o = self.engine.reset()
        return o[0], _scalar(self.engine.info())

    def step(self, action):
        o, r, term, trunc, info = self.engine.step(np.array([int(action)]))
        return o[0], float(r[0]), bool(term[0]), bool(trunc[0]), _scalar(info)


def _scalar(info: dict) -> dict:
    return {k: (tuple(int(x) for x in v[0]) if k == "cell" else v[0].item() if hasattr(v[0], "item") else v[0])
            for k, v in info.items()}
