import hashlib
import json
from pathlib import Path

import pytest

from marsx.conditions import meda

ATS_HDR = "SCLK,LMST,LTST,ATS_LOCAL_TEMP1,ATS_LOCAL_TEMP2,ATS_LOCAL_TEMP3,ATS_LOCAL_TEMP4,ATS_LOCAL_TEMP5\n"
PS_HDR = "SCLK,LMST,LTST,PRESSURE,PRESSURE_UNCERTAINTY,TRANSDUCER\n"
WS_HDR = ("SCLK,LMST,LTST,HORIZONTAL_WIND_SPEED,HORIZONTAL_WIND_SPEED_UNCERTAINTY,VERTICAL_WIND_SPEED,"
          "VERTICAL_WIND_SPEED_UNCERTAINTY,WIND_DIRECTION,WIND_DIRECTION_UNCERTAINTY,BOTH_BOOMS_USED_FOR_RETRIEVAL,ROVER_STILL\n")


def lmst(sol, h, m, s):
    return f"{sol:05d}M{h:02d}:{m:02d}:{s:02d}.000"


def write(tmp_path, name, text):
    p = tmp_path / name
    p.write_text(text)
    return p


def test_lmst_hour_parsing():
    assert meda.lmst_hour("00313M00:00:01.618") == pytest.approx(1.618 / 3600)
    assert meda.lmst_hour("00313M13:30:00.000") == 13.5
    with pytest.raises(ValueError):
        meda.lmst_hour("0313 00:33:54")  # LTST format, not LMST


def test_missing_and_invalid_values_are_none():
    assert meda.parse_value("") is None
    assert meda.parse_value("9999999999") is None
    assert meda.parse_value("nan") is None
    assert meda.parse_value("12.5") == 12.5


