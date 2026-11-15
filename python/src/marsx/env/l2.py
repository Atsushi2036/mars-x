"""L2 conditions for NavBatch: sun, insolation with shadows, MEDA weather, comms and energy sources.

Everything that depends only on time is precomputed once per scenario in 1-minute tables with the
marsx.conditions modules (single source: Mars24, Appelbaum-Flood insolation, JPL approximate ephemerides).
Per-agent, per-step work is table lookups + the 16-azimuth horizon test of the agent's cell.

Normalisation follows obs/1 (marsx.contracts.obs): environment block =
[sin(sunElev), sin(az), cos(az), sin(ltst), cos(ltst), (T_C+100)/80, tau/3, wind/30]; comm block =
[linkAvailable, timeToUplinkSols, owlt/22 min].

Missing measurements are never invented: temperature, tau and wind are ``MISSING`` (-1.0) when MEDA has no data
for that sol/hour (and no tau is given by the scenario). -1 is impossible for these fields (it would mean
-180 C, negative opacity or negative wind speed), so it is an unambiguous sentinel.
"""

from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from marsx.conditions import comms, energy, insolation, mars24
from marsx.contracts.scenario import Scenario
from marsx.env.terrain import Terrain

MISSING = -1.0
MINUTE_S = 60.0
PERSEVERANCE_LANDING_UTC = "2021-02-18T20:55:00Z"  # same convention as marsx.pipeline.tables (landing = sol 0)
SOL_S = mars24.SOL_DAYS * 86400.0


def utc_ms(text: str) -> int:
    dt = datetime.fromisoformat(text)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=UTC)
    return round(dt.timestamp() * 1000)


def _interp(rows: np.ndarray, f: np.ndarray, kind: str) -> np.ndarray:
    n = rows.shape[0]
    i0 = np.floor(f).astype(np.int64)
    i1 = np.minimum(i0 + 1, n - 1)
    w = (f - i0)[:, None]
    lo, hi = rows[i0].astype(np.float64), rows[i1].astype(np.float64)
    out = lo * (1 - w) + hi * w
    if kind == "sun_table":
        d_az = (hi[:, 0] - lo[:, 0] + 180.0) % 360.0 - 180.0
        out[:, 0] = (lo[:, 0] + d_az * w[:, 0]) % 360.0
    else:
        out[:, 1] = ((lo[:, 1] > 0.5) & (hi[:, 1] > 0.5)).astype(np.float64)
    return out


def _table_rows(terrain: Terrain, kind: str, t_ms: np.ndarray) -> tuple[str, np.ndarray] | None:
    """Values for ``t_ms`` from the pipeline's ``kind`` tables, or None if any instant is not covered.

    Same rule as the web reader (apps/explorer/src/intelligence/conditions/tables.ts): linear interpolation inside a
    table, azimuth on the circle, link available only if both bracketing rows say so. Consecutive per-sol sun tables
    are combined piecewise (each instant uses the first table that covers it).
    """
    cands = [(tid, rows, meta) for tid, (rows, meta) in (terrain.tables or {}).items()
             if (kind == "sun_table" and tid.startswith("sun_")) or (kind == "owlt_table" and tid == "owlt")]
    out = np.full((t_ms.size, 3 if kind == "sun_table" else 2), np.nan)
    used = []
    for tid, rows, meta in sorted(cands, key=lambda c: c[2]["startUtc"]):
        f = (t_ms - utc_ms(meta["startUtc"])) / 1000.0 / meta["stepS"]
        sel = np.isnan(out[:, 0]) & (f >= 0) & (f <= rows.shape[0] - 1)
        if sel.any():
            out[sel] = _interp(rows, f[sel], kind)
            used.append(tid)
    if not used or np.isnan(out[:, 0]).any():
        return None
    return "+".join(used), out


def perseverance_sol(unix_ms, lon_east_deg: float):
    """Perseverance sol number (local mean solar days since the landing sol) at ``lon_east_deg``."""
    day = np.floor(np.asarray(mars24.mars_sol_date(np.asarray(unix_ms, np.int64)), np.float64) + lon_east_deg / 360.0)
    day0 = np.floor(float(mars24.mars_sol_date(utc_ms(PERSEVERANCE_LANDING_UTC))) + lon_east_deg / 360.0)
    out = (day - day0).astype(np.int64)
    return int(out) if out.ndim == 0 else out


