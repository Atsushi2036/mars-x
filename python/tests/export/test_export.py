"""Verification of the export package without Gazebo: SDF structure, Sun direction, mesh heights, GeoTIFF, ZIP."""

from __future__ import annotations

import io
import json
import math
import re
import struct
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import numpy as np
import pytest
from pyproj import CRS

from marsx.contracts.scenario import JEZERO_GRAVITY, Scenario
from marsx.env import scenarios as env_scenarios
from marsx.export import mesh as M
from marsx.export import package as P
from marsx.export import sdf as S
from marsx.export import sun as SUN

PROJ4 = "+proj=eqc +lat_ts=18.4617 +lon_0=77.3935 +x_0=0 +y_0=-1094311.683266 +R=3396190 +units=m +no_defs +type=crs"
TOL_M = 0.15


def synthetic_dem(rows: int = 61, cols: int = 83) -> np.ndarray:
    r, c = np.mgrid[0:rows, 0:cols].astype(np.float64)
    return (-2500 + 12 * np.sin(r / 7.0) + 9 * np.cos(c / 5.0) + 0.05 * r * c / 10).astype(np.float32)


def make_inputs(scenario_id: str = "jezero-v1/l2/solar-clear", texture: bool = True) -> P.ExportInputs:
    sc = env_scenarios.get(scenario_id)
    h = synthetic_dem()
    tex = (np.random.default_rng(1).integers(0, 255, (60, 80))).astype(np.uint8) if texture else None
    return P.ExportInputs(
        scenario=sc, height=h, res_m=1.0, x_west=-41.5, y_north=30.5, local_wkt2=CRS.from_proj4(PROJ4).to_wkt(),
        local_proj4=PROJ4, center_lat=18.4617, center_lon=77.3935, dataset_id="jezero-v1", dataset_sha256="ab" * 32,
        texture=tex, start_xy=(-30.0, 20.0), goal_xy=(25.0, -18.0), start_cell=[10, 11], goal_cell=[48, 66],
        marker_source="test")


@pytest.fixture(scope="module")
def built():
    inp = make_inputs()
    files, meta = P.build_files(inp, mesh_step=4)
    return inp, P.finalize_package(files, meta), meta


# ---- SDF ---------------------------------------------------------------------------------------------------------

def test_sdf_gravity_sun_markers_and_no_plugin(built):
    files = built[1]
    root = ET.fromstring(files["world.sdf"].decode())
    assert root.tag == "sdf" and not [e for e in root.iter() if e.tag == "plugin"]
    g = [float(x) for x in root.find("world/gravity").text.split()]
    assert g == [0.0, 0.0, -JEZERO_GRAVITY.value] and abs(JEZERO_GRAVITY.value - 3.694) < 1e-9
    light = root.find("world/light")
    assert light.get("type") == "directional" and light.find("cast_shadows").text == "true"
    names = {m.get("name") for m in root.findall("world/model")}
    assert {"terrain", "start_marker", "goal_marker"} <= names
    assert [u.text for u in root.iter("uri")] == ["terrain.obj", "terrain.obj"]


def test_sun_direction_matches_independent_mars24_within_0p1_deg(built):
    inp, files, meta = built
    root = ET.fromstring(files["world.sdf"].decode())
    d = np.array([float(x) for x in root.find("world/light/direction").text.split()])
    from marsx.conditions.mars24 import mars_solar_state

    st = mars_solar_state(SUN.parse_utc_ms(inp.scenario.time.start_utc), inp.center_lat, inp.center_lon)
    el, az = math.radians(st.elevation_deg), math.radians(st.azimuth_deg)
    expect = -np.array([math.cos(el) * math.sin(az), math.cos(el) * math.cos(az), math.sin(el)])
    assert SUN.angle_deg(d, expect) < 0.1
    assert SUN.angle_deg(d, -np.array(meta["sun"]["vector"])) < 0.1  # same as manifest
    assert d[0] < 0 and d[2] < 0  # 09:00 LTST: sun in the east and above the horizon -> light travels west and down
    assert abs(meta["sun"]["ltstH"] - 9.0) < 0.05


def test_sdf_injection_is_neutralised():
    p = S.WorldParams(scenario_id='x</world><plugin filename="evil"/><!--', gravity=3.694, sun_vector_enu=(0, 0, 1),
                      sun_intensity=1, ambient=0.2, start=S.Marker(0, 0, 0), goal=S.Marker(1, 1, 0))
    text = S.render_world_sdf(p)
    root = ET.fromstring(text)
    assert not [e for e in root.iter() if e.tag == "plugin"] and "evil" in text and "<plugin" not in text


