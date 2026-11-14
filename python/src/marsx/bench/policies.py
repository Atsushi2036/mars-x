"""Policies the benchmark can run: ONNX (policy/1), Python callables, baselines and action replays.

Protocol: ``begin(specs, env)`` is called once per batch (env i plays specs[i]); ``act(obs, info)`` gets the
obs/1 batch float32[N, 505] (and the env info arrays, e.g. ``cell`` = the rover's own localisation) and
returns act/1 indices int64[N]. Finished envs' actions are ignored.
"""

from __future__ import annotations

import hashlib
from collections.abc import Callable, Mapping, Sequence
from pathlib import Path
from typing import Any, Protocol

import numpy as np

from marsx.contracts import obs as obs_spec
from marsx.contracts import policy as policy_spec
from marsx.contracts.suite import EpisodeSpec
from marsx.nav import NavStatus, astar, path_to_actions


class Policy(Protocol):
    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None: ...
    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray: ...


class _SequencePolicy:
    """Plays one precomputed action sequence per env, then WAIT."""

    def __init__(self) -> None:
        self._seqs: list[np.ndarray] = []
        self._t = np.zeros(0, np.int64)

    def _set(self, seqs: list[np.ndarray]) -> None:
        self._seqs = seqs
        self._t = np.zeros(len(seqs), np.int64)

    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray:
        out = np.full(len(self._seqs), obs_spec.WAIT, np.int64)
        for i, s in enumerate(self._seqs):
            if self._t[i] < len(s):
                out[i] = s[self._t[i]]
        self._t += 1
        return out


class ActionReplayPolicy(_SequencePolicy):
    """Replays recorded actions by episode index (used by run.json verification)."""

    def __init__(self, actions_by_index: Mapping[int, np.ndarray]) -> None:
        super().__init__()
        self.actions = {int(k): np.asarray(v, np.int64) for k, v in actions_by_index.items()}

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        self._set([self.actions.get(s.index, np.zeros(0, np.int64)) for s in specs])


def astar_path(cost: np.ndarray, start: Sequence[int], goal: Sequence[int]) -> np.ndarray:
    res = astar(cost, (int(start[0]), int(start[1])), (int(goal[0]), int(goal[1])))
    return res.path if res.status == NavStatus.OK else np.zeros((0, 2), np.int32)


class AStarPolicy(_SequencePolicy):
    """Classical planner baseline: A* on the env's known cost map, no replanning (not machine learning)."""

    name = "baseline/astar"

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        cost = np.asarray(getattr(env, "engine", env).cost)  # JezeroVecEnv keeps the map in .engine
        seqs = []
        for s in specs:
            p = astar_path(cost, s.start, s.goal)
            seqs.append(path_to_actions(p).astype(np.int64) if len(p) > 1 else np.zeros(0, np.int64))
        self._set(seqs)


_STEP_TO_ACTION = {(a.drow, a.dcol): a.index for a in obs_spec.ACTIONS}


