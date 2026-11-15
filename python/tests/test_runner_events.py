"""run.json carries the space-weather alert of each astronaut episode ({type: "speAlert", t}) for web re-simulation."""

from __future__ import annotations

import numpy as np
import pytest

pytest.importorskip("gymnasium")

from marsx.bench import policies as P  # noqa: E402
from marsx.bench import runner as R  # noqa: E402
from marsx.contracts.suite import EpisodeSpec  # noqa: E402
from marsx.env import scenarios  # noqa: E402
from marsx.env.core import NavBatch  # noqa: E402
from marsx.env.terrain import Terrain  # noqa: E402
from marsx.env.vector import JezeroVecEnv  # noqa: E402


def flat(n=48) -> Terrain:
    z = np.zeros((n, n), np.float32)
    return Terrain(z.copy(), z.copy(), z.copy(), 2.0, "flat", horizon_deg=np.zeros((16, n, n), np.float16))


def test_info_exposes_alert_time():
    eng = NavBatch(flat(), scenarios.get("jezero-v1/l2/astronaut-clear"), num_envs=2, seed=0, autoreset=False)
    eng.reset_to([0, 1], starts=[(10, 10), (20, 20)], goals=[(10, 30), (20, 40)])
    eng.alert_t[:] = [5.0, np.nan]
    info = eng.info()
    assert info["speAlertT"][0] == 5.0 and info["speAlertT"][1] == -1.0  # -1 = no alert (NaN breaks equality checks)


def test_runner_writes_spe_alert_event_only_when_it_fired():
    sc = scenarios.get("jezero-v1/l2/astronaut-clear")
    specs = [EpisodeSpec(index=0, seed=1, scenario_id=sc.id, start=[10, 10], goal=[10, 40]),
             EpisodeSpec(index=1, seed=2, scenario_id=sc.id, start=[30, 10], goal=[30, 40])]

    def make_env(scenario, n):
        env = JezeroVecEnv(num_envs=n, scenario=scenario, terrain=flat())
        orig = env.reset

        def reset(**kw):  # force: env 0 gets an alert at t = 4 s, env 1 none
            out = orig(**kw)
            env.engine.alert_t[:] = [4.0, np.nan][:n]
            return out
        env.reset = reset
        return env

    res = R.run_episodes(specs, P.AStarPolicy(), make_env, batch_size=2, oracle_energy=False)
    ev0 = [e for e in res[0].events if e.type == "speAlert"]
    assert len(ev0) == 1 and ev0[0].t == pytest.approx(4.0)
    assert not [e for e in res[1].events if e.type == "speAlert"]
