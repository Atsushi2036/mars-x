"""Export an SB3 actor to the ONNX policy/1 contract (obs[N,505] -> logits[N,9], Gemm/Tanh only) and validate it.

Validation mirrors ADR-0007 (the web loader applies the same rules before running a dropped model).
"""

from __future__ import annotations

import contextlib
import io
from pathlib import Path

import numpy as np
import onnx
import torch

from marsx.contracts import obs as spec
from marsx.contracts import policy as pc


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


def validate(path: str | Path):
    """ADR-0007 rules + policy/1 signature (marsx.contracts.onnx_check). Raises ValueError on the first violation."""
    from marsx.contracts.onnx_check import validate_bytes

    return validate_bytes(Path(path).read_bytes())


def write_golden(path: str | Path, obs: np.ndarray, out_json: str | Path) -> dict:
    """Parity fixture for the web: observations + logits/actions from onnxruntime (Python) for this exact model."""
    import json

    import onnxruntime as ort

    x = np.ascontiguousarray(obs, dtype=np.float32)
    sess = ort.InferenceSession(str(path), providers=["CPUExecutionProvider"])
    logits = sess.run([pc.OUTPUT_NAME], {pc.INPUT_NAME: x})[0]
    doc = {"onnxSha256": validate(path).sha256, "obsDim": spec.OBS_DIM, "batch": int(x.shape[0]),
           "obs": [round(float(v), 7) for v in x.ravel()], "logits": [float(v) for v in logits.ravel()],
           "actions": [int(a) for a in logits.argmax(1)]}
    Path(out_json).write_text(json.dumps(doc) + "\n", encoding="utf-8")
    return doc


def policy_card(path: str | Path, *, name: str, version: str, intended_use: str, limitations: str,
                metrics: dict[str, float] | None = None, training: pc.TrainingInfo | None = None,
                license: str = "MIT", authors: list[str] | None = None) -> pc.PolicyCard:
    r = validate(path)
    return pc.PolicyCard(name=name, version=version, onnx_sha256=r.sha256, onnx_bytes=r.bytes, opset=r.opset,
                         ops=r.ops, training=training, metrics=metrics or {}, intended_use=intended_use,
                         limitations=limitations, license=license, authors=authors or [])