def make_sol(tmp_path, sol=5, hours=(2, 3), n=3600, step=1, drop_wind_hour=3):
    ats, ps, ws = [ATS_HDR], [PS_HDR], [WS_HDR]
    for h in hours:
        for i in range(0, n, step):
            t = lmst(sol, h, i // 60, i % 60)
            ats.append(f"1,{t},x,{200 + h},{202 + h},{204 + h},300,301\n")  # median of 1-3 = 202 + h
            ps.append(f"1,{t},x,{700 + h},,1\n")
            if h != drop_wind_hour:
                ws.append(f"1,{t},x,{h}.0,,,,90,,,1\n" if i else f"1,{t},x,{h + 10}.0,,,,90,,,1\n")
            else:
                ws.append(f"1,{t},x,,,,,,,,1\n")  # sensor row present but no value
    return (write(tmp_path, "ats.csv", "".join(ats)), write(tmp_path, "ps.csv", "".join(ps)),
            write(tmp_path, "ws.csv", "".join(ws)))


def test_hourly_summary_values_and_no_data(tmp_path):
    ats, ps, ws = make_sol(tmp_path)
    s = meda.summarize_sol(5, ats_path=ats, ps_path=ps, ws_path=ws)
    assert s["sol"] == 5 and len(s["hours"]) == 24
    h2, h3, h9 = s["hours"][2], s["hours"][3], s["hours"][9]
    assert h2["temperatureK"] == pytest.approx(204.0)  # median(202,204,206) per sample
    assert h2["pressurePa"] == pytest.approx(702.0)
    assert h2["windSpeedMs"] == pytest.approx((2.0 * 3599 + 12.0) / 3600)
    assert h2["windMaxMs"] == 12.0
    assert h3["windSpeedMs"] is None and h3["windMaxMs"] is None  # no wind values -> No data
    assert h3["temperatureK"] == pytest.approx(205.0)
    assert h9["temperatureK"] is None and h9["pressurePa"] is None and h9["nSamples"] == 0
    assert s["tau"] is None
    json.dumps(s, allow_nan=False)  # strict JSON, no NaN/inf


def test_short_burst_is_no_data(tmp_path):
    ats, ps, ws = make_sol(tmp_path, n=600)  # only 10 distinct minutes of the hour
    s = meda.summarize_sol(5, ats_path=ats, ps_path=ps, ws_path=ws)
    assert all(h["temperatureK"] is None and h["pressurePa"] is None for h in s["hours"])


def test_sparse_cadence_covering_the_hour_is_valid(tmp_path):
    ats, ps, ws = make_sol(tmp_path, step=11)  # one sample every 11 s, spread over the whole hour
    s = meda.summarize_sol(5, ats_path=ats, ps_path=ps, ws_path=ws)
    assert s["hours"][2]["temperatureK"] == pytest.approx(204.0)


def test_invalid_markers_ignored():
    assert meda.parse_value("999999999") is None
    assert meda.parse_value("-9999999999") is None


def test_daily_stats_ignore_missing(tmp_path):
    ats, ps, ws = make_sol(tmp_path)
    s = meda.summarize_sol(5, ats_path=ats, ps_path=ps, ws_path=ws)
    d = s["daily"]
    assert d["temperatureMinK"] == pytest.approx(204.0) and d["temperatureMaxK"] == pytest.approx(205.0)
    assert d["hoursWithData"] == 2 and d["windMeanMs"] > 0
    assert d["windMaxMs"] == 12.0


def test_render_no_data():
    assert meda.fmt(None, "K") == "No data"
    assert meda.fmt(201.234, "K", 1) == "201.2 K"


def test_sol_path_layout():
    rel = meda.product_relpath("derived", "PS", 313, 3)
    assert rel == "data_derived_env/sol_0300_0419/sol_0313/WE__0313___________DER_PS__________________P03.CSV"
    assert meda.product_relpath("calibrated", "ATS", 5, 1) == (
        "data_calibrated_env/sol_0000_0089/sol_0005/WE__0005___________CAL_ATS_________________P01.CSV")
    assert meda.sol_bin(0) == "sol_0000_0089" and meda.sol_bin(179) == "sol_0090_0179"
    assert meda.sol_bin(299) == "sol_0180_0299" and meda.sol_bin(419) == "sol_0300_0419"
    assert meda.sol_bin(420) == "sol_0420_0539"


def test_download_verifies_tls_hash_and_rejects_http(tmp_path):
    payload = b"SCLK,LMST\n1,2\n"
    lock = tmp_path / "lock.json"
    calls = []

    def fake_get(url):
        calls.append(url)
        return payload

    dest = tmp_path / "raw"
    meda.fetch_file("https://example.org/a.csv", dest / "a.csv", lock, getter=fake_get)
    assert (dest / "a.csv").read_bytes() == payload
    entry = json.loads(lock.read_text())["files"]["a.csv"]
    assert entry["sha256"] == hashlib.sha256(payload).hexdigest() and entry["url"] == "https://example.org/a.csv"
    # second fetch with the same lock must verify the hash
    meda.fetch_file("https://example.org/a.csv", dest / "a2.csv", lock, getter=lambda u: payload, key="a.csv")
    with pytest.raises(meda.IntegrityError):
        meda.fetch_file("https://example.org/a.csv", dest / "a3.csv", lock, getter=lambda u: b"tampered", key="a.csv")
    with pytest.raises(ValueError):
        meda.fetch_file("http://example.org/a.csv", dest / "b.csv", lock, getter=fake_get)


REAL = Path(__file__).resolve().parents[3] / "data" / "raw" / "meda"


@pytest.mark.skipif(not (REAL / "sol_0313").exists(), reason="MEDA data not downloaded (marsx.conditions.meda fetch)")
def test_real_storm_sol_313_is_sane():
    s = meda.load_sol(313, REAL)
    d = s["daily"]
    assert d["hoursWithData"] >= 6
    assert 150 < d["temperatureMinK"] < d["temperatureMaxK"] < 300
    assert 500 < d["pressureMinPa"] < d["pressureMaxPa"] < 1000
    assert s["season"] == "dust-storm"
    assert s["tau"] == 2.0 and s["tauProvenance"] == "source" and "Lemmon" in s["tauSource"]


def test_registry_and_tau_provenance():
    assert {148, 313, 314, 315} <= set(meda.SOLS)
    assert meda.SOLS[148]["season"] == "aphelion-clear" and 148 not in meda.TAU_LITERATURE  # clear: tau "No data"
    assert all(meda.TAU_LITERATURE[s][0] == 2.0 for s in (313, 314, 315))


@pytest.mark.skipif(not (REAL / "sol_0148").exists(), reason="MEDA data not downloaded")
def test_real_clear_sol_148_has_no_tau_and_some_hours():
    s = meda.load_sol(148, REAL)
    assert s["tau"] is None and s["season"] == "aphelion-clear" and s["daily"]["hoursWithData"] >= 6


LOCK = Path(__file__).resolve().parents[2] / "src" / "marsx" / "conditions" / "meda.lock.json"


@pytest.mark.skipif(not REAL.exists(), reason="MEDA data not downloaded")
def test_downloaded_files_match_committed_lock():
    lock = json.loads(LOCK.read_text())["files"]
    checked = 0
    for key, entry in lock.items():
        f = REAL / key
        if f.exists():
            assert hashlib.sha256(f.read_bytes()).hexdigest() == entry["sha256"], key
            checked += 1
    assert checked > 0


def test_http_get_retries_on_mid_stream_reset(monkeypatch):
    import requests

    attempts = {"n": 0}

    class Resp:
        def __init__(self, fail):
            self.fail = fail

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def raise_for_status(self):
            pass

        def iter_content(self, n):
            if self.fail:
                raise requests.exceptions.ChunkedEncodingError("reset")
            yield b"abc"

    def fake_get(url, **kw):
        assert kw.get("verify", True) is True  # TLS verification must never be disabled
        attempts["n"] += 1
        return Resp(fail=attempts["n"] < 3)

    monkeypatch.setattr(requests, "get", fake_get)
    monkeypatch.setattr(meda.time, "sleep", lambda s: None)
    assert meda._http_get("https://example.org/x") == b"abc" and attempts["n"] == 3
