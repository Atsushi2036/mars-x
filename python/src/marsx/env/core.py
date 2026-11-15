"""NavBatch: the single NumPy implementation of MarsX/Jezero-v1 dynamics, stepping N episodes at once.

Data parallelism instead of processes: every map is stored once as a padded flat array; local patches for all
agents are one fancy-indexing gather (``pos[:, None] + offsets``). The single-agent Gymnasium env, the vector
env and the SB3 adapter all wrap this class, so they are identical by construction.

Units: cells of ``terrain.res_m`` metres; time in seconds; rows grow southwards (obs/1, act/1).
Scope v0.1: geometry (L1), energy accounting (rover RTG / astronaut, marsx.conditions.energy) and hidden rocks
revealed by a range sensor (L3, marsx.conditions.rocks). L2 (sun, shadows, insolation, MEDA weather, comms,
solar/RTG generation, astronaut space-weather rule) comes from ``marsx.env.l2.MarsConditions``, built
automatically when the scenario has ``time`` and any L2 switch on.
"""

from __future__ import annotations

import math
from typing import Protocol

import numpy as np
from scipy import ndimage

from marsx.conditions import energy as en
from marsx.conditions import rocks as rk
from marsx.conditions import spaceweather as sw
from marsx.contracts import obs as spec
from marsx.contracts.scenario import Scenario
from marsx.env.terrain import Terrain, cost_map

OUTCOMES = ("", "success", "collision", "battery", "stuck", "spe_violation", "timeout")
RUNNING, SUCCESS, COLLISION, BATTERY, STUCK, SPE, TIMEOUT = range(7)
DEFAULT_ROCK_SEED = 20261115
RISK_SLOPE_DEG = 15.0
_MOVES = np.array([(a.drow, a.dcol) for a in spec.ACTIONS], dtype=np.int64)
_DIST = np.array([math.hypot(a.drow, a.dcol) for a in spec.ACTIONS], dtype=np.float64)
_ENV, _COMM = spec.block("environment"), spec.block("comm")


