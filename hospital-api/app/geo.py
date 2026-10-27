"""Distance helpers — the Haversine formula.

"Haversine" gives the great-circle distance between two points on a sphere
from their latitude/longitude. It is fast (pure math, no API call) which is
why the plan uses it as a first pass to rank hospitals, before asking a
routing API (OSRM / Google Distance Matrix) for real road distance on the
top few only.
"""
from __future__ import annotations

import math

EARTH_RADIUS_KM = 6371.0


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Straight-line distance in kilometres between two lat/lng points.

    >>> round(haversine_km(23.8103, 90.4125, 23.7391, 90.3964), 1)  # Dhaka centre -> BIRDEM
    8.5
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lng2 - lng1)

    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.asin(math.sqrt(a))
