"""MEDA (Mars 2020 Mars Environmental Dynamics Analyzer) ingestion: hourly summaries.

Source: PDS4 bundle ``mars2020_meda`` (Atmospheres Node), release 2026-08-11:
https://pds.nasa.gov/data/pds4/releases/atmos/mars2020_meda-20260811/ . That
release page only serves the bundle labels and collection inventories (which fix
the product versions, used here); the data files live in the Atmospheres Node
archive https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/
(same inventories, 7279 derived-collection rows on both). Data are ASCII CSV, 1 Hz,
~12 measured hours per sol (even hours on even sols, odd hours on odd sols,
bundle readme.txt) -- hours not measured are reported as ``No data``.

Variables
- Air temperature: calibrated ATS (collection data_calibrated_env, ``CAL_ATS``),
  median of the three RSM sensors ``ATS_LOCAL_TEMP1-3`` per sample (``assumption``:
  TEMP4/5 sit on the rover body and are thermally contaminated; the median is a
  robustness choice, not a published recipe).
- Pressure: derived ``DER_PS`` ``PRESSURE`` (Pa). Wind: derived ``DER_WS``
  ``HORIZONTAL_WIND_SPEED`` (m/s) (the wind sensor is unreliable before sol 36,
  readme.txt; every sol used here is later).
- Optical depth tau: not in the MEDA environmental tables (it comes from SkyCam /
  Mastcam-Z), so ``tau`` is ``None`` ("No data") unless a published value is
  attached in ``TAU_LITERATURE`` (sols 313-315: ~2, storm peak, Lemmon et al. 2022;
  ``tauProvenance`` = "source"). Clear sols have no published tau here -> "No data".
- Missing values: empty field, an invalid-data marker (``9999999999`` documented;
  ``999999999`` seen in DER_WS sol 151; any |value| >= 1e8) or NaN
  -> ``None``. Nothing is interpolated or invented.
- ``MIN_MINUTES_PER_HOUR``: ``assumption``; an hour needs valid samples in at least
  this many distinct minutes (of 60) to get a value, otherwise ``No data``. This
  keeps the sparse-cadence hours (about one sample every 11 s) and rejects short
  bursts that would misrepresent the hour.

Security: HTTPS only, certificates always verified, size cap, SHA-256 recorded in
a committed lock file and verified on every later download; CSV only (no pickle).
"""
from __future__ import annotations

import csv
import hashlib
import json
import math
import re
import statistics
import sys
import time
from pathlib import Path
from typing import Callable

DATA_BASE = "https://pds-atmospheres.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda"
INVENTORY_BASE = "https://pds.nasa.gov/data/pds4/releases/atmos/mars2020_meda-20260811"
LOCK_PATH = Path(__file__).with_name("meda.lock.json")
MIN_MINUTES_PER_HOUR = 30  # assumption, see module docstring
INVALID_ABS = 1e8
MAX_BYTES = 150_000_000

_LEMMON = (
    "Lemmon et al. 2022, GRL 49(17) e2022GL100126, doi:10.1029/2022GL100126 "
    "(visible optical depth, peak ~2 during the 5-11 Jan 2022 storm, Ls 153-156)"
)
# sols used by the benchmark: season label + provenance of the choice. Local dates and Ls
# computed with marsx.conditions.mars24 at local noon (Jezero 77.45 E; sol 0 = landing sol).
_CLEAR = {
    "season": "aphelion-clear",
    "note": "Aphelion-season sol (Ls ~75-84, 2021-07/08) with 12 measured hours of temperature, pressure and wind. "
    "Chosen by season and data coverage, NOT by a measured tau (no tau in the MEDA environmental tables).",
}
_STORM = {
    "season": "dust-storm",
    "note": "Regional dust storm over Jezero, 5-11 Jan 2022 (Ls 153-156); visibility dropped on the afternoon of sol 313 "
    "(" + _LEMMON + ").",
}
SOLS: dict[int, dict[str, str]] = {
    148: _CLEAR,  # 2021-07-20, Ls ~74.5 (the clear sol used by the L2 environment)
    151: _CLEAR,  # 2021-07-23, Ls 75.9
    160: _CLEAR,  # 2021-08-02, Ls 79.9
    170: _CLEAR,  # 2021-08-12, Ls 84.4
    313: _STORM,  # 2022-01-06, Ls 153.4
    314: _STORM,
    315: _STORM,
}
# Published optical depths (sol -> (tau, citation)). Only values with a source; the
# storm value is the peak of the storm period, not a per-sol measurement.
TAU_LITERATURE: dict[int, tuple[float, str]] = {
    sol: (2.0, _LEMMON + "; peak of the storm period, not a per-sol measurement") for sol in (313, 314, 315)
}


class IntegrityError(RuntimeError):
    """A downloaded file does not match the SHA-256 recorded in the lock."""