class ConditionsHook(Protocol):
    """L2 provider (implemented by marsx.env.l2.MarsConditions)."""

    def features(self, t_s: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray: ...

    def comm(self, t_s: np.ndarray) -> np.ndarray: ...

    def generation_w(self, kind: str, t_s: np.ndarray, rows: np.ndarray, cols: np.ndarray) -> np.ndarray: ...


def needs_l2(scenario: Scenario) -> bool:
    c = scenario.conditions
    return scenario.time is not None and (c.lighting or c.energy or c.comm.mode != "none" or c.spe.enabled)


def rock_mask(shape: tuple[int, int], res_m: float, k: float, seed: int) -> np.ndarray:
    """Hidden-rock hazard cells from the Golombek-Rapp field (marsx.conditions.rocks)."""
    field = rk.generate_rocks(seed, shape[1] * res_m, shape[0] * res_m, k=k)
    return rk.rasterize_max_height(field, shape, res_m) > rk.HAZARD_HEIGHT.value


class NavBatch:
    def __init__(self, terrain: Terrain, scenario: Scenario, num_envs: int, seed: int | None = 0, *,
                 autoreset: bool = True, r_min: float = 10, r_max: float = 60, region: np.ndarray | None = None,
                 rocks: np.ndarray | None = None, rock_seed: int = DEFAULT_ROCK_SEED,
                 sensor_radius_m: float | None = None, conditions: ConditionsHook | str | None = "auto",
                 sol_summaries: dict[int, dict] | None = None, meda_root=None, wait_s: float = 60.0,
                 record: bool = False):
        self.terrain, self.scenario, self.N = terrain, scenario, int(num_envs)
        self.autoreset, self.r_min, self.r_max, self.wait_s, self.record = autoreset, r_min, r_max, wait_s, record
        if conditions == "auto":
            from marsx.env.l2 import MarsConditions

            conditions = MarsConditions(scenario, terrain, sol_summaries, meda_root) if needs_l2(scenario) else None
        self.conditions = conditions
        ag = scenario.agent
        self.kind = ag.kind
        self.speed = float(ag.speed_m_s.value)
        self.res = float(terrain.res_m)
        self.gravity = float(scenario.conditions.gravity.value)
        self.w = scenario.reward
        self.max_steps = scenario.max_steps
        self.energy_on = scenario.conditions.energy
        self.capacity_wh = en.eva_consumables_wh() if self.kind == "astronaut" else en.battery_capacity_wh()
        self.recharge_w = en.rtg_power_w(0.0) if self.kind == "rtg_rover" else 0.0
        self.idle_w = en.PARAMS["met_rate_low_w"].value if self.kind == "astronaut" else en.PARAMS["base_load_w"].value
        self.spe_on = self.kind == "astronaut" and scenario.conditions.spe.enabled
        self.spe_window_s = float(scenario.conditions.spe.warning_min.value) * 60.0
        H, W = terrain.shape
        self.H, self.W = H, W
        p = spec.PATCH_K // 2
        self.p, self.Wp = p, W + 2 * p

        cost = cost_map(terrain, float(ag.max_slope_deg.value), float(ag.max_step_m.value))
        self.cost = cost
        cost_p = np.pad(cost, p, constant_values=np.inf)
        self.cost_flat = cost_p.ravel()
        blocked = ~np.isfinite(cost_p)
        self.cost_norm_flat = np.where(blocked, 1.0, np.clip((np.where(blocked, 1, cost_p) - 1) / 4, 0, 1)) \
            .astype(np.float32).ravel()
        self.hazard_flat = blocked.astype(np.float32).ravel()
        self.slope_flat = np.pad(np.nan_to_num(terrain.slope_deg, nan=90.0), p, constant_values=90.0).ravel()
        finite_h = np.isfinite(terrain.height_m)
        h = np.where(finite_h, terrain.height_m, float(terrain.height_m[finite_h].mean()) if finite_h.any() else 0.0)
        self.height_flat = np.pad(h, p, mode="edge").astype(np.float32).ravel()

        hr = scenario.conditions.hidden_rocks
        if rocks is None and hr.enabled:
            k = float(hr.abundance_k.value) if hr.abundance_k is not None else 0.05
            rocks = rock_mask((H, W), self.res, k, rock_seed)
        self.rocks = np.zeros((H, W), bool) if rocks is None else rocks.astype(bool)
        self.rocks_flat = np.pad(self.rocks, p).ravel()
        rr = sensor_radius_m
        if rr is None and hr.sensor_radius_m is not None:
            rr = float(hr.sensor_radius_m.value)
        if rr is None:
            rr = rk.SENSOR_RADIUS.value if hr.enabled else 0.0
        oy, ox = np.mgrid[-p:p + 1, -p:p + 1]
        self.offsets = (oy * self.Wp + ox).ravel().astype(np.int64)
        self.sensor_mask = ((np.hypot(oy, ox) * self.res) <= rr).ravel().astype(np.float32)
        self.move_off = _MOVES[:, 0] * self.Wp + _MOVES[:, 1]

        passable = np.isfinite(cost) & ~self.rocks
        if region is None:
            win = scenario.window
            region = np.zeros((H, W), bool)
            region[win.row0:win.row0 + win.rows, win.col0:win.col0 + win.cols] = True
        passable &= region.astype(bool)
        self.components, _ = ndimage.label(passable, structure=np.ones((3, 3), int))
        self.free = np.flatnonzero(passable)
        if self.free.size == 0:
            raise ValueError("terrain has no passable cells in the scenario window")

        n = self.N
        z = lambda dt: np.zeros(n, dt)  # noqa: E731
        self.pos, self.goal, self.start = z(np.int64), z(np.int64), z(np.int64)
        self.t_s, self.path_m, self.path_cost, self.energy_wh, self.risk_s = (z(np.float64) for _ in range(5))
        self.steps, self.violations, self.shield = z(np.int32), z(np.int32), z(np.int32)
        self.soc = np.ones(n, np.float32)
        self.heading = z(np.float32)
        self.alert_t = np.full(n, np.nan)
        self.spe_state = np.zeros(n, np.uint8)
        self.shelter = z(np.int64)
        self.trajs: list[list[tuple]] = [[] for _ in range(n)]
        self.finished: list[dict] = []
        self.seed(seed)

    # ------------------------------------------------------------------ helpers
    def seed(self, seed: int | None) -> None:
        self.rng = np.random.default_rng(seed)

    def _to_flat(self, rc) -> np.ndarray:
        rc = np.asarray(rc, np.int64).reshape(-1, 2)
        return (rc[:, 0] + self.p) * self.Wp + rc[:, 1] + self.p

    def _rc(self, flat: np.ndarray) -> np.ndarray:
        return np.stack([flat // self.Wp - self.p, flat % self.Wp - self.p], axis=1)

    def cell(self, i: int) -> tuple[int, int]:
        r, c = self._rc(self.pos[i:i + 1])[0]
        return int(r), int(c)

    def cells(self) -> np.ndarray:
        return self._rc(self.pos)

    def start_cells(self) -> np.ndarray:
        return self._rc(self.start)

    def goal_cells(self) -> np.ndarray:
        return self._rc(self.goal)

    # ------------------------------------------------------------------ episodes
    def _sample(self, idx: np.ndarray) -> None:
        """Random start + goal at distance [r_min, r_max] cells in the same 8-connected passable component."""
        m = idx.size
        s = self.free[self.rng.integers(0, self.free.size, m)]
        sr, sc = s // self.W, s % self.W
        g = np.full(m, -1, np.int64)
        todo = np.arange(m)
        for attempt in range(256):
            if todo.size == 0:
                break
            if attempt and attempt % 32 == 0:  # starts in small components: draw new starts for the stragglers
                s_new = self.free[self.rng.integers(0, self.free.size, todo.size)]
                sr[todo], sc[todo] = s_new // self.W, s_new % self.W
            ang = self.rng.uniform(0, 2 * np.pi, todo.size)
            rad = self.rng.uniform(self.r_min, self.r_max, todo.size)
            gr = np.rint(sr[todo] + rad * np.sin(ang)).astype(np.int64)
            gc = np.rint(sc[todo] + rad * np.cos(ang)).astype(np.int64)
            d = np.hypot(gr - sr[todo], gc - sc[todo])
            ok = (gr >= 0) & (gr < self.H) & (gc >= 0) & (gc < self.W) & (d >= self.r_min) & (d <= self.r_max)
            gr, gc = np.where(ok, gr, 0), np.where(ok, gc, 0)
            same = ok & (self.components[gr, gc] == self.components[sr[todo], sc[todo]]) & (self.components[gr, gc] > 0)
            g[todo[same]] = gr[same] * self.W + gc[same]
            todo = todo[~same]
        if todo.size:
            raise RuntimeError(f"could not sample {todo.size} episodes with goals {self.r_min}-{self.r_max} cells away")
        self._set(idx, np.stack([sr, sc], 1), np.stack([g // self.W, g % self.W], 1))

    def _set(self, idx, starts, goals) -> None:
        idx = np.asarray(idx, np.int64)
        self.pos[idx] = self.start[idx] = self._to_flat(starts)
        self.goal[idx] = self._to_flat(goals)
        for arr in (self.t_s, self.steps, self.path_m, self.path_cost, self.heading, self.energy_wh, self.risk_s,
                    self.violations, self.shield):
            arr[idx] = 0
        self.soc[idx] = 1.0
        self.shelter[idx] = self.start[idx]
        self.spe_state[idx] = sw.IDLE
        if self.spe_on:
            horizon = self.max_steps * self.res / self.speed
            self.alert_t[idx] = sw.generate_alerts(int(self.rng.integers(0, 2**62)), idx.size, horizon)
        else:
            self.alert_t[idx] = np.nan
        if self.record:
            for i in idx:
                self.trajs[i] = [(*self.cell(int(i)), 0.0, 1.0, spec.WAIT)]

    def reset(self, seed: int | None = None) -> np.ndarray:
        if seed is not None:
            self.seed(seed)
        self._sample(np.arange(self.N))
        return self.observe()

    def reset_to(self, idx, starts, goals) -> np.ndarray:
        """Set explicit start/goal cells (benchmark episodes); cells are (row, col) of the full grid."""
        self._set(np.asarray(idx), starts, goals)
        return self.observe()

    # ------------------------------------------------------------------ observation (obs/1)
    def observe(self, idx: np.ndarray | None = None) -> np.ndarray:
        sel = slice(None) if idx is None else idx
        pos, goal = self.pos[sel], self.goal[sel]
        n = pos.size
        patch = pos[:, None] + self.offsets[None, :]
        rel = np.clip((self.height_flat[patch] - self.height_flat[pos][:, None]) / 5.0, -1, 1)
        rocks = self.rocks_flat[patch] * self.sensor_mask[None, :]
        dr = (goal // self.Wp - pos // self.Wp).astype(np.float32)
        dc = (goal % self.Wp - pos % self.Wp).astype(np.float32)
        d = np.hypot(dr, dc)
        safe = np.where(d > 0, d, 1)
        hd = self.heading[sel]
        agent = np.stack([self.soc[sel], np.zeros(n, np.float32), np.sin(hd), np.cos(hd)], 1)
        if self.conditions is not None:
            rc = self._rc(pos)
            env = self.conditions.features(self.t_s[sel], rc[:, 0], rc[:, 1])
            comm = self.conditions.comm(self.t_s[sel])
        else:
            env = np.zeros((n, _ENV.size), np.float32)
            comm = np.zeros((n, _COMM.size), np.float32)
            comm[:, 0] = 1.0
        sols = self.scenario.time.sols if self.scenario.time is not None else None
        sol_left = np.ones(n) if sols is None else np.clip(1 - self.t_s[sel] / (sols * 88775.244), 0, 1)
        steps_left = np.clip(1 - self.steps[sel] / self.max_steps, 0, 1)
        return np.concatenate([
            self.cost_norm_flat[patch], self.hazard_flat[patch], rel, rocks,
            np.clip(np.stack([dr / 64, dc / 64, dr / safe, dc / safe], 1), -1, 1),
            agent, env, comm, np.stack([sol_left, steps_left], 1),
        ], axis=1).astype(np.float32)

    # ------------------------------------------------------------------ dynamics
    def _energy(self, dist_m: np.ndarray, slope: np.ndarray) -> np.ndarray:
        if self.kind == "astronaut":
            return np.asarray(en.astronaut_step_energy_wh(dist_m, slope), np.float64)
        return np.asarray(en.rover_drive_energy_wh(dist_m, slope, self.gravity), np.float64)

    def step(self, actions: np.ndarray, active: np.ndarray | None = None):
        """Advance every active env by one action. Inactive envs (``active`` False) are left untouched."""
        a = np.asarray(actions, np.int64).reshape(self.N)
        act = np.ones(self.N, bool) if active is None else np.asarray(active, bool)
        w = self.w
        pos = self.pos
        wait = (a == spec.WAIT) & act
        target = pos + self.move_off[a]
        try_move = act & ~wait
        mvs = _MOVES[a]
        diag = (mvs[:, 0] != 0) & (mvs[:, 1] != 0)
        corner = diag & (~np.isfinite(self.cost_flat[pos + mvs[:, 0] * self.Wp])
                         | ~np.isfinite(self.cost_flat[pos + mvs[:, 1]]))  # no corner cutting (as marsx.nav)
        blocked = try_move & (~np.isfinite(self.cost_flat[target]) | corner)
        rock = try_move & ~blocked & self.rocks_flat[target]
        moved = try_move & ~blocked & ~rock
        new = np.where(moved, target, pos)
        cost_inc = np.where(moved, _DIST[a] * 0.5 * (self.cost_flat[pos] + np.where(moved, self.cost_flat[target], 0)), 0.0)
        dist_m = np.where(moved, _DIST[a] * self.res, 0.0)
        dt = np.where(moved, dist_m / self.speed, np.where(wait, self.wait_s, 0.0))
        rise = self.height_flat[new] - self.height_flat[pos]
        slope_signed = np.where(moved, np.sign(rise) * self.slope_flat[new], 0.0)
        e_wh = np.where(moved, self._energy(dist_m, slope_signed), 0.0) + np.where(wait, self.idle_w * dt / 3600.0, 0.0)
        if self.conditions is not None:
            rc0 = self._rc(pos)
            gen_wh = self.conditions.generation_w(self.kind, self.t_s, rc0[:, 0], rc0[:, 1]) * dt / 3600.0
        else:
            gen_wh = self.recharge_w * dt / 3600.0

        def gdist(q):
            return np.hypot(self.goal // self.Wp - q // self.Wp, self.goal % self.Wp - q % self.Wp)

        progress = gdist(pos) - gdist(new)
        mv = _MOVES[a]
        self.heading = np.where(moved, np.arctan2(mv[:, 1], -mv[:, 0]), self.heading).astype(np.float32)
        self.pos = new
        self.t_s += dt
        self.steps += act
        self.path_m += dist_m
        self.path_cost += cost_inc
        self.energy_wh += e_wh
        self.risk_s += np.where(moved & (self.slope_flat[new] > RISK_SLOPE_DEG), dt, 0.0)
        self.violations += rock
        self.shield += blocked
        if self.energy_on:
            delta = (gen_wh - e_wh) / self.capacity_wh
            self.soc = np.where(act, np.clip(self.soc + delta, 0, 1), self.soc).astype(np.float32)

        spe_viol = np.zeros(self.N, bool)
        if self.spe_on:
            prev = self.spe_state.copy()
            self.spe_state = np.where(act, sw.update(self.spe_state, self.t_s, self.alert_t, new == self.shelter,
                                                     self.spe_window_s), self.spe_state)
            fired = (prev == sw.IDLE) & (self.spe_state != sw.IDLE)
            self.goal = np.where(fired, self.shelter, self.goal)  # the alert redirects the goal to the shelter
            spe_viol = act & (self.spe_state == sw.VIOLATED)
        reached = act & (new == self.goal) & ~spe_viol
        battery = act & (self.soc <= 0) & ~reached
        terminated = reached | rock | battery | spe_viol
        truncated = act & (self.steps >= self.max_steps) & ~terminated
        outcome = np.full(self.N, RUNNING, np.int8)
        outcome[truncated] = TIMEOUT
        outcome[battery] = BATTERY
        outcome[spe_viol] = SPE
        outcome[rock] = COLLISION
        outcome[reached] = SUCCESS
        reward = (-w.step_cost * cost_inc + w.progress * progress - w.hazard_attempt * blocked
                  - w.time * dt / 600.0 - w.energy * e_wh / 100.0 - w.risk * (self.slope_flat[new] > RISK_SLOPE_DEG) * moved
                  + w.goal * reached - w.failure * (rock | battery | spe_viol))
        reward = np.where(act, reward, 0.0).astype(np.float32)

        if self.record:
            for i in np.flatnonzero(act):  # traj/1: action of the previous state, then the new state + WAIT sentinel
                r_, c_, t_, soc_, _ = self.trajs[i][-1]
                self.trajs[i][-1] = (r_, c_, t_, soc_, int(a[i]))
                self.trajs[i].append((*self.cell(int(i)), float(self.t_s[i]), float(self.soc[i]), spec.WAIT))

        done = terminated | truncated
        info = self.info(outcome)
        obs = self.observe()
        if done.any():
            d = np.flatnonzero(done)
            for i in d:
                self.finished.append({"env": int(i), "outcome": OUTCOMES[outcome[i]],
                                      "start": self._rc(self.start[i:i + 1])[0].tolist(),
                                      "goal": self._rc(self.goal[i:i + 1])[0].tolist(),
                                      "steps": int(self.steps[i]), "pathM": float(self.path_m[i]),
                                      "pathCost": float(self.path_cost[i]), "tS": float(self.t_s[i]),
                                      "energyWh": float(self.energy_wh[i]), "violations": int(self.violations[i]),
                                      "timeSlopeGt15S": float(self.risk_s[i]), "shieldInterventions": int(self.shield[i]),
                                      "traj": self.trajs[i] if self.record else None})
            if self.autoreset:
                final = np.zeros_like(obs)
                final[d] = obs[d]
                info["final_obs"], info["_final_obs"] = final, done.copy()
                self._sample(d)
                obs[d] = self.observe(d)
        return obs, reward, terminated, truncated, info

    def info(self, outcome: np.ndarray | None = None) -> dict:
        """Per-env arrays (contract agreed with marsx.bench): valid at every step."""
        oc = np.zeros(self.N, np.int8) if outcome is None else outcome
        return {"cell": self.cells(), "tS": self.t_s.copy(), "soc": self.soc.copy(), "energyWh": self.energy_wh.copy(),
                "pathM": self.path_m.copy(), "pathCost": self.path_cost.copy(), "steps": self.steps.copy(),
                "outcome": np.array([OUTCOMES[o] for o in oc], dtype=object), "outcomeCode": oc,
                "violations": self.violations.copy(), "timeSlopeGt15S": self.risk_s.copy(),
                "shieldInterventions": self.shield.copy(),
                "speAlertT": np.nan_to_num(self.alert_t, nan=-1.0)}  # alert time of the episode (s); -1 = no alert
