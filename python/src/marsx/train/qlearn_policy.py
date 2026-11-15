"""Tabular Q-learning as a benchmark baseline (bench Policy protocol).

For every episode a fresh Q-table is trained on a crop of the known cost map around start and goal, with a
fixed budget, and the greedy route is replayed. Real learning, but it learns ONE route per episode and does not
generalise; it also cannot see hidden rocks. Episodes it cannot solve within the budget are left to time out.
"""

from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np

from marsx.bench.policies import _SequencePolicy
from marsx.contracts.suite import EpisodeSpec
from marsx.nav import path_to_actions
from marsx.train import qlearn


class QLearningPolicy(_SequencePolicy):
    name = "baseline/qlearning"

    def __init__(self, episodes: int = 20000, margin: int = 8, max_side: int = 160, seed: int = 0) -> None:
        super().__init__()
        self.episodes, self.margin, self.max_side, self.seed = episodes, margin, max_side, seed
        self.solved = 0

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        cost = np.asarray(getattr(env, "engine", env).cost, np.float64)
        H, W = cost.shape
        seqs = []
        for s in specs:
            (r0, c0), (r1, c1) = s.start, s.goal
            top, left = max(0, min(r0, r1) - self.margin), max(0, min(c0, c1) - self.margin)
            bottom, right = min(H, max(r0, r1) + self.margin + 1), min(W, max(c0, c1) + self.margin + 1)
            if bottom - top > self.max_side or right - left > self.max_side:
                seqs.append(np.zeros(0, np.int64))  # outside the tabular budget: counted as a failure (timeout)
                continue
            crop = cost[top:bottom, left:right]
            st, gl = (r0 - top, c0 - left), (r1 - top, c1 - left)
            q, _ = qlearn.train(crop, st, gl, episodes=self.episodes, seed=self.seed + s.index)
            path = qlearn.greedy_path(q, crop, st, gl)
            if path is None or len(path) < 2:
                seqs.append(np.zeros(0, np.int64))
                continue
            self.solved += 1
            seqs.append(path_to_actions(path + np.array([top, left])).astype(np.int64))
        self._set(seqs)
