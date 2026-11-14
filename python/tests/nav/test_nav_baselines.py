import numpy as np

from marsx.nav import NavStatus, astar, astar_replan, greedy_path, oracle_path, random_walk_path

INF = np.inf


def test_oracle_matches_astar_cost():
    rng = np.random.default_rng(3)
    c = (1 + rng.random((20, 20))).astype(np.float32)
    c[rng.random(c.shape) < 0.2] = INF
    c[0, 0] = c[19, 19] = 1.0
    a = astar(c, (0, 0), (19, 19))
    o = oracle_path(c, (0, 0), (19, 19))
    assert o.status == a.status
    if a.status == NavStatus.OK:
        assert abs(o.cost - a.cost) < 1e-9


def test_random_walk_seeded_and_bounded():
    c = np.ones((10, 10), np.float32)
    a = random_walk_path(c, (0, 0), (9, 9), max_steps=50, seed=1)
    b = random_walk_path(c, (0, 0), (9, 9), max_steps=50, seed=1)
    assert a.path.tolist() == b.path.tolist()
    assert len(a.path) <= 51
    assert all(np.isfinite(c[tuple(p)]) for p in a.path)


def test_greedy_gets_stuck_behind_wall_astar_does_not():
    c = np.ones((9, 9), np.float32)
    c[:, 4] = INF
    c[8, 4] = 1.0
    g = greedy_path(c, (4, 0), (4, 8), max_steps=100)
    assert g.status == NavStatus.NO_PATH  # greedy local minimum
    assert astar(c, (4, 0), (4, 8)).status == NavStatus.OK


def test_replan_discovers_hidden_rock_and_reaches_goal():
    true = np.ones((15, 15), np.float32)
    known = true.copy()
    true[7, 4:11] = INF  # hidden wall unknown to the planner
    plain = astar(known, (0, 7), (14, 7))
    assert any(true[tuple(p)] == INF for p in plain.path)  # no-replan collides
    r = astar_replan(true, known, (0, 7), (14, 7), sensor_radius=2)
    assert r.status == NavStatus.OK
    assert all(np.isfinite(true[tuple(p)]) for p in r.path)
    assert r.path[-1].tolist() == [14, 7] and r.replans >= 1


def test_replan_unreachable_reports_no_path():
    true = np.ones((9, 9), np.float32)
    known = true.copy()
    true[:, 4] = INF
    r = astar_replan(true, known, (4, 0), (4, 8), sensor_radius=2)
    assert r.status == NavStatus.NO_PATH


def test_path_to_actions_uses_act1_encoding():
    from marsx.nav import path_to_actions
    p = np.array([[2, 2], [1, 2], [1, 3], [2, 4], [2, 3], [3, 2], [2, 1], [3, 1], [3, 1]])
    # N, E, SE, W, SW, NW... derived from act/1: N=0 S=1 E=2 W=3 NE=4 NW=5 SE=6 SW=7 WAIT=8
    assert path_to_actions(p).tolist() == [0, 2, 6, 3, 7, 5, 1, 8]