def test_check_world_rejects_plugin_and_foreign_uri():
    with pytest.raises(ValueError):
        S.check_world('<sdf version="1.9"><world name="w"><plugin name="p" filename="f"/></world></sdf>')
    with pytest.raises(ValueError):
        S.check_world('<sdf version="1.9"><world name="w"><model name="m"><link name="l"><visual name="v"><geometry>'
                      '<mesh><uri>https://example.com/x.dae</uri></mesh></geometry></visual></link></model></world></sdf>')


def test_sdf_rejects_non_finite_and_bad_values():
    with pytest.raises(ValueError):
        S.num(float("nan"))
    with pytest.raises(ValueError):
        S.render_world_sdf(S.WorldParams("a", 9.8, (0, 0, 1), 1, 0.2, S.Marker(0, 0, 0), S.Marker(1, 1, 0)))
    with pytest.raises(ValueError):
        S.render_world_sdf(S.WorldParams("a", 3.7, (0, 0, 2), 1, 0.2, S.Marker(0, 0, 0), S.Marker(1, 1, 0)))


# ---- mesh vs DEM ---------------------------------------------------------------------------------------------------

def _obj_vertices(data: bytes) -> np.ndarray:
    return np.array([[float(t) for t in ln.split()[1:4]] for ln in data.decode().splitlines() if ln.startswith("v ")])


def test_obj_and_glb_vertices_match_dem_within_tolerance(built):
    inp, files, _ = built
    v_obj = _obj_vertices(files["terrain.obj"])
    gltf, binchunk = __import__("marsx.export.mesh", fromlist=["parse_glb"]).parse_glb(files["terrain.glb"])
    acc = gltf["accessors"][0]
    bv = gltf["bufferViews"][acc["bufferView"]]
    pos = np.frombuffer(binchunk, "<f4", count=acc["count"] * 3, offset=bv["byteOffset"]).reshape(-1, 3)
    v_glb = np.stack([pos[:, 0], -pos[:, 2], pos[:, 1]], -1)  # Y-up -> ENU
    for v in (v_obj, v_glb):
        assert len(v) == len(v_obj)
        col = np.round((v[:, 0] - inp.x_west) / inp.res_m - 0.5).astype(int)
        row = np.round((inp.y_north - v[:, 1]) / inp.res_m - 0.5).astype(int)
        assert np.abs(inp.height[row, col] - v[:, 2]).max() <= TOL_M
        assert np.abs(inp.x_west + (col + 0.5) * inp.res_m - v[:, 0]).max() <= 1e-3
    assert np.abs(v_obj - v_glb).max() <= TOL_M
    assert np.allclose(pos.min(0), acc["min"]) and np.allclose(pos.max(0), acc["max"])


def test_mesh_topology_winding_and_coverage():
    h = synthetic_dem(33, 41)
    m = M.build_heightfield_mesh(h, 1.0, 0.0, 33.0, 8)  # step does not divide size: last row/col are still included
    assert m.positions[:, 0].max() == pytest.approx(40.5) and m.positions[:, 1].min() == pytest.approx(0.5)
    p = m.positions.astype(np.float64)
    t = m.indices
    cross_z = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])[:, 2]
    assert (cross_z > 0).all()  # counter-clockwise seen from +Z (outward normal up)
    assert np.allclose(np.linalg.norm(m.normals, axis=1), 1, atol=1e-5) and (m.normals[:, 2] > 0).all()
    assert m.indices.max() == len(m.positions) - 1


def test_glb_is_self_contained_and_structurally_valid(built):
    _, files, _ = built
    data = files["terrain.glb"]
    magic, ver, length = struct.unpack_from("<4sII", data)
    assert (magic, ver, length) == (b"glTF", 2, len(data)) and length % 4 == 0
    gltf, binchunk = M.parse_glb(data)
    assert all("uri" not in b for b in gltf["buffers"]) and all("uri" not in i for i in gltf["images"])
    assert gltf["buffers"][0]["byteLength"] == len(binchunk)
    for bv in gltf["bufferViews"]:
        assert bv["byteOffset"] % 4 == 0 and bv["byteOffset"] + bv["byteLength"] <= len(binchunk)
    img = gltf["bufferViews"][gltf["images"][0]["bufferView"]]
    assert binchunk[img["byteOffset"]:img["byteOffset"] + 3] == b"\xff\xd8\xff"  # JPEG


# ---- GeoTIFF ------------------------------------------------------------------------------------------------------

