"""Integration with the real JezeroVecEnv on the processed Jezero dataset (skipped when not built)."""

import os
from pathlib import Path

import pytest

from marsx.bench import env_factory, policies as P, runner as R, suite as S

REPO = Path(__file__).resolve().parents[3]
DATA = Path(os.environ.get("MARSX_DATA", REPO / "data" / "processed" / "jezero-v1"))
SUITE = REPO / "bench" / "jezero-v1" / "suite.json"

pytestmark = pytest.mark.skipif(not (DATA / "manifest.json").exists() or not SUITE.exists(),
                                reason="processed dataset or suite not available")


def test_suite_file_matches_dataset():
    suite = S.load_suite(SUITE)
    t = env_factory.load_terrain_cached(DATA)
    assert suite.dataset_sha256 == t.dataset_sha256
    assert [(lv.level, lv.episodes) for lv in suite.levels] == [("L1", 600), ("L2", 800), ("L3", 600)]


def test_astar_on_real_terrain_first_l1_episodes():
    suite = S.load_suite(SUITE)
    specs = S.level_episodes(suite, "L1")[:24]
    res = R.run_episodes(specs, P.AStarPolicy(), env_factory.vec_env_factory(DATA))
    assert sum(r.outcome == "success" for r in res) >= 22
    for r, s in zip(res, specs):
        if r.outcome == "success":
            assert r.path_m == pytest.approx(s.oracle_path_m, rel=1e-6)
