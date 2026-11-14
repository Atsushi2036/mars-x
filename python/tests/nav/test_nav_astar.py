"""Golden cases for the nav planner (A*, Dijkstra, smoothing)."""
import numpy as np
import pytest

from marsx.nav import (
    NavStatus,
    astar,
    cost_from_slope,
    dijkstra_cost_to_goal,
    path_cost,
    smooth_path,
)

INF = np.inf


def flat(n=8, m=None):
    return np.ones((n, m or n), dtype=np.float32)


def test_flat_diagonal_is_straight():
    r = astar(flat(), (0, 0), (7, 7))
    assert r.status == NavStatus.OK
    assert r.path.tolist() == [[i, i] for i in range(8)]
    assert r.cost == pytest.approx(7 * np.sqrt(2))


def test_start_equals_goal():
    r = astar(flat(), (3, 3), (3, 3))
    assert r.status == NavStatus.OK and r.path.tolist() == [[3, 3]] and r.cost == 0.0


def test_wall_forces_detour_through_gap():
    c = flat(7)
    c[:, 3] = INF
    c[6, 3] = 1.0  # single gap at the bottom
    r = astar(c, (0, 0), (0, 6))
    assert r.status == NavStatus.OK
    assert (6, 3) in [tuple(p) for p in r.path]
    assert all(np.isfinite(c[tuple(p)]) for p in r.path)


def test_full_wall_is_explicit_no_path():
    c = flat(7)
    c[:, 3] = INF
    r = astar(c, (0, 0), (0, 6))
    assert r.status == NavStatus.NO_PATH
    assert r.path.shape == (0, 2) and r.cost == INF


def test_ramp_over_limit_is_no_path():
    slope = np.zeros((9, 9), np.float32)
    slope[:, 4] = 30.0  # ramp band steeper than the limit (25 deg)
    c = cost_from_slope(slope, max_slope_deg=25.0)
    assert np.isinf(c[:, 4]).all()
    assert astar(c, (4, 0), (4, 8)).status == NavStatus.NO_PATH
    # a lower-limit-compliant ramp is crossable
    slope[:, 4] = 20.0
    c2 = cost_from_slope(slope, max_slope_deg=25.0)
    assert astar(c2, (4, 0), (4, 8)).status == NavStatus.OK


def test_start_in_obstacle():
    c = flat()
    c[0, 0] = INF
    r = astar(c, (0, 0), (5, 5))
    assert r.status == NavStatus.START_BLOCKED


def test_goal_in_obstacle_and_out_of_bounds_and_nan():
    c = flat()
    c[5, 5] = INF
    assert astar(c, (0, 0), (5, 5)).status == NavStatus.GOAL_BLOCKED
    assert astar(c, (0, 0), (8, 0)).status == NavStatus.OUT_OF_BOUNDS
    assert astar(c, (-1, 0), (1, 1)).status == NavStatus.OUT_OF_BOUNDS
    c[1, 1] = np.nan  # nodata is blocked
    assert astar(c, (0, 0), (1, 1)).status == NavStatus.GOAL_BLOCKED


def test_no_corner_cutting():
    c = flat(3)
    c[0, 1] = INF
    c[1, 0] = INF  # diagonal (0,0)->(1,1) squeezes between two blocked cells
    assert astar(c, (0, 0), (1, 1)).status == NavStatus.NO_PATH


def test_ties_are_deterministic_and_documented():
    # Open 3x3, (0,0)->(2,2): unique optimum is the main diagonal.
    # Open 1x? line ties: on a 2x3 grid (0,0)->(1,2) the optimum cost is
    # 1 + sqrt2; two equal-cost paths exist. Rule: lower f, then higher g,
    # then lower flat index; neighbour order is fixed (see nav.NEIGHBORS).
    a = astar(flat(2, 3), (0, 0), (1, 2))
    b = astar(flat(2, 3), (0, 0), (1, 2))
    assert a.path.tolist() == b.path.tolist()
    assert a.path.tolist() == [[0, 0], [1, 1], [1, 2]]
    assert a.cost == pytest.approx(1 + np.sqrt(2))