def test_geotiff_roundtrip_is_exact_and_in_metres(built, tmp_path):
    rasterio = pytest.importorskip("rasterio")
    inp, files, _ = built
    p = tmp_path / "t.tif"
    p.write_bytes(files["terrain.tif"])
    with rasterio.open(p) as ds:
        assert np.array_equal(ds.read(1), inp.height)
        assert ds.crs.linear_units.lower() in ("metre", "meter")
        assert tuple(ds.transform)[:6] == (1.0, 0.0, inp.x_west, 0.0, -1.0, inp.y_north)
        assert ds.tags()["UNITS"] == "metre" and "areoid" in ds.tags()["VERTICAL_DATUM"]
        assert ds.crs.to_epsg() is None and "3396190" in ds.crs.to_wkt() and "18.4617" in ds.crs.to_wkt()


# ---- scenario.json, manifest, ZIP -----------------------------------------------------------------------------------

def test_scenario_json_validates_against_contract(built):
    inp, files, _ = built
    sc = Scenario.model_validate_json(files["scenario.json"])
    assert sc.id == inp.scenario.id and sc.start == [10, 11] and sc.goal == [48, 66]
    assert sc.conditions.gravity.value == JEZERO_GRAVITY.value


def test_zip_has_fixed_safe_paths_and_manifest_hashes(built, tmp_path):
    _, files, _ = built
    z = tmp_path / "p.zip"
    sha = P.write_zip(files, z, "marsx-test")
    sha2 = P.write_zip(files, tmp_path / "p2.zip", "marsx-test")
    assert sha == sha2  # deterministic
    with zipfile.ZipFile(z) as zf:
        names = zf.namelist()
        assert names == sorted(names) and all(re.fullmatch(r"marsx-test/[A-Za-z0-9_.]+", n) for n in names)
        assert all(zi.date_time == (1980, 1, 1, 0, 0, 0) for zi in zf.infolist())
        man = json.loads(zf.read("marsx-test/manifest.json"))
        assert set(man["files"]) == {n.split("/", 1)[1] for n in names} - {"manifest.json"}
        for name, info in man["files"].items():
            data = zf.read(f"marsx-test/{name}")
            assert P.sha256_bytes(data) == info["sha256"] and len(data) == info["bytes"]
    assert {"terrain.tif", "terrain.glb", "terrain.obj", "terrain.mtl", "world.sdf", "scenario.json",
            "ATTRIBUTION.txt"} <= set(man["files"])


def test_zip_rejects_path_traversal(tmp_path):
    with pytest.raises(ValueError):
        P.write_zip({"../evil": b"x"}, tmp_path / "z.zip", "marsx-test")
    with pytest.raises(ValueError):
        P.write_zip({"a": b"x"}, tmp_path / "z.zip", "../x")


def test_attribution_and_disclaimer_present(built):
    text = built[1]["ATTRIBUTION.txt"].decode()
    assert "10.5066/P13CPYYU" in text and "Not affiliated with or endorsed by NASA, JPL or Caltech" in text


def test_obj_is_ascii_lf_and_references_texture(built):
    _, files, _ = built
    assert b"\r" not in files["terrain.obj"] and b"mtllib terrain.mtl" in files["terrain.obj"]
    assert b"map_Kd terrain_texture.jpg" in files["terrain.mtl"]
    assert io.BytesIO(files["terrain_texture.jpg"]).read(3) == b"\xff\xd8\xff"


# ---- real dataset (skipped when data/processed is not present) ------------------------------------------------------

REAL = Path(__file__).resolve().parents[3] / "data" / "processed" / "jezero-v1"


@pytest.mark.skipif(not (REAL / "manifest.json").exists(), reason="processed dataset not built")
def test_real_dataset_package_matches_dem(tmp_path):
    from marsx.export.cli import export_one

    e = export_one("jezero-v1/l1/rtg-geometry", REAL, tmp_path, mesh_step=16, texture_px=512, suite_path=None, episode=0,
                   start=[140, 564], goal=[127, 529])
    with zipfile.ZipFile(tmp_path / e["zip"]) as zf:
        top = zf.namelist()[0].split("/")[0]
        obj = zf.read(f"{top}/terrain.obj")
        man = json.loads(zf.read(f"{top}/manifest.json"))
    v = _obj_vertices(obj)
    from marsx.env.terrain import _decode

    mf = json.loads((REAL / "manifest.json").read_text())
    dem = _decode(REAL, next(layer for layer in mf["layers"] if layer["kind"] == "elevation" and layer["gridId"] == "dem"))
    col = np.round(v[:, 0] + 1024 - 0.5).astype(int)
    row = np.round(1024 - v[:, 1] - 0.5).astype(int)
    assert np.abs(dem[row, col] - v[:, 2]).max() <= TOL_M
    assert man["gravity"]["value"] == 3.694
