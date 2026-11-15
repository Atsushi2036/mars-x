"""ONNX policy/1 validation for the SDK (ADR-0007): the same rules as the web loader, failing closed.

Run before any onnxruntime session is created. Requires the ``onnx`` package: without it validation raises
instead of being skipped. Rules: size cap; only the ai.onnx domain (graph and nodes); bounded opset; no external
data (initializers, sparse initializers, tensor attributes such as ``Constant``); node cap; no Loop/Scan/If and no
subgraph attributes; shape-producing ops (ConstantOfShape, Expand, Tile, Range, Resize, Pad) only with constant,
bounded arguments; policy/1 signature obs[N,505] -> logits[N,9].
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

import numpy as np

from marsx.contracts import obs as spec
from marsx.contracts import policy as pc

MAX_STATIC_ELEMENTS = 1 << 20  # same bound as apps/explorer/src/intelligence/policy/onnx-validate.ts
MAX_RESIZE_SCALE = 64.0
ALLOWED_DOMAINS = {"", "ai.onnx"}


@dataclass
class OnnxReport:
    ops: list[str]
    opset: int
    nodes: int
    bytes: int
    sha256: str


def _onnx():
    try:
        import onnx
        from onnx import numpy_helper
    except ImportError as exc:  # fail closed
        raise RuntimeError("the 'onnx' package is required to validate policies (pip install 'marsx[train]')") from exc
    return onnx, numpy_helper


def validate_bytes(data: bytes) -> OnnxReport:
    """Raise ValueError on the first violation; return a summary otherwise."""
    onnx, nh = _onnx()
    if len(data) > pc.MAX_BYTES:
        raise ValueError(f"model is {len(data)} bytes > {pc.MAX_BYTES}")
    try:
        m = onnx.load_from_string(data)
    except Exception as exc:
        raise ValueError(f"not a valid ONNX protobuf: {exc}") from exc
    g = m.graph
    ext = onnx.TensorProto.EXTERNAL

    def check_tensor(t, where):
        if t.data_location == ext or len(t.external_data) > 0:
            raise ValueError(f"external data is not allowed ({where})")

    for t in g.initializer:
        check_tensor(t, f"initializer {t.name}")
    for st in g.sparse_initializer:
        check_tensor(st.values, "sparse initializer")
        check_tensor(st.indices, "sparse initializer")

    opsets = {o.domain or "": o.version for o in m.opset_import}
    if set(opsets) - ALLOWED_DOMAINS:
        raise ValueError(f"only the ai.onnx domain is allowed, got {sorted(set(opsets) - ALLOWED_DOMAINS)}")
    opset = opsets.get("", opsets.get("ai.onnx", 0))
    if not pc.OPSET_MIN <= opset <= pc.OPSET_MAX:
        raise ValueError(f"opset {opset} outside [{pc.OPSET_MIN}, {pc.OPSET_MAX}]")
    if len(g.node) > pc.MAX_NODES:
        raise ValueError(f"{len(g.node)} nodes > {pc.MAX_NODES}")

    consts = {t.name: t for t in g.initializer}
    for n in g.node:
        if n.domain not in ALLOWED_DOMAINS:
            raise ValueError(f"custom-domain node {n.op_type!r} ({n.domain}) is not allowed")
        if n.op_type in pc.FORBIDDEN_OPS:
            raise ValueError(f"forbidden ops: {n.op_type}")
        for a in n.attribute:
            if a.type in (onnx.AttributeProto.GRAPH, onnx.AttributeProto.GRAPHS) or a.HasField("g") or len(a.graphs):
                raise ValueError(f"subgraph attributes are not allowed ({n.op_type}.{a.name})")
            if a.HasField("t"):
                check_tensor(a.t, f"{n.op_type}.{a.name}")
            for t in a.tensors:
                check_tensor(t, f"{n.op_type}.{a.name}")
            if a.HasField("sparse_tensor"):
                check_tensor(a.sparse_tensor.values, f"{n.op_type}.{a.name}")
            for st in a.sparse_tensors:
                check_tensor(st.values, f"{n.op_type}.{a.name}")
        if n.op_type == "Constant":
            for a in n.attribute:
                if a.HasField("t"):
                    consts[n.output[0]] = a.t
        _check_bounded(n, consts, nh)

    (inp,), (out,) = g.input[:1] or [None], g.output[:1] or [None]
    if inp is None or out is None:
        raise ValueError("policy/1 needs one input and one output")
    dim = lambda v, i: v.type.tensor_type.shape.dim[i].dim_value if len(v.type.tensor_type.shape.dim) > i else 0
    if inp.name != pc.INPUT_NAME or dim(inp, 1) != spec.OBS_DIM:
        raise ValueError(f"input must be '{pc.INPUT_NAME}' float32[N,{spec.OBS_DIM}]")
    if out.name != pc.OUTPUT_NAME or dim(out, 1) != spec.N_ACTIONS:
        raise ValueError(f"output must be '{pc.OUTPUT_NAME}' float32[N,{spec.N_ACTIONS}]")
    try:
        onnx.checker.check_model(m)
    except onnx.checker.ValidationError as exc:
        raise ValueError(f"invalid ONNX graph: {exc}") from exc
    return OnnxReport(sorted({n.op_type for n in g.node}), opset, len(g.node), len(data), hashlib.sha256(data).hexdigest())


def _const(consts, name, nh, op, what):
    if not name or name not in consts:
        raise ValueError(f"{op}: {what} must be a constant initializer (dynamic shapes are not allowed)")
    return nh.to_array(consts[name])


def _check_bounded(n, consts, nh) -> None:
    op, ins = n.op_type, list(n.input)
    if op == "ConstantOfShape":
        shape = _const(consts, ins[0] if ins else "", nh, op, "shape")
        if np.prod(np.maximum(shape.astype(np.float64), 0)) > MAX_STATIC_ELEMENTS:
            raise ValueError(f"ConstantOfShape output too large: {shape.tolist()}")
    elif op == "Expand":
        shape = _const(consts, ins[1] if len(ins) > 1 else "", nh, op, "shape")
        if np.prod(np.maximum(shape.astype(np.float64), 1)) > MAX_STATIC_ELEMENTS:
            raise ValueError(f"Expand shape too large: {shape.tolist()}")
    elif op == "Tile":
        reps = _const(consts, ins[1] if len(ins) > 1 else "", nh, op, "repeats")
        if np.prod(np.maximum(reps.astype(np.float64), 1)) > MAX_STATIC_ELEMENTS:
            raise ValueError(f"Tile repeats too large: {reps.tolist()}")
    elif op == "Range":
        start, limit, delta = (float(_const(consts, ins[i] if len(ins) > i else "", nh, op, "start/limit/delta"))
                               for i in range(3))
        if delta == 0 or (limit - start) / delta > MAX_STATIC_ELEMENTS:
            raise ValueError("Range output too large")
    elif op == "Pad":
        pads = _const(consts, ins[1] if len(ins) > 1 else "", nh, op, "pads")
        if np.abs(pads.astype(np.float64)).sum() > MAX_STATIC_ELEMENTS:
            raise ValueError(f"Pad amounts too large: {pads.tolist()}")
    elif op == "Resize":
        sizes = ins[3] if len(ins) > 3 else ""
        scales = ins[2] if len(ins) > 2 else ""
        if sizes:
            v = _const(consts, sizes, nh, op, "sizes")
            if np.prod(np.maximum(v.astype(np.float64), 1)) > MAX_STATIC_ELEMENTS:
                raise ValueError(f"Resize sizes too large: {v.tolist()}")
        elif scales:
            v = _const(consts, scales, nh, op, "scales")
            if np.max(v) > MAX_RESIZE_SCALE:
                raise ValueError(f"Resize scales too large: {v.tolist()}")
        else:
            raise ValueError("Resize needs constant sizes or scales")
