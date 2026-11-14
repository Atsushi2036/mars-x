"""Export an SB3 actor to the ONNX policy/1 contract (obs[N,505] -> logits[N,9], Gemm/Tanh only) and validate it.

Validation mirrors ADR-0007 (the web loader applies the same rules before running a dropped model).
"""

from __future__ import annotations

import contextlib
import io
from dataclasses import dataclass
from pathlib import Path

import onnx
import torch

from marsx.contracts import obs as spec
from marsx.contracts import policy as pc
from marsx.contracts.canonical import sha256_bytes


class _Logits(torch.nn.Module):
    def __init__(self, sb3_policy):
        super().__init__()
        self.p = sb3_policy

    def forward(self, obs):
        latent_pi, _ = self.p.mlp_extractor(self.p.extract_features(obs, self.p.pi_features_extractor))
        return self.p.action_net(latent_pi)


def export_logits(sb3_policy, path: str | Path) -> Path:
    """Export the deterministic actor (logits only; argmax is done by the caller)."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    module = _Logits(sb3_policy).cpu().eval()
    dummy = torch.zeros((2, spec.OBS_DIM), dtype=torch.float32)  # batch 2: avoid size-1 specialisation
    batch = torch.export.Dim("batch", min=1, max=65536)
    with contextlib.redirect_stdout(io.StringIO()):  # the exporter prints emoji (cp1252 consoles crash)
        prog = torch.onnx.export(module, (dummy,), dynamo=True, input_names=[pc.INPUT_NAME],
                                 output_names=[pc.OUTPUT_NAME], dynamic_shapes={"obs": {0: batch}})
    prog.optimize()
    prog.save(str(path))
    model = onnx.load(str(path))
    del model.metadata_props[:]
    for k, v in pc.METADATA.items():
        model.metadata_props.add(key=k, value=v)
    onnx.save(model, str(path))
    return path


@dataclass
class OnnxReport:
    ops: list[str]
    opset: int
    nodes: int
    bytes: int
    sha256: str


def validate(path: str | Path) -> OnnxReport:
    """ADR-0007 rules + policy/1 signature. Raises ValueError with the first violation."""
    raw = Path(path).read_bytes()
    if len(raw) > pc.MAX_BYTES:
        raise ValueError(f"model is {len(raw)} bytes > {pc.MAX_BYTES}")
    m = onnx.load_from_string(raw)
    for t in m.graph.initializer:
        if t.data_location == onnx.TensorProto.EXTERNAL:
            raise ValueError("external data is not allowed")
    opsets = {o.domain or "ai.onnx": o.version for o in m.opset_import}
    if set(opsets) != {"ai.onnx"}:
        raise ValueError(f"only the ai.onnx domain is allowed, got {sorted(opsets)}")
    opset = opsets["ai.onnx"]
    if not pc.OPSET_MIN <= opset <= pc.OPSET_MAX:
        raise ValueError(f"opset {opset} outside [{pc.OPSET_MIN}, {pc.OPSET_MAX}]")
    ops = sorted({n.op_type for n in m.graph.node})
    bad = sorted(set(ops) & pc.FORBIDDEN_OPS)
    if bad:
        raise ValueError(f"forbidden ops: {bad}")
    if any(n.domain not in ("", "ai.onnx") for n in m.graph.node):
        raise ValueError("custom-domain nodes are not allowed")
    if len(m.graph.node) > pc.MAX_NODES:
        raise ValueError(f"{len(m.graph.node)} nodes > {pc.MAX_NODES}")
    (inp,), (out,) = m.graph.input, m.graph.output
    dim = lambda v, i: v.type.tensor_type.shape.dim[i].dim_value  # noqa: E731
    if inp.name != pc.INPUT_NAME or dim(inp, 1) != spec.OBS_DIM:
        raise ValueError(f"input must be '{pc.INPUT_NAME}' float32[N,{spec.OBS_DIM}]")
    if out.name != pc.OUTPUT_NAME or dim(out, 1) != spec.N_ACTIONS:
        raise ValueError(f"output must be '{pc.OUTPUT_NAME}' float32[N,{spec.N_ACTIONS}]")
    try:
        onnx.checker.check_model(m)
    except onnx.checker.ValidationError as exc:
        raise ValueError(f"invalid ONNX graph: {exc}") from exc
    return OnnxReport(ops, opset, len(m.graph.node), len(raw), sha256_bytes(raw))


def policy_card(path: str | Path, *, name: str, version: str, intended_use: str, limitations: str,
                metrics: dict[str, float] | None = None, training: pc.TrainingInfo | None = None,
                license: str = "MIT", authors: list[str] | None = None) -> pc.PolicyCard:
    r = validate(path)
    return pc.PolicyCard(name=name, version=version, onnx_sha256=r.sha256, onnx_bytes=r.bytes, opset=r.opset,
                         ops=r.ops, training=training, metrics=metrics or {}, intended_use=intended_use,
                         limitations=limitations, license=license, authors=authors or [])
