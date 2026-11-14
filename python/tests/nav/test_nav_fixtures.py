import json
from pathlib import Path

import numpy as np

from marsx.nav import NavStatus, astar, dijkstra_cost_to_goal
from marsx.nav.fixtures import build_cases

FIXTURE = Path(__file__).resolve().parents[3] / "packages" / "schemas" / "fixtures" / "nav" / "cases.json"


def test_fixture_file_is_up_to_date():
    assert FIXTURE.exists(), "run: python -m marsx.nav.fixtures"
    assert json.loads(FIXTURE.read_text()) == json.loads(json.dumps(build_cases()))


def test_fixture_cases_replay_through_the_planner():
    doc = json.loads(FIXTURE.read_text())
    assert doc["specVersion"] == "nav/1" and len(doc["cases"]) >= 10
    names = {c["name"] for c in doc["cases"]}
    for required in ("flat", "wall_gap", "full_wall_no_path", "ramp_over_limit_no_path",
                     "start_in_obstacle", "tie_2x3", "no_corner_cutting"):
        assert required in names
    for c in doc["cases"]:
        grid = np.array([np.inf if v is None else v for v in c["cost"]], np.float32).reshape(c["rows"], c["cols"])
        r = astar(grid, tuple(c["start"]), tuple(c["goal"]))
        assert r.status.name.lower() == c["expected"]["status"]
        if r.status == NavStatus.OK:
            assert r.path.tolist() == c["expected"]["path"]
            assert abs(r.cost - c["expected"]["cost"]) < 1e-9
        if "costToGoal" in c["expected"]:
            d = dijkstra_cost_to_goal(grid, tuple(c["goal"])).ravel()
            exp = [np.inf if v is None else v for v in c["expected"]["costToGoal"]]
            assert np.allclose(d, exp, rtol=0, atol=1e-9)
