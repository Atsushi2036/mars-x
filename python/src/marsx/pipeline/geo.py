"""Grid geometry and the local Mars projection.

Conventions (shared with the frontend and verified by golden fixtures):

* Pixel coordinates are continuous with (0, 0) at the UPPER-LEFT CORNER of the
  first pixel (GDAL convention). The centre of pixel (col, row) is (col+0.5, row+0.5).
* Rows grow SOUTHWARDS: world Y decreases as the row index increases.
* ``transform`` is the GDAL/rasterio affine ``(a, b, c, d, e, f)`` with
  ``x = a*col + b*row + c`` and ``y = d*col + e*row + f``.
* The local CRS is an equirectangular projection on the Mars sphere
  (R = 3396190 m) with ``lat_ts`` = latitude of the window centre, so E-W and N-S
  scales are both true at the centre. ``x_0``/``y_0`` shift the origin so that the
  window centre is (0, 0): local metres are small, float32-safe numbers.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np
from pyproj import CRS, Transformer

MARS_RADIUS_M = 3396190.0


@dataclass(frozen=True)
class Grid:
    x0: float  # world X of the upper-left corner
    y0: float  # world Y of the upper-left corner
    res: float  # metres per pixel (square pixels)
    width: int
    height: int

    @property
    def transform(self) -> tuple[float, float, float, float, float, float]:
        return (self.res, 0.0, self.x0, 0.0, -self.res, self.y0)

    @property
    def bbox(self) -> tuple[float, float, float, float]:
        """(xmin, ymin, xmax, ymax) in world metres."""
        return (
            self.x0,
            self.y0 - self.height * self.res,
            self.x0 + self.width * self.res,
            self.y0,
        )

    def pixel_to_world(self, col, row, center: bool = True):
        off = 0.5 if center else 0.0
        return (self.x0 + (col + off) * self.res, self.y0 - (row + off) * self.res)

    def world_to_pixel(self, x, y):
        """Continuous pixel coordinates; pixel centres sit at integer + 0.5."""
        return ((np.asarray(x) - self.x0) / self.res, (self.y0 - np.asarray(y)) / self.res)

    def scaled(self, factor: int) -> "Grid":
        """Same extent, ``factor`` times finer (factor>0) pixels."""
        return Grid(self.x0, self.y0, self.res / factor, self.width * factor, self.height * factor)


class LocalProjection:
    """Local equirectangular projection centred on (lon0, lat0), origin at the centre."""

    def __init__(self, lon0: float, lat0: float, radius: float = MARS_RADIUS_M):
        self.lon0, self.lat0, self.radius = lon0, lat0, radius
        self._y_center = radius * math.radians(lat0)
        self.proj4 = (
            f"+proj=eqc +lat_ts={lat0:.10g} +lon_0={lon0:.10g} +x_0=0 +y_0={-self._y_center:.6f} "
            f"+R={radius:.0f} +units=m +no_defs +type=crs"
        )
        self.crs = CRS.from_proj4(self.proj4)
        geo = CRS.from_proj4(f"+proj=longlat +R={radius:.0f} +no_defs +type=crs")
        self._fwd = Transformer.from_crs(geo, self.crs, always_xy=True)
        self._inv = Transformer.from_crs(self.crs, geo, always_xy=True)

    def forward(self, lon, lat):
        return self._fwd.transform(lon, lat)

    def inverse(self, x, y):
        return self._inv.transform(x, y)
