"""SDK ONNX validation (policy/1, ADR-0007): fail closed, same rules as the web validator; attack models."""

from __future__ import annotations

import builtins

import numpy as np
import pytest

onnx = pytest.importorskip("onnx")
from marsx.contracts import obs as spec
from marsx.contracts import onnx_check
from onnx import TensorProto, helper, numpy_helper


def _io():
    return ([helper.make_tensor_value_info("obs", TensorProto.FLOAT, ["N", spec.OBS_DIM])],
            [helper.make_tensor_value_info("logits", TensorProto.FLOAT, ["N", spec.N_ACTIONS])])


def model(nodes, inits=(), opset=20, domain=""):
    inp, out = _io()
    g = helper.make_graph(nodes, "g", inp, out, initializer=list(inits))
    m = helper.make_model(g, opset_imports=[helper.make_opsetid(domain, opset)])
    m.ir_version = 9
    return m.SerializeToString()


def good():
    w = numpy_helper.from_array(np.zeros((spec.OBS_DIM, spec.N_ACTIONS), np.float32), "W")
    b = numpy_helper.from_array(np.zeros(spec.N_ACTIONS, np.float32), "B")
    return model([helper.make_node("Gemm", ["obs", "W", "B"], ["logits"])], [w, b])


def test_valid_model_passes():
    r = onnx_check.validate_bytes(good())
    assert r.ops == ["Gemm"] and r.opset == 20


def _reject(data, match):
    with pytest.raises(ValueError, match=match):
        onnx_check.validate_bytes(data)


def test_forbidden_control_flow():
    _reject(model([helper.make_node("Loop", ["obs"], ["logits"])]), "forbidden")


def test_subgraph_attribute_is_rejected():
    sub = helper.make_graph([], "s", [], [helper.make_tensor_value_info("logits", TensorProto.FLOAT, None)])
    node = helper.make_node("Identity", ["obs"], ["logits"])
    node.attribute.append(helper.make_attribute("body", sub))
    _reject(model([node]), "subgraph")


def test_external_data_initializer():
    w = numpy_helper.from_array(np.zeros((2, 2), np.float32), "W")
    w.data_location = TensorProto.EXTERNAL
    w.ClearField("raw_data")
    w.external_data.add(key="location", value="../../etc/passwd")
    _reject(model([helper.make_node("Gemm", ["obs", "W"], ["logits"])], [w]), "external")


def test_constant_with_external_tensor_attribute():
    t = numpy_helper.from_array(np.zeros(2, np.float32), "c")
    t.data_location = TensorProto.EXTERNAL
    t.ClearField("raw_data")
    t.external_data.add(key="location", value="x.bin")
    node = helper.make_node("Constant", [], ["c"], value=t)
    _reject(model([node, helper.make_node("Identity", ["obs"], ["logits"])]), "external")


def test_custom_domain_and_opset_bounds():
    _reject(model([helper.make_node("Gemm", ["obs"], ["logits"], domain="evil.ops")]), "domain")
    _reject(model([helper.make_node("Gemm", ["obs"], ["logits"])], opset=7), "opset")


def test_node_cap():
    nodes = [helper.make_node("Identity", ["obs"], ["logits"])] * 2001
    _reject(model(nodes), "nodes")


def test_constant_of_shape_bomb_and_dynamic_shapes():
    shape = numpy_helper.from_array(np.array([1 << 16, 1 << 16], np.int64), "shape")
    _reject(model([helper.make_node("ConstantOfShape", ["shape"], ["logits"])], [shape]), "ConstantOfShape")
    _reject(model([helper.make_node("Expand", ["obs", "obs"], ["logits"])]), "Expand")  # shape not constant


def test_range_resize_pad_are_bounded():
    s, l, d = (numpy_helper.from_array(np.array(v, np.int64), n) for v, n in ((0, "s"), (1 << 40, "l"), (1, "d")))
    _reject(model([helper.make_node("Range", ["s", "l", "d"], ["logits"])], [s, l, d]), "Range")
    pads = numpy_helper.from_array(np.array([0, 1 << 30, 0, 0], np.int64), "pads")
    _reject(model([helper.make_node("Pad", ["obs", "pads"], ["logits"])], [pads]), "Pad")
    sizes = numpy_helper.from_array(np.array([1, 1, 1 << 15, 1 << 15], np.int64), "sizes")
    _reject(model([helper.make_node("Resize", ["obs", "", "", "sizes"], ["logits"])], [sizes]), "Resize")


def test_fails_closed_without_onnx(monkeypatch):
    real = builtins.__import__

    def no_onnx(name, *a, **k):
        if name == "onnx" or name.startswith("onnx."):
            raise ImportError("no onnx")
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_onnx)
    with pytest.raises(RuntimeError, match="onnx"):
        onnx_check.validate_bytes(good())


def test_sdk_policy_uses_the_validator(tmp_path):
    from marsx.bench.policies import OnnxPolicy

    p = tmp_path / "bad.onnx"
    p.write_bytes(model([helper.make_node("Loop", ["obs"], ["logits"])]))
    with pytest.raises(ValueError, match="forbidden"):
        OnnxPolicy(p)


def test_sdk_policy_fails_closed_without_onnx(tmp_path, monkeypatch):
    from marsx.bench.policies import OnnxPolicy

    p = tmp_path / "ok.onnx"
    p.write_bytes(good())
    real = builtins.__import__

    def no_onnx(name, *a, **k):
        if name == "onnx" or name.startswith("onnx."):
            raise ImportError("no onnx")
        return real(name, *a, **k)

    monkeypatch.setattr(builtins, "__import__", no_onnx)
    with pytest.raises(RuntimeError, match="onnx"):
        OnnxPolicy(p)
