"""Surface gravity on Mars as a function of latitude.

g(phi) = g_eq + (g_pole - g_eq) * sin^2(phi), a first-order interpolation between the NSSDC
equatorial and polar surface accelerations. For Jezero (Perseverance landing site, 18.4447 N)
this gives 3.694 m/s^2. NSSDC's *mean* value is 3.73 m/s^2; the often quoted 3.71 does not
appear in the current fact sheet.
"""

from __future__ import annotations

import math

from marsx.conditions.params import Param

NSSDC_MARS = (
    "NSSDCA Mars Fact Sheet (last updated 19 May 2025): "
    "https://nssdc.gsfc.nasa.gov/planetary/factsheet/marsfact.html"
)

G_EQUATORIAL = Param(3.69, "m/s^2", "measured", NSSDC_MARS, note="surface acceleration (eq)")
G_POLAR = Param(3.73, "m/s^2", "measured", NSSDC_MARS, note="surface acceleration (pole)")
G_MEAN = Param(3.73, "m/s^2", "measured", NSSDC_MARS, note="surface gravity (mean)")

JEZERO_LATITUDE = Param(
    18.4447, "deg", "measured",
    "Perseverance landing site (Octavia E. Butler Landing), 18.4447 N 77.4508 E: "
    "https://science.nasa.gov/mission/mars-2020-perseverance/",
)


def gravity_at_latitude(lat_deg: float) -> float:
    if not -90.0 <= lat_deg <= 90.0:
        raise ValueError(f"latitude out of range: {lat_deg}")
    s2 = math.sin(math.radians(lat_deg)) ** 2
    return G_EQUATORIAL.value + (G_POLAR.value - G_EQUATORIAL.value) * s2


JEZERO_GRAVITY = Param(
    round(gravity_at_latitude(JEZERO_LATITUDE.value), 3),
    "m/s^2",
    "derived",
    f"g_eq + (g_pole - g_eq)*sin^2(lat) at lat {JEZERO_LATITUDE.value} deg; {NSSDC_MARS}",
)
