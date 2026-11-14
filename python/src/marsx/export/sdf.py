"""world.sdf from a FIXED template (ADR-0007): numbers are formatted, strings are XML-escaped and restricted,
there is never a ``<plugin>`` element and never a user-supplied URI (mesh URIs are constants)."""

from __future__ import annotations

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from xml.sax.saxutils import escape

MESH_URI = "terrain.obj"  # constant, relative to the package folder
_SAFE_TEXT = re.compile(r"[^A-Za-z0-9 _./:+()-]")


def esc(text: str, max_len: int = 120) -> str:
    """Restrict to a safe character set, then XML-escape (also kills ``--`` which is illegal inside comments)."""
    return escape(_SAFE_TEXT.sub("?", str(text))[:max_len].replace("--", "- "))


def num(x: float, nd: int = 6) -> str:
    x = float(x)
    if not math.isfinite(x):
        raise ValueError("non-finite number in SDF")
    return f"{x:.{nd}f}"


@dataclass(frozen=True)
class Marker:
    x: float
    y: float
    z: float


@dataclass(frozen=True)
class WorldParams:
    scenario_id: str
    gravity: float  # m/s^2 (scenario value)
    sun_vector_enu: tuple[float, float, float]  # unit vector TOWARDS the Sun (E, N, U)
    sun_intensity: float  # 0..1 visual scale
    ambient: float  # 0..1 visual scale
    start: Marker
    goal: Marker


_TEMPLATE = """<?xml version="1.0" encoding="UTF-8"?>
<!-- MARS-X world generated from a fixed template for scenario {scenario}. Visual lighting values are for display only. -->
<sdf version="1.9">
  <world name="marsx_jezero">
    <gravity>0 0 -{gravity}</gravity>
    <scene>
      <ambient>{amb} {amb} {amb} 1</ambient>
      <background>0.62 0.45 0.35 1</background>
      <shadows>true</shadows>
    </scene>
    <light type="directional" name="sun">
      <cast_shadows>true</cast_shadows>
      <pose>0 0 1000 0 0 0</pose>
      <diffuse>{sun} {sun_g} {sun_b} 1</diffuse>
      <specular>0.1 0.1 0.1 1</specular>
      <direction>{dx} {dy} {dz}</direction>
    </light>
    <model name="terrain">
      <static>true</static>
      <pose>0 0 0 0 0 0</pose>
      <link name="surface">
        <visual name="visual">
          <geometry><mesh><uri>{uri}</uri></mesh></geometry>
        </visual>
        <collision name="collision">
          <geometry><mesh><uri>{uri}</uri></mesh></geometry>
        </collision>
      </link>
    </model>
    <model name="start_marker">
      <static>true</static>
      <pose>{sx} {sy} {sz} 0 0 0</pose>
      <link name="link">
        <visual name="visual">
          <geometry><cylinder><radius>1.0</radius><length>3.0</length></cylinder></geometry>
          <material><ambient>0.2 0.8 0.3 1</ambient><diffuse>0.2 0.8 0.3 1</diffuse></material>
        </visual>
      </link>
    </model>
    <model name="goal_marker">
      <static>true</static>
      <pose>{gx} {gy} {gz} 0 0 0</pose>
      <link name="link">
        <visual name="visual">
          <geometry><cylinder><radius>1.0</radius><length>3.0</length></cylinder></geometry>
          <material><ambient>1.0 0.72 0.12 1</ambient><diffuse>1.0 0.72 0.12 1</diffuse></material>
        </visual>
      </link>
    </model>
  </world>
</sdf>
"""


def render_world_sdf(p: WorldParams) -> str:
    sx, sy, sz = p.sun_vector_enu
    n = math.sqrt(sx * sx + sy * sy + sz * sz)
    if not 0.999 < n < 1.001:
        raise ValueError("sun vector must be unit length")
    if not 3.0 < p.gravity < 4.5:
        raise ValueError("gravity outside the plausible range for Mars")
    s = max(0.0, min(1.0, p.sun_intensity))
    out = _TEMPLATE.format(
        scenario=esc(p.scenario_id), gravity=num(p.gravity, 4), amb=num(max(0.0, min(1.0, p.ambient)), 3),
        sun=num(s, 3), sun_g=num(s * 0.93, 3), sun_b=num(s * 0.85, 3),
        dx=num(-sx, 9), dy=num(-sy, 9), dz=num(-sz, 9), uri=MESH_URI,
        sx=num(p.start.x, 3), sy=num(p.start.y, 3), sz=num(p.start.z + 1.5, 3),
        gx=num(p.goal.x, 3), gy=num(p.goal.y, 3), gz=num(p.goal.z + 1.5, 3))
    check_world(out)
    return out


def check_world(text: str) -> ET.Element:
    """Parse and enforce the ADR-0007 rules; raises ValueError on violation."""
    root = ET.fromstring(text)
    if root.tag != "sdf":
        raise ValueError("root is not <sdf>")
    if any(el.tag == "plugin" for el in root.iter()):
        raise ValueError("<plugin> is forbidden in generated SDF (ADR-0007)")
    uris = [(el.text or "").strip() for el in root.iter("uri")]
    if any(u != MESH_URI for u in uris):
        raise ValueError("only the constant terrain mesh URI is allowed")
    return root
