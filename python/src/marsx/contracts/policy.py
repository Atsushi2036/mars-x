"""policy/1: ONNX policy contract and its model card.

ONNX graph: input ``obs`` float32 [batch, OBS_DIM] -> output ``logits`` float32 [batch, N_ACTIONS].
Action = argmax(logits). ONNX ``metadata_props``: marsx.contract=policy/1, marsx.obs_spec=obs/1,
marsx.act_spec=act/1. Loaders enforce ADR-0007 (ai.onnx domain only, bounded opset, no external data,
no Loop/Scan/If, node cap, size cap).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from marsx.contracts import obs
from marsx.contracts.scenario import Finite
from marsx.schemas import Model, Sha256

POLICY_CONTRACT = "policy/1"
INPUT_NAME = "obs"
OUTPUT_NAME = "logits"
OPSET_MIN, OPSET_MAX = 17, 21
MAX_BYTES = 20 * 1024 * 1024
MAX_NODES = 2_000
FORBIDDEN_OPS = frozenset({"Loop", "Scan", "If"})
METADATA = {"marsx.contract": POLICY_CONTRACT, "marsx.obs_spec": obs.OBS_SPEC, "marsx.act_spec": obs.ACT_SPEC}


class TrainingInfo(Model):
    algorithm: str = Field(max_length=64)
    library: str = Field(max_length=64)
    timesteps: int = Field(ge=0)
    wall_clock_s: Finite = Field(ge=0)
    seed: int = Field(ge=0)
    suite_id: str | None = Field(default=None, max_length=64)
    split: Literal["train", "test"] = "train"


class PolicyCard(Model):
    schema_version: Literal["policyCard/1"] = "policyCard/1"
    contract: Literal["policy/1"] = POLICY_CONTRACT
    obs_spec: Literal["obs/1"] = obs.OBS_SPEC
    act_spec: Literal["act/1"] = obs.ACT_SPEC
    obs_dim: Literal[505] = obs.OBS_DIM
    n_actions: Literal[9] = obs.N_ACTIONS
    input_name: Literal["obs"] = INPUT_NAME
    output_name: Literal["logits"] = OUTPUT_NAME
    name: str = Field(max_length=96)
    version: str = Field(max_length=32)
    onnx_sha256: Sha256
    onnx_bytes: int = Field(gt=0, le=MAX_BYTES)
    opset: int = Field(ge=OPSET_MIN, le=OPSET_MAX)
    ops: list[str] = Field(max_length=64)
    training: TrainingInfo | None = None
    metrics: dict[str, Finite] = Field(default_factory=dict)
    intended_use: str = Field(max_length=1000)
    limitations: str = Field(max_length=2000)
    license: str = Field(max_length=64)
    authors: list[str] = Field(default_factory=list, max_length=20)
