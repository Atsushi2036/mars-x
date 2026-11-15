"""In-place dataset update: sun tables for the clear sols, millisecond startUtc, HiRISE credit, consistent contentHash."""

from __future__ import annotations

import hashlib
import json
import shutil
from datetime import datetime
from pathlib import Path

import numpy as np
import pytest
from marsx import schemas
from marsx.pipeline import tables

DATA = Path(__file__).resolve().parents[2] / "data" / "processed" / "jezero-v1"


@pytest.fixture()
def dataset(tmp_path):
    if not (DATA / "manifest.json").exists():
        pytest.skip("processed dataset not built")
    d = tmp_path / "jezero-v1"
    d.mkdir()
    shutil.copy(DATA / "manifest.json", d / "manifest.json")
    shutil.copytree(DATA / "sun", d / "sun")
    return d


def test_update_adds_clear_sol_tables_with_ms_start_and_fixes_credit(dataset):
    tables.update_dataset(dataset, sun_sols=(148, 149, 313, 314, 315))
    m = schemas.Manifest.model_validate_json((dataset / "manifest.json").read_text(encoding="utf-8"))
    sun = {l.id: l for l in m.layers if l.kind == "sun_table"}
    assert {"sun_sol_148", "sun_sol_149", "sun_sol_313", "sun_sol_314", "sun_sol_315"} <= set(sun)
    lay = sun["sun_sol_148"]
    raw = (dataset / lay.path).read_bytes()
    assert hashlib.sha256(raw).hexdigest() == lay.sha256 and lay.bytes == len(raw)
    rows = np.frombuffer(raw, "<f4").reshape(lay.shape)
    assert rows.shape == (1481, 3) and rows[:, 1].max() > 40  # the sun rises high on an aphelion sol
    start = lay.table.start_utc
    assert "." in start and start.endswith("Z")  # millisecond precision (was truncated to seconds)
    ms = int(datetime.fromisoformat(start).timestamp() * 1000)
    assert ms == tables.perseverance_sol_start_ms(148, m.crs.center.lon)
    expect = hashlib.sha256((m.pipeline.params_hash + "".join(
        f"{l.path}:{l.sha256}\n" for l in sorted(m.layers, key=lambda x: x.id))).encode()).hexdigest()
    assert m.content_hash == expect
    text = (dataset / "manifest.json").read_text(encoding="utf-8")
    assert "JPL-Caltech/University of Arizona" not in text and "NASA/JPL/University of Arizona" in text


def test_update_is_idempotent(dataset):
    tables.update_dataset(dataset, sun_sols=(148, 149))
    first = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    tables.update_dataset(dataset, sun_sols=(148, 149))
    second = json.loads((dataset / "manifest.json").read_text(encoding="utf-8"))
    assert first["contentHash"] == second["contentHash"]
    assert [l["id"] for l in first["layers"]] == [l["id"] for l in second["layers"]]