def load_meda(sols, root=None, published_dir=None) -> dict[int, dict]:
    """Summaries (marsx.conditions.meda format): raw CSVs under root / MARSX_MEDA / data/raw/meda, else the
    published per-sol summaries ``<dataset>/meda/sol-NNNN.json`` (what ``marsx.data.fetch`` downloads)."""
    import json
    import os
    from pathlib import Path

    from marsx.conditions import meda

    roots = [root] if root is not None else [os.environ.get("MARSX_MEDA"), "data/raw/meda", "../data/raw/meda"]
    if published_dir is not None and root is None:
        pub = {}
        for sol in sols:
            f = Path(published_dir) / f"sol-{int(sol):04d}.json"
            if f.exists():
                doc = json.loads(f.read_text(encoding="utf-8"))
                if doc.get("sol") == int(sol):
                    pub[int(sol)] = doc
        if pub:
            return pub
    out = {}
    for r in roots:
        if not r or not Path(r).exists():
            continue
        for sol in sols:
            if (Path(r) / f"sol_{int(sol):04d}" / "ats.csv").exists():
                out[int(sol)] = meda.load_sol(int(sol), Path(r))
        if out:
            break
    return out


class MarsConditions:
    """Time tables + per-cell lighting for one scenario. ``sol_summary`` uses the marsx.conditions.meda format."""

    def __init__(self, scenario: Scenario, terrain: Terrain, sol_summaries: dict[int, dict] | None = None,
                 meda_root=None):
        if scenario.time is None:
            raise ValueError("L2 conditions need scenario.time (startUtc, sols)")
        self.scenario = scenario
        self.t0_ms = utc_ms(scenario.time.start_utc)
        n = int(np.ceil(scenario.time.sols * SOL_S / MINUTE_S)) + 2
        t_ms = self.t0_ms + (np.arange(n) * MINUTE_S * 1000).astype(np.int64)
        st = mars24.mars_solar_state(t_ms, terrain.center_lat_deg, terrain.center_lon_east_deg)
        self.sources: dict[str, str] = {}
        sun = _table_rows(terrain, "sun_table", t_ms)
        if sun is not None:  # single source: the pipeline's precomputed table (same Mars24 code, same site)
            tid, rows = sun
            self.az, self.elev, r_au = rows[:, 0] % 360.0, rows[:, 1], rows[:, 2]
            self.sources["sun"] = f"table:{tid}"
        else:
            self.az = np.asarray(st.azimuth_deg, np.float64) % 360.0
            self.elev, r_au = np.asarray(st.elevation_deg, np.float64), np.asarray(st.r_au, np.float64)
            self.sources["sun"] = "mars24"
        self.zen = 90.0 - self.elev
        self.ltst = np.asarray(st.ltst_h, np.float64)
        self.lmst = np.asarray(st.lmst_h, np.float64)
        # MEDA: per-minute sol number -> that sol's hourly series (by LMST hour); tau from MEDA, else scenario
        sol_of = perseverance_sol(t_ms, terrain.center_lon_east_deg)
        if sol_summaries is None:
            wanted = sorted(set(scenario.conditions.meda_sols) | set(np.unique(sol_of).tolist()))
            pub = None if terrain.data_dir is None else Path(terrain.data_dir) / "meda"
            sol_summaries = load_meda(wanted, meda_root, pub) if scenario.conditions.meda_sols else {}
        self.sources["meda"] = "sols:" + ",".join(str(k) for k in sorted(sol_summaries)) if sol_summaries else "none"
        hour = np.floor(self.lmst).astype(np.int64) % 24
        temp_k, wind, tau = np.full(n, np.nan), np.full(n, np.nan), np.full(n, np.nan)
        for sol, summ in sol_summaries.items():
            m = sol_of == sol
            if not m.any():
                continue
            hs = {int(h["hour"]): h for h in summ.get("hours", [])}
            temp_k[m] = [np.nan if hs.get(h, {}).get("temperatureK") is None else hs[h]["temperatureK"] for h in hour[m]]
            wind[m] = [np.nan if hs.get(h, {}).get("windSpeedMs") is None else hs[h]["windSpeedMs"] for h in hour[m]]
            if summ.get("tau") is not None:
                tau[m] = float(summ["tau"])
        if scenario.conditions.tau is not None:
            tau = np.where(np.isnan(tau), float(scenario.conditions.tau.value), tau)
        self.temp_c, self.wind, self.tau_series = temp_k - 273.15, wind, tau
        self.tau = float(np.nanmean(tau)) if np.isfinite(tau).any() else 0.0  # irradiance needs a value; see note
        self.tau_known = bool(np.isfinite(tau).all())
        _glob, direct, diffuse = insolation.surface_irradiance(self.zen, np.nan_to_num(tau, nan=self.tau), r_au)
        self.direct, self.diffuse = np.asarray(direct, np.float64), np.asarray(diffuse, np.float64)
        # comms: link (conjunction moratorium), OWLT, next uplink (one plan per sol)
        ow = _table_rows(terrain, "owlt_table", t_ms)
        if ow is not None:
            self.owlt_s, self.link = ow[1][:, 0], ow[1][:, 1] > 0.5
            self.sources["owlt"] = f"table:{ow[0]}"
        else:
            self.owlt_s = np.asarray(comms.owlt_s(t_ms), np.float64)
            self.link = np.asarray(comms.link_available(t_ms), bool)
            self.sources["owlt"] = "comms"
        cm = scenario.conditions.comm
        self.comm_mode = cm.mode
        if cm.mode == "one_plan_per_sol":
            up = comms.uplink_receive_times_ms(int(t_ms[0]), int(t_ms[-1] + 2 * SOL_S * 1000),
                                               cm.uplink_lmst_h if cm.uplink_lmst_h is not None else 9.0,
                                               terrain.center_lon_east_deg)
            nxt = np.searchsorted(up, t_ms)
            nxt_ms = np.where(nxt < up.size, up[np.minimum(nxt, up.size - 1)], t_ms + SOL_S * 1000)
            self.to_uplink_sols = (nxt_ms - t_ms) / 1000.0 / SOL_S
        else:
            self.to_uplink_sols = np.zeros(n)
        # per-cell sky
        self.horizon = terrain.horizon_deg
        if terrain.sky_view is not None:
            self.svf = terrain.sky_view.astype(np.float32)
            self.sources["skyView"] = "layer:sky_view"
        elif self.horizon is not None:
            h = np.radians(self.horizon.astype(np.float32))
            self.svf = np.mean(np.cos(h) ** 2, axis=0).astype(np.float32)
        else:
            self.svf = None
        self.n = n

    # ------------------------------------------------------------------ lookups
    def _idx(self, t_s: np.ndarray) -> np.ndarray:
        return np.clip((np.asarray(t_s) / MINUTE_S).astype(np.int64), 0, self.n - 1)

    def lit(self, t_s: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray:
        i = self._idx(t_s)
        up = self.elev[i] > 0
        if self.horizon is None:
            return up
        pos = self.az[i] / 22.5
        i0 = np.floor(pos).astype(np.int64) % 16
        w = pos - np.floor(pos)
        hz = self.horizon[i0, rows, cols].astype(np.float64) * (1 - w) + self.horizon[(i0 + 1) % 16, rows, cols] * w
        return up & (self.elev[i] > hz)

    def irradiance(self, t_s, rows, cols) -> np.ndarray:
        """Global irradiance on a horizontal panel at the agent cell (W/m2): direct if lit + diffuse x sky view."""
        i = self._idx(t_s)
        svf = 1.0 if self.svf is None else self.svf[rows, cols]
        return np.where(self.lit(t_s, rows, cols), self.direct[i], 0.0) + self.diffuse[i] * svf

    def generation_w(self, kind: str, t_s, rows, cols) -> np.ndarray:
        if kind == "solar_rover":
            return np.asarray(energy.solar_power_w(self.irradiance(t_s, rows, cols)), np.float64)
        if kind == "rtg_rover":
            return np.full(np.shape(t_s), energy.rtg_power_w(0.0))
        return np.zeros(np.shape(t_s))

    def features(self, t_s, rows, cols) -> np.ndarray:
        i = self._idx(t_s)
        el, az = np.radians(self.elev[i]), np.radians(self.az[i])
        ang = 2 * np.pi * self.ltst[i] / 24.0
        temp = np.clip((self.temp_c[i] + 100.0) / 80.0, 0, 1)
        wind = np.clip(self.wind[i] / 30.0, 0, 1)
        tau = np.clip(self.tau_series[i] / 3.0, 0, 1)
        out = np.stack([np.sin(el), np.sin(az), np.cos(az), np.sin(ang), np.cos(ang),
                        np.where(np.isnan(temp), MISSING, temp), np.where(np.isnan(tau), MISSING, tau),
                        np.where(np.isnan(wind), MISSING, wind)], 1)
        return out.astype(np.float32)

    def comm(self, t_s) -> np.ndarray:
        i = self._idx(t_s)
        return np.stack([self.link[i].astype(np.float64), np.clip(self.to_uplink_sols[i], 0, 1),
                         np.clip(self.owlt_s[i] / (22 * 60), 0, 1)], 1).astype(np.float32)
