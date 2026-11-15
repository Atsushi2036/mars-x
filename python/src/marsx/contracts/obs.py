"""obs/1 and act/1: the observation vector and action set every MARS-X policy sees.

The flat float32 vector (length ``OBS_DIM``) is what ONNX policies receive (``policy/1``). Block order is
fixed; the TypeScript observation builder must follow ``LAYOUT`` exactly (golden traces check it).

Grid convention: north-up raster, ``row`` grows southwards, ``col`` grows eastwards. One step moves one
cell (2 m) or one diagonal (2.83 m).
"""

from __future__ import annotations

from dataclasses import dataclass

OBS_SPEC = "obs/1"
ACT_SPEC = "act/1"

PATCH_K = 11  # local window side, cells (11 x 2 m = 22 m)
PATCH_CHANNELS = ("cost", "knownHazard", "relElevation", "revealedRocks")


@dataclass(frozen=True)
class Block:
    name: str
    start: int
    size: int
    fields: tuple[str, ...]
    normalisation: str


def _layout() -> tuple[Block, ...]:
    spec = [
        ("terrain", len(PATCH_CHANNELS) * PATCH_K * PATCH_K,
         ("channel-major " + ",".join(PATCH_CHANNELS) + f"; each {PATCH_K}x{PATCH_K} row-major, centre = agent",),
         "cost: clip((c-1)/4,0,1), blocked=1; hazard/rocks: 0|1; relElevation: clip(dz/5 m,-1,1)"),
        ("goal", 4, ("dRow/64", "dCol/64", "unitRow", "unitCol"), "clip to [-1,1]"),
        ("agent", 4, ("stateOfCharge", "slipEstimate", "sinHeading", "cosHeading"), "[0,1] / [-1,1]"),
        ("environment", 8, ("sinSunElevation", "sinSunAzimuth", "cosSunAzimuth", "sinLtst", "cosLtst",
                            "airTemperature", "tau", "wind"),
         ("T: (T_C+100)/80; tau/3; wind/30 m/s (clipped to [0,1]); -1 = MISSING (no MEDA measurement, never "
          "invented); LTST angle = 2*pi*ltst_h/24; azimuth clockwise from north; all 0 when the scenario has no L2")),
        ("comm", 3, ("linkAvailable", "timeToUplinkSols", "owltOver22min"), "[0,1]"),
        ("time", 2, ("solFractionLeft", "stepsFractionLeft"), "[0,1]"),
    ]
    out, start = [], 0
    for name, size, fields, norm in spec:
        out.append(Block(name, start, size, tuple(fields), norm))
        start += size
    return tuple(out)


LAYOUT = _layout()
OBS_DIM = sum(b.size for b in LAYOUT)


@dataclass(frozen=True)
class Action:
    index: int
    name: str
    drow: int
    dcol: int


ACTIONS = (
    Action(0, "N", -1, 0),
    Action(1, "S", 1, 0),
    Action(2, "E", 0, 1),
    Action(3, "W", 0, -1),
    Action(4, "NE", -1, 1),
    Action(5, "NW", -1, -1),
    Action(6, "SE", 1, 1),
    Action(7, "SW", 1, -1),
    Action(8, "WAIT", 0, 0),
)
N_ACTIONS = len(ACTIONS)
WAIT = 8


def block(name: str) -> Block:
    for b in LAYOUT:
        if b.name == name:
            return b
    raise KeyError(name)


def layout_document() -> dict:
    """JSON description of obs/1 + act/1 (published next to the JSON Schemas for the TS builder)."""
    return {
        "obsSpec": OBS_SPEC,
        "actSpec": ACT_SPEC,
        "obsDim": OBS_DIM,
        "patchK": PATCH_K,
        "patchChannels": list(PATCH_CHANNELS),
        "blocks": [
            {"name": b.name, "start": b.start, "size": b.size, "fields": list(b.fields), "normalisation": b.normalisation}
            for b in LAYOUT
        ],
        "actions": [{"index": a.index, "name": a.name, "dRow": a.drow, "dCol": a.dcol} for a in ACTIONS],
        "gridConvention": "north-up; row grows southwards; col grows eastwards; cell = 2 m",
    }
