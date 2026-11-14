"""Warp a source raster onto a local-CRS ``Grid`` (GDAL warp via rasterio, multithreaded)."""

from __future__ import annotations

import numpy as np
from rasterio.crs import CRS
from rasterio.transform import Affine
from rasterio.warp import Resampling, reproject

from .geo import Grid, LocalProjection


def reproject_to_grid(
    arr: np.ndarray,
    src_transform: Affine,
    src_crs: str | CRS,
    grid: Grid,
    proj: LocalProjection,
    resampling: str = "bilinear",
    src_nodata: float | None = None,
    dtype: str = "float32",
    threads: int = 8,
) -> np.ndarray:
    """Float outputs use NaN for nodata/outside; integer outputs use 0."""
    src_crs = CRS.from_string(src_crs) if isinstance(src_crs, str) else src_crs
    is_float = np.dtype(dtype).kind == "f"
    dst_nodata = np.nan if is_float else 0
    dst = np.full((grid.height, grid.width), dst_nodata, dtype=dtype)
    reproject(
        source=arr,
        destination=dst,
        src_transform=src_transform,
        src_crs=src_crs,
        src_nodata=src_nodata,
        dst_transform=Affine(*grid.transform),
        dst_crs=CRS.from_wkt(proj.crs.to_wkt()),
        dst_nodata=dst_nodata,
        resampling=getattr(Resampling, resampling),
        num_threads=threads,
    )
    return dst
