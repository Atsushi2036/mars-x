"""traj/1: compact per-episode trajectory embedded in run.json as base64.

Binary layout (little-endian, structure of arrays, n = steps, 11 bytes per step):
    row    uint16[n]   offset 0
    col    uint16[n]   offset 2n
    t_s    uint32[n]   offset 4n     (seconds since episode start)
    soc    float16[n]  offset 8n     (state of charge / suit consumables, 0..1)
    action uint8[n]    offset 10n    (act/1 index)
``sha256`` is the hex digest of the decoded bytes.
Entries are STATES: entry k = state before action k (entry 0 = start), ``action[k]`` = action taken from it;
the last entry is the terminal state with ``action = WAIT`` (sentinel). So ``n = episode steps + 1``.
"""

from __future__ import annotations

import base64
from dataclasses import dataclass
from typing import Literal

import numpy as np
from pydantic import Field

from marsx.contracts.canonical import sha256_bytes
from marsx.schemas import Model, Sha256

BYTES_PER_STEP = 11
MAX_STEPS = 20_000
_FIELDS = (("row", "<u2"), ("col", "<u2"), ("t_s", "<u4"), ("soc", "<f2"), ("action", "u1"))


class TrajectoryBlock(Model):
    encoding: Literal["traj/1"] = "traj/1"
    steps: int = Field(ge=0, le=MAX_STEPS)
    data: str = Field(max_length=4 * ((MAX_STEPS * BYTES_PER_STEP + 2) // 3))
    sha256: Sha256


@dataclass
class TrajArrays:
    row: np.ndarray
    col: np.ndarray
    t_s: np.ndarray
    soc: np.ndarray
    action: np.ndarray

    @classmethod
    def empty(cls, n: int) -> TrajArrays:
        return cls(*(np.zeros(n, dtype=dt) for _, dt in _FIELDS))

    def __len__(self) -> int:
        return int(self.row.shape[0])


def encode(arrays: TrajArrays) -> TrajectoryBlock:
    n = len(arrays)
    raw = b"".join(np.ascontiguousarray(getattr(arrays, name), dtype=dt).tobytes() for name, dt in _FIELDS)
    assert len(raw) == BYTES_PER_STEP * n
    return TrajectoryBlock(steps=n, data=base64.b64encode(raw).decode("ascii"), sha256=sha256_bytes(raw))


def raw_bytes(block: TrajectoryBlock) -> bytes:
    raw = base64.b64decode(block.data, validate=True)
    if sha256_bytes(raw) != block.sha256:
        raise ValueError("traj/1 sha256 mismatch")
    if len(raw) != BYTES_PER_STEP * block.steps:
        raise ValueError("traj/1 length does not match steps")
    return raw


def decode(block: TrajectoryBlock) -> TrajArrays:
    raw = raw_bytes(block)
    n, out, off = block.steps, {}, 0
    for name, dt in _FIELDS:
        size = np.dtype(dt).itemsize * n
        out[name] = np.frombuffer(raw, dtype=dt, count=n, offset=off).copy()
        off += size
    return TrajArrays(**out)
