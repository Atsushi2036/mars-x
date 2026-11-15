"""Heightfield mesh (ENU, metres, Z up) and writers for OBJ/MTL and self-contained GLB (glTF 2.0, Y up)."""

from __future__ import annotations

import json
import struct
from dataclasses import dataclass

import numpy as np


@dataclass
class Mesh:
    positions: np.ndarray  # (N, 3) float32, x east, y north, z up (local metres, absolute elevation)
    normals: np.ndarray  # (N, 3) float32 unit
    uvs: np.ndarray  # (N, 2) float32, (0,0) = SW corner of the texture footprint, v up
    indices: np.ndarray  # (M, 3) uint32, counter-clockwise seen from +Z
    rows: int
    cols: int
    step_cells: int


def _axis(n: int, k: int) -> np.ndarray:
    idx = np.arange(0, n, k)
    if idx[-1] != n - 1:
        idx = np.append(idx, n - 1)
    return idx


def build_heightfield_mesh(height: np.ndarray, res_m: float, x_west: float, y_north: float, step_cells: int) -> Mesh:
    """Vertices are DEM cell centres every ``step_cells`` cells (heights are exact DEM values)."""
    if height.ndim != 2 or min(height.shape) < 2 or step_cells < 1:
        raise ValueError("height must be 2-D (>=2x2) and step_cells >= 1")
    z_all = np.asarray(height, dtype=np.float64)
    if not np.isfinite(z_all).all():
        z_all = np.where(np.isfinite(z_all), z_all, np.nanmin(z_all))  # nodata -> lowest valid elevation
    ri, ci = _axis(z_all.shape[0], step_cells), _axis(z_all.shape[1], step_cells)
    z = z_all[np.ix_(ri, ci)]
    xs = x_west + (ci + 0.5) * res_m
    ys = y_north - (ri + 0.5) * res_m
    X, Y = np.meshgrid(xs, ys)
    pos = np.stack([X, Y, z], -1).reshape(-1, 3).astype(np.float32)
    # normals from central differences on the decimated grid (y decreases with row)
    dzdx = np.gradient(z, xs, axis=1)
    dzdy = np.gradient(z, ys, axis=0)
    n = np.stack([-dzdx, -dzdy, np.ones_like(z)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    xmin, xmax = x_west, x_west + z_all.shape[1] * res_m
    ymax, ymin = y_north, y_north - z_all.shape[0] * res_m
    uv = np.stack([(X - xmin) / (xmax - xmin), (Y - ymin) / (ymax - ymin)], -1).reshape(-1, 2).astype(np.float32)
    R, C = z.shape
    v = np.arange(R * C, dtype=np.uint32).reshape(R, C)
    a, b, c, d = v[:-1, :-1], v[:-1, 1:], v[1:, :-1], v[1:, 1:]
    tris = np.concatenate([np.stack([a, c, b], -1).reshape(-1, 3), np.stack([b, c, d], -1).reshape(-1, 3)])
    return Mesh(pos, n.reshape(-1, 3).astype(np.float32), uv, tris.astype(np.uint32), R, C, step_cells)


def obj_bytes(mesh: Mesh, mtl_name: str = "terrain.mtl", material: str = "terrain") -> bytes:
    """OBJ in ENU / Z up, metres (LF endings, ASCII)."""
    lines = ["# MARS-X terrain (metres, x east, y north, z up). Not affiliated with or endorsed by NASA, JPL or Caltech.",
             f"mtllib {mtl_name}", "o terrain"]
    lines += [f"v {x:.4f} {y:.4f} {z:.4f}" for x, y, z in mesh.positions.astype(np.float64)]
    lines += [f"vt {u:.6f} {v:.6f}" for u, v in mesh.uvs.astype(np.float64)]
    lines += [f"vn {x:.5f} {y:.5f} {z:.5f}" for x, y, z in mesh.normals.astype(np.float64)]
    lines.append(f"usemtl {material}")
    f = mesh.indices.astype(np.int64) + 1
    lines += [f"f {a}/{a}/{a} {b}/{b}/{b} {c}/{c}/{c}" for a, b, c in f]
    return ("\n".join(lines) + "\n").encode("ascii")


def mtl_text(texture_file: str = "terrain_texture.jpg", material: str = "terrain") -> str:
    return f"newmtl {material}\nKa 1 1 1\nKd 1 1 1\nKs 0 0 0\nNs 1\nd 1\nillum 1\nmap_Kd {texture_file}\n"


def _pad4(b: bytes, fill: bytes = b"\x00") -> bytes:
    return b + fill * ((-len(b)) % 4)


def build_glb(mesh: Mesh, texture_jpeg: bytes | None, extras: dict | None = None) -> bytes:
    """Self-contained GLB: Y-up conversion (x, y, z)_enu -> (x, z, -y), embedded JPEG texture."""
    p = mesh.positions
    pos = np.stack([p[:, 0], p[:, 2], -p[:, 1]], -1).astype("<f4")
    nrm = np.stack([mesh.normals[:, 0], mesh.normals[:, 2], -mesh.normals[:, 1]], -1).astype("<f4")
    uv = mesh.uvs.copy()
    uv[:, 1] = 1.0 - uv[:, 1]  # glTF: origin top-left
    uv = uv.astype("<f4")
    idx = mesh.indices.astype("<u4").reshape(-1)
    blobs: list[tuple[bytes, int | None]] = [(pos.tobytes(), 34962), (nrm.tobytes(), 34962), (uv.tobytes(), 34962),
                                              (idx.tobytes(), 34963)]
    if texture_jpeg:
        blobs.append((texture_jpeg, None))
    views, chunks, off = [], [], 0
    for data, target in blobs:
        v = {"buffer": 0, "byteOffset": off, "byteLength": len(data)}
        if target:
            v["target"] = target
        views.append(v)
        padded = _pad4(data)
        chunks.append(padded)
        off += len(padded)
    bin_chunk = b"".join(chunks)
    gltf = {
        "asset": {"version": "2.0", "generator": "marsx.export",
                  "copyright": "USGS Astrogeology / NASA/JPL/University of Arizona (HiRISE); see ATTRIBUTION.txt"},
        "scene": 0, "scenes": [{"nodes": [0]}],
        "nodes": [{"name": "terrain", "mesh": 0}],
        "meshes": [{"name": "terrain", "primitives": [{
            "attributes": {"POSITION": 0, "NORMAL": 1, "TEXCOORD_0": 2}, "indices": 3, "material": 0, "mode": 4}]}],
        "materials": [{"name": "terrain", "doubleSided": False,
                       "pbrMetallicRoughness": {"metallicFactor": 0.0, "roughnessFactor": 1.0,
                                                **({"baseColorTexture": {"index": 0}} if texture_jpeg else {})}}],
        "accessors": [
            {"bufferView": 0, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(0).astype(float).tolist(), "max": pos.max(0).astype(float).tolist()},
            {"bufferView": 1, "componentType": 5126, "count": len(nrm), "type": "VEC3"},
            {"bufferView": 2, "componentType": 5126, "count": len(uv), "type": "VEC2"},
            {"bufferView": 3, "componentType": 5125, "count": len(idx), "type": "SCALAR"},
        ],
        "bufferViews": views,
        "buffers": [{"byteLength": len(bin_chunk)}],
    }
    if texture_jpeg:
        gltf["images"] = [{"bufferView": 4, "mimeType": "image/jpeg"}]
        gltf["samplers"] = [{"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071}]
        gltf["textures"] = [{"source": 0, "sampler": 0}]
    if extras:
        gltf["asset"]["extras"] = extras
    js = _pad4(json.dumps(gltf, separators=(",", ":"), sort_keys=True).encode("utf-8"), b" ")
    total = 12 + 8 + len(js) + 8 + len(bin_chunk)
    return (struct.pack("<4sII", b"glTF", 2, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(bin_chunk), b"BIN\x00") + bin_chunk)


def parse_glb(data: bytes) -> tuple[dict, bytes]:
    """Minimal reader (used by tests and sanity checks)."""
    magic, version, length = struct.unpack_from("<4sII", data, 0)
    if magic != b"glTF" or version != 2 or length != len(data):
        raise ValueError("not a valid GLB 2.0")
    jl, _ = struct.unpack_from("<I4s", data, 12)
    gltf = json.loads(data[20:20 + jl])
    bl, _ = struct.unpack_from("<I4s", data, 20 + jl)
    return gltf, data[28 + jl:28 + jl + bl]
