"""Test double of JezeroVecEnv (gymnasium VectorEnv surface agreed for T5: reset(seed, options), info arrays)."""

from __future__ import annotations

import numpy as np
import pytest

from marsx.contracts.obs import ACTIONS, OBS_DIM, WAIT

OUTCOMES = ("running", "success", "collision", "battery", "stuck", "spe_violation", "timeout")
_D = np.array([(a.drow, a.dcol) for a in ACTIONS], dtype=np.int64)


class FakeNavBatch:
    """Deterministic grid world: refuses moves into blocked cells, collides on rocks, times out."""

    def __init__(self, cost: np.ndarray, num_envs: int, max_steps: int = 50, rocks=None, speed=0.042, res=2.0):
        self.cost = cost
        self.num_envs = num_envs
        self.max_steps = max_steps
        self.rocks = np.zeros(cost.shape, bool) if rocks is None else rocks
        self.speed, self.res = speed, res
        n = num_envs
        self.rc = np.zeros((n, 2), np.int64)
        self.goal = np.zeros((n, 2), np.int64)
        self.t_s = np.zeros(n)
        self.path_m = np.zeros(n)
        self.soc = np.ones(n, np.float32)
        self.steps = np.zeros(n, np.int64)
        self.seeds_seen: list = []
        self.engine = self  # JezeroVecEnv exposes the NumPy engine (cost map) as .engine

    def _obs(self):
        o = np.zeros((self.num_envs, OBS_DIM), np.float32)
        o[:, 0:2] = (self.goal - self.rc) / 64.0
        return o

    def reset(self, *, seed=None, options=None):
        eps = options["episodes"]
        assert len(eps) == self.num_envs
        self.rc[:] = [e.start for e in eps]
        self.goal[:] = [e.goal for e in eps]
        for arr in (self.t_s, self.path_m, self.steps):
            arr[:] = 0
        self.soc[:] = 1.0
        self.seeds_seen.append(list(seed) if isinstance(seed, list) else seed)
        return self._obs(), self._info(np.zeros(self.num_envs, np.int64))

    def _info(self, outcome):
        return {"cell": self.rc.copy(), "tS": self.t_s.copy(), "soc": self.soc.copy(),
                "energyWh": self.path_m * 0.5, "pathM": self.path_m.copy(),
                "outcome": np.array([OUTCOMES[k] if k else "" for k in outcome], dtype=object),
                "violations": (outcome == 2).astype(np.int64), "timeSlopeGt15S": np.zeros(self.num_envs)}

    def step(self, actions):
        a = np.asarray(actions, dtype=np.int64)
        d = _D[a]
        new = self.rc + d
        h, w = self.cost.shape
        inside = (new[:, 0] >= 0) & (new[:, 0] < h) & (new[:, 1] >= 0) & (new[:, 1] < w)
        newc = np.clip(new, 0, [h - 1, w - 1])
        ok = inside & np.isfinite(self.cost[newc[:, 0], newc[:, 1]]) & (a != WAIT)
        dist = np.where(ok, self.res * np.hypot(d[:, 0], d[:, 1]), 0.0)
        self.rc = np.where(ok[:, None], newc, self.rc)
        self.path_m += dist
        self.t_s += np.where(ok, dist / self.speed, 60.0)
        self.soc = (self.soc - np.where(ok, 0.001, 0.0)).astype(np.float32)
        self.steps += 1
        outcome = np.zeros(self.num_envs, np.int64)
        hit = self.rocks[self.rc[:, 0], self.rc[:, 1]]
        at_goal = np.all(self.rc == self.goal, axis=1)
        outcome[self.steps >= self.max_steps] = OUTCOMES.index("timeout")
        outcome[at_goal] = OUTCOMES.index("success")
        outcome[hit] = OUTCOMES.index("collision")
        term = (outcome == 1) | (outcome == 2)
        trunc = outcome == OUTCOMES.index("timeout")
        trunc &= ~term
        return self._obs(), np.zeros(self.num_envs), term, trunc, self._info(outcome)


@pytest.fixture
def grid():
    c = np.ones((40, 40), np.float32)
    c[10, 5:30] = np.inf
    return c


@pytest.fixture
def make_env(grid):
    def _make(scenario, num_envs, **kw):
        return FakeNavBatch(grid, num_envs, max_steps=scenario.max_steps if scenario.max_steps < 200 else 60, **kw)

    return _make