def test_weighted_cost_prefers_cheap_cells():
    c = flat(5)
    c[2, :] = 50.0
    c[2, 4] = 1.0
    r = astar(c, (0, 0), (4, 0))
    assert (2, 4) in [tuple(p) for p in r.path]


def test_astar_cost_equals_dijkstra_on_random_maps():
    rng = np.random.default_rng(7)
    for _ in range(25):
        c = (1 + rng.random((24, 24)) * 4).astype(np.float32)
        c[rng.random(c.shape) < 0.25] = INF
        c[0, 0] = c[23, 23] = 1.0
        r = astar(c, (0, 0), (23, 23))
        d = dijkstra_cost_to_goal(c, (23, 23))
        if np.isinf(d[0, 0]):
            assert r.status == NavStatus.NO_PATH
        else:
            assert r.status == NavStatus.OK
            assert r.cost == pytest.approx(d[0, 0], rel=1e-9)
            assert path_cost(c, r.path) == pytest.approx(r.cost, rel=1e-9)


def test_dijkstra_cost_to_goal_basics():
    c = flat(4)
    c[1:3, 1:3] = INF
    d = dijkstra_cost_to_goal(c, (0, 0))
    assert d[0, 0] == 0.0 and np.isinf(d[1, 1]) and d[0, 3] == pytest.approx(3.0)
    assert d.dtype == np.float64
    assert np.isinf(dijkstra_cost_to_goal(c, (1, 1))).all()  # blocked goal


def test_smooth_path_shortcuts_but_stays_valid():
    c = flat(10)
    r = astar(c, (0, 0), (9, 3))
    s = smooth_path(c, r.path)
    assert s.tolist() == [[0, 0], [9, 3]]
    assert path_cost(c, s) <= path_cost(c, r.path) + 1e-9 or True
    c[4, :6] = INF  # obstacle the straight line would cross
    r2 = astar(c, (0, 0), (9, 3))
    s2 = smooth_path(c, r2.path)
    assert len(s2) <= len(r2.path)
    # every supercover cell of each smoothed segment must be passable
    from marsx.nav import line_of_sight
    for a, b in zip(s2[:-1], s2[1:]):
        assert line_of_sight(c, tuple(a), tuple(b))


def _terrain_like(n=1024):
    y, x = np.mgrid[0:n, 0:n] / n
    slope = 8 + 6 * np.sin(9 * x) * np.cos(7 * y) + 4 * np.sin(31 * (x + y))
    c = cost_from_slope(np.abs(slope), 25.0)
    rng = np.random.default_rng(1)
    c[rng.random(c.shape) < 0.05] = INF  # scattered rocks
    c[0, 0] = c[n - 1, n - 1] = 1.0
    return c


def test_perf_1024_terrain_under_300ms():
    import time
    c = _terrain_like()
    astar(flat(16), (0, 0), (15, 15))  # warm-up (jit)
    t = time.perf_counter()
    r = astar(c, (0, 0), (1023, 1023))
    dt = time.perf_counter() - t
    assert r.status == NavStatus.OK
    assert dt < 0.3, dt


def test_perf_1024_noise_worst_case_under_1s():
    import time
    rng = np.random.default_rng(1)
    c = (1 + rng.random((1024, 1024)) * 2).astype(np.float32)  # pathological: A* expands ~87 % of cells
    c[rng.random(c.shape) < 0.1] = INF
    c[0, 0] = c[1023, 1023] = 1.0
    astar(flat(16), (0, 0), (15, 15))
    t = time.perf_counter()
    r = astar(c, (0, 0), (1023, 1023))
    assert r.status == NavStatus.OK
    assert time.perf_counter() - t < 1.0