# ------------------------------------------------------------------ parsing --
_LMST = re.compile(r"^\d+M(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)$")


def lmst_hour(text: str) -> float:
    """``00313M13:30:00.5`` -> 13.5001... (hours of local mean solar time)."""
    m = _LMST.match(text.strip())
    if not m:
        raise ValueError(f"not an LMST string: {text!r}")
    return int(m.group(1)) + int(m.group(2)) / 60.0 + float(m.group(3)) / 3600.0


def parse_value(text: str) -> float | None:
    t = text.strip()
    if not t:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if math.isnan(v) or math.isinf(v) or abs(v) >= INVALID_ABS:
        return None
    return v


def fmt(value: float | None, unit: str = "", digits: int = 1) -> str:
    """Display helper: never shows a made-up number."""
    return "No data" if value is None else f"{value:.{digits}f} {unit}".rstrip()


def _rows(path: Path):
    with open(path, newline="", encoding="ascii") as fh:
        yield from csv.DictReader(fh)


def _hourly(path: Path, extract: Callable[[dict], float | None]) -> list[list[tuple[int, float]]]:
    """Valid (minute, value) pairs per LMST hour."""
    out: list[list[tuple[int, float]]] = [[] for _ in range(24)]
    for row in _rows(path):
        try:
            t = lmst_hour(row["LMST"])
        except (ValueError, KeyError):
            continue
        v = extract(row)
        h = int(t)
        if v is not None and 0 <= h < 24:
            out[h].append((int((t - h) * 60), v))
    return out


def _median_ats(row: dict) -> float | None:
    vals = [parse_value(row.get(f"ATS_LOCAL_TEMP{i}", "")) for i in (1, 2, 3)]
    vals = [v for v in vals if v is not None]
    return statistics.median(vals) if len(vals) == 3 else None  # require all three RSM sensors


def _covered(pairs: list[tuple[int, float]]) -> list[float]:
    """Values of an hour, or [] if the hour is not covered well enough."""
    if len({m for m, _ in pairs}) < MIN_MINUTES_PER_HOUR:
        return []
    return [v for _, v in pairs]


def _mean(pairs: list[tuple[int, float]]) -> float | None:
    vals = _covered(pairs)
    return statistics.fmean(vals) if vals else None


def summarize_sol(sol: int, ats_path: Path, ps_path: Path, ws_path: Path) -> dict:
    temp = _hourly(Path(ats_path), _median_ats)
    pres = _hourly(Path(ps_path), lambda r: parse_value(r.get("PRESSURE", "")))
    wind = _hourly(Path(ws_path), lambda r: parse_value(r.get("HORIZONTAL_WIND_SPEED", "")))
    hours = []
    for h in range(24):
        w = _covered(wind[h])
        hours.append(
            {
                "hour": h,
                "temperatureK": _mean(temp[h]),
                "pressurePa": _mean(pres[h]),
                "windSpeedMs": _mean(wind[h]),
                "windMaxMs": max(w) if w else None,
                "nSamples": max(len(temp[h]), len(pres[h]), len(wind[h])),
            }
        )
    def col(key: str) -> list[float]:
        return [h[key] for h in hours if h[key] is not None]

    t, p, w = col("temperatureK"), col("pressurePa"), col("windSpeedMs")
    wm = col("windMaxMs")
    tau = TAU_LITERATURE.get(sol)
    return {
        "sol": int(sol),
        "season": SOLS.get(sol, {}).get("season"),
        "hours": hours,
        "daily": {
            "hoursWithData": sum(1 for h in hours if h["temperatureK"] is not None),
            "temperatureMinK": min(t) if t else None,
            "temperatureMaxK": max(t) if t else None,
            "pressureMinPa": min(p) if p else None,
            "pressureMaxPa": max(p) if p else None,
            "windMeanMs": statistics.fmean(w) if w else None,
            "windMaxMs": max(wm) if wm else None,
        },
        "tau": tau[0] if tau else None,
        "tauSource": tau[1] if tau else None,
        "tauProvenance": "source" if tau else None,
        "note": SOLS.get(sol, {}).get("note"),
        "source": "NASA PDS Atmospheres Node, mars2020_meda release 2026-08-11 (ATS calibrated; PS, WS derived)",
    }


# ------------------------------------------------------------------ layout ---
_BINS = [(0, 89), (90, 179), (180, 299)] + [(a, a + 119) for a in range(300, 1860, 120)]


def sol_bin(sol: int) -> str:
    for lo, hi in _BINS:
        if lo <= sol <= hi:
            return f"sol_{lo:04d}_{hi:04d}"
    raise ValueError(f"sol {sol} outside the known directory layout")


def _fname(level: str, kind: str, sol: int, version: int) -> str:
    lv = {"derived": "DER", "calibrated": "CAL"}[level]
    return f"WE__{sol:04d}___________{(lv + '_' + kind).ljust(24, '_')}P{version:02d}.CSV"


