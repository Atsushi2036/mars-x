import numpy as np
import pytest

from marsx.pipeline import encode


def test_height_u16_roundtrip_with_nodata():
    dem = np.array([[-2600.0, -2500.5], [np.nan, -2400.0]], np.float32)
    q, enc = encode.height_to_u16(dem)
    assert q.dtype == np.dtype("<u2")
    assert q[1, 0] == enc["nodata"] == 65535
    back = encode.u16_to_height(q, enc)
    assert np.isnan(back[1, 0])
    valid = ~np.isnan(dem)
    assert np.allclose(back[valid], dem[valid], atol=enc["scale"])
    assert enc["offset"] == pytest.approx(-2600.0)
    assert q[valid].max() == 65534


def test_bytes_are_little_endian():
    q = np.array([[0x1234, 0xABCD]], dtype="<u2")
    assert q.tobytes() == bytes([0x34, 0x12, 0xCD, 0xAB])
    assert encode.to_le_bytes(np.array([[0x1234]], dtype=np.uint16)) == bytes([0x34, 0x12])
    assert encode.to_le_bytes(np.array([1.0], dtype=np.float32)) == bytes([0x00, 0x00, 0x80, 0x3F])


def test_height_u16_constant_dem_does_not_divide_by_zero():
    q, enc = encode.height_to_u16(np.full((4, 4), -2500.0, np.float32))
    assert enc["scale"] > 0
    assert np.allclose(encode.u16_to_height(q, enc), -2500.0)


def test_pyramid_level_sizes_and_tile_count():
    levels = encode.pyramid_levels(8192, 512)
    assert levels[0] == {"lod": 0, "size": 8192, "tiles": 16}
    assert levels[-1] == {"lod": 4, "size": 512, "tiles": 1}
    assert [lv["size"] for lv in levels] == [8192, 4096, 2048, 1024, 512]
