import numpy as np
from PIL import Image

from marsx.pipeline import tiles


def test_pyramid_writes_expected_tiles_and_orientation(tmp_path):
    img = np.zeros((1024, 1024), np.uint8)
    img[:512, :512] = 200  # north-west quadrant bright
    info = tiles.write_pyramid(img, tmp_path, tile=256, quality=95, workers=2)
    assert [lv["tiles"] for lv in info["levels"]] == [4, 2, 1]
    assert (tmp_path / "ortho" / "0" / "0_0.webp").exists() and (tmp_path / "ortho" / "0" / "3_3.webp").exists()
    assert (tmp_path / "ortho" / "2" / "0_0.webp").exists()
    nw = np.asarray(Image.open(tmp_path / "ortho" / "0" / "0_0.webp").convert("L"))
    se = np.asarray(Image.open(tmp_path / "ortho" / "0" / "3_3.webp").convert("L"))
    assert nw.shape == (256, 256) and nw.mean() > 190 and se.mean() < 10  # x = column from west, y = row from north
    # level 2 (single tile) is the 2x2-mean downsample: its NW quadrant stays bright
    top = np.asarray(Image.open(tmp_path / "ortho" / "2" / "0_0.webp").convert("L"))
    assert top[:128, :128].mean() > 190 and top[128:, 128:].mean() < 10
    assert info["bytes"] > 0 and info["count"] == 16 + 4 + 1


def test_downsample_2x_is_area_mean():
    a = np.array([[0, 10], [20, 30]], np.uint8)
    assert tiles.downsample2(a)[0, 0] == 15