def product_relpath(level: str, kind: str, sol: int, version: int) -> str:
    coll = {"derived": "data_derived_env", "calibrated": "data_calibrated_env"}[level]
    return f"{coll}/{sol_bin(sol)}/sol_{sol:04d}/{_fname(level, kind, sol, version)}"


_PRODUCTS = (("calibrated", "ATS"), ("derived", "PS"), ("derived", "WS"))
_LOCAL = {"ATS": "ats.csv", "PS": "ps.csv", "WS": "ws.csv"}


def inventory_versions(inventory_csv: str, level: str) -> dict[tuple[str, int], int]:
    """Parse a collection inventory into {(KIND, sol): version}."""
    coll = {"derived": "data_derived_env", "calibrated": "data_calibrated_env"}[level]
    pat = re.compile(rf"{coll}:we__(\d+)_+(?:der|cal)_([a-z0-9]+)_+p::(\d+)\.")
    out: dict[tuple[str, int], int] = {}
    for line in inventory_csv.splitlines():
        m = pat.search(line)
        if m:
            out[(m.group(2).upper(), int(m.group(1)))] = int(m.group(3))
    return out


# ------------------------------------------------------------------ download -
def _http_get(url: str) -> bytes:
    import requests  # verify=True is the default; never disabled here

    last: Exception | None = None
    for attempt in range(6):  # the Atmospheres Node resets connections now and then
        try:
            with requests.get(url, timeout=90, stream=True, verify=True) as r:
                r.raise_for_status()
                buf = bytearray()
                for chunk in r.iter_content(1 << 20):
                    buf += chunk
                    if len(buf) > MAX_BYTES:
                        raise ValueError("response too large")
                return bytes(buf)
        except (requests.ConnectionError, requests.Timeout, requests.exceptions.ChunkedEncodingError) as exc:
            last = exc
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"download failed: {url}") from last


def _read_lock(lock_path: Path) -> dict:
    if lock_path.exists():
        return json.loads(lock_path.read_text(encoding="utf-8"))
    return {"schemaVersion": "meda-lock/1", "files": {}}


def fetch_file(
    url: str,
    dest: Path,
    lock_path: Path = LOCK_PATH,
    getter: Callable[[str], bytes] | None = None,
    key: str | None = None,
) -> str:
    """Download ``url`` to ``dest``; record/verify its SHA-256 in the lock."""
    if not url.startswith("https://"):
        raise ValueError("only https:// URLs are allowed")
    data = (getter or _http_get)(url)
    digest = hashlib.sha256(data).hexdigest()
    key = key or Path(dest).name
    lock = _read_lock(Path(lock_path))
    known = lock["files"].get(key)
    if known and known["sha256"] != digest:
        raise IntegrityError(f"{key}: sha256 {digest} does not match the lock ({known['sha256']})")
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)
    if not known:
        lock["files"][key] = {"url": url, "sha256": digest, "bytes": len(data)}
        Path(lock_path).write_text(json.dumps(lock, indent=1, sort_keys=True) + "\n", encoding="utf-8")
    return digest


def fetch_sol(sol: int, root: Path, lock_path: Path = LOCK_PATH, getter=None, versions=None) -> Path:
    """Download the ATS/PS/WS products of one sol into ``root/sol_XXXX/``."""
    versions = versions or _inventory_versions_remote()
    out = Path(root) / f"sol_{sol:04d}"
    for level, kind in _PRODUCTS:
        ver = versions[level].get((kind, sol))
        if ver is None:
            raise LookupError(f"sol {sol}: no {level} {kind} product in the inventory")
        url = f"{DATA_BASE}/{product_relpath(level, kind, sol, ver)}"
        fetch_file(url, out / _LOCAL[kind], lock_path, getter, key=f"sol_{sol:04d}/{_LOCAL[kind]}")
    return out


def _inventory_versions_remote() -> dict:
    out = {}
    for level, name in (("derived", "collection_data_derived_env.csv"), ("calibrated", "collection_data_calibrated_env.csv")):
        out[level] = inventory_versions(_http_get(f"{INVENTORY_BASE}/{name}").decode("ascii"), level)
    return out


def load_sol(sol: int, root: Path) -> dict:
    d = Path(root) / f"sol_{sol:04d}"
    return summarize_sol(sol, d / "ats.csv", d / "ps.csv", d / "ws.csv")


if __name__ == "__main__":  # python -m marsx.conditions.meda fetch 313 ...
    cmd, *args = sys.argv[1:] or ["help"]
    root = Path(__file__).resolve().parents[4] / "data" / "raw" / "meda"
    if cmd == "fetch":
        for s in args:
            print(fetch_sol(int(s), root))
    elif cmd == "summary":
        for s in args:
            print(json.dumps(load_sol(int(s), root)["daily"]))
    else:
        print("usage: python -m marsx.conditions.meda fetch|summary SOL [SOL...]")