class AStarReplanPolicy:
    """Classical autonomy reference for L3: A* on the orbital (known) map, re-planned whenever the onboard
    sensor reveals a rock on the remaining path (rocks are read from the obs/1 ``revealedRocks`` channel).
    Not machine learning.
    """

    name = "baseline/astar-replan"

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        self.base = np.asarray(getattr(env, "engine", env).cost, dtype=np.float32)
        self.goals = [tuple(int(x) for x in s.goal) for s in specs]
        self.blocked: list[set[tuple[int, int]]] = [set() for _ in specs]
        self.paths: list[list[tuple[int, int]]] = [[] for _ in specs]
        k = obs_spec.PATCH_K
        self._rock_slice = slice(3 * k * k, 4 * k * k)
        self._k = k

    def _plan(self, i: int, cur: tuple[int, int]) -> None:
        cost = self.base
        if self.blocked[i]:
            cost = self.base.copy()
            rr, cc = zip(*self.blocked[i])
            cost[list(rr), list(cc)] = np.inf
        p = astar_path(cost, cur, self.goals[i])
        self.paths[i] = [tuple(int(x) for x in q) for q in p]

    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray:
        if info is None or "cell" not in info:
            raise ValueError("AStarReplanPolicy needs info['cell'] (rover localisation)")
        cells = np.asarray(info["cell"])
        k, c = self._k, self._k // 2
        out = np.full(len(self.goals), obs_spec.WAIT, np.int64)
        h, w = self.base.shape
        for i in range(len(self.goals)):
            cur = (int(cells[i, 0]), int(cells[i, 1]))
            if cur == self.goals[i]:
                continue
            seen = np.argwhere(obs[i, self._rock_slice].reshape(k, k) > 0.5)
            new_rocks = {(cur[0] + int(dr) - c, cur[1] + int(dc) - c) for dr, dc in seen}
            new_rocks = {q for q in new_rocks if 0 <= q[0] < h and 0 <= q[1] < w} - self.blocked[i]
            self.blocked[i] |= new_rocks
            path = self.paths[i]
            if cur in path:
                path = path[path.index(cur):]
            else:
                path = []
            if len(path) < 2 or any(q in self.blocked[i] for q in path[1:]):
                self._plan(i, cur)
                path = self.paths[i]
            self.paths[i] = path
            if len(path) >= 2:
                out[i] = _STEP_TO_ACTION.get((path[1][0] - cur[0], path[1][1] - cur[1]), obs_spec.WAIT)
        return out


class RandomPolicy:
    """Uniform random actions (lower bound)."""

    name = "baseline/random"

    def __init__(self, seed: int = 0) -> None:
        self.seed = seed

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        self.rng = np.random.default_rng(np.random.SeedSequence([self.seed, *(s.seed % 2**32 for s in specs[:1])]))

    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray:
        return self.rng.integers(0, obs_spec.N_ACTIONS, size=obs.shape[0]).astype(np.int64)


class CallablePolicy:
    """Wraps ``fn(obs float32[N, 505]) -> actions int[N]`` (e.g. a torch/SB3 model on CPU)."""

    def __init__(self, fn: Callable[[np.ndarray], np.ndarray], name: str = "python") -> None:
        self.fn, self.name = fn, name

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        pass

    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray:
        return np.asarray(self.fn(obs), dtype=np.int64).reshape(obs.shape[0])


class OnnxPolicy:
    """policy/1 ONNX model: input ``obs`` float32[batch, 505] -> ``logits`` float32[batch, 9]; argmax.

    Needs the ``train`` extra (onnxruntime). The model is data, never code: single thread, CPU only,
    size cap and forbidden control-flow ops checked before the session is created when ``onnx`` is present.
    """

    def __init__(self, path: str | Path) -> None:
        self.path = Path(path)
        data = self.path.read_bytes()
        if len(data) > policy_spec.MAX_BYTES:
            raise ValueError(f"ONNX model larger than {policy_spec.MAX_BYTES} bytes")
        self.sha256 = hashlib.sha256(data).hexdigest()
        self._check_graph(data)
        import onnxruntime as ort  # optional dependency (extra "train")

        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        so.inter_op_num_threads = 1
        self.session = ort.InferenceSession(data, sess_options=so, providers=["CPUExecutionProvider"])
        self.name = self.path.stem

    @staticmethod
    def _check_graph(data: bytes) -> None:
        try:
            import onnx
        except ImportError:
            return
        model = onnx.load_from_string(data)
        ops = {n.op_type for n in model.graph.node}
        bad = ops & policy_spec.FORBIDDEN_OPS
        if bad:
            raise ValueError(f"forbidden ONNX ops: {sorted(bad)}")
        if len(model.graph.node) > policy_spec.MAX_NODES:
            raise ValueError("too many ONNX nodes")
        for init in model.graph.initializer:
            if init.data_location == onnx.TensorProto.EXTERNAL:
                raise ValueError("external data is not allowed")

    def begin(self, specs: Sequence[EpisodeSpec], env: Any) -> None:
        pass

    def act(self, obs: np.ndarray, info: Mapping[str, Any] | None = None) -> np.ndarray:
        (logits,) = self.session.run([policy_spec.OUTPUT_NAME], {policy_spec.INPUT_NAME: obs.astype(np.float32)})
        return np.argmax(logits, axis=1).astype(np.int64)
