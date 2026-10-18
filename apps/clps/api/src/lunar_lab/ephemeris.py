"""Geometric topocentric Sun/Earth positions in the terrain's DE421 ME frame."""
from __future__ import annotations

from contextlib import contextmanager
import math

import numpy as np
import spiceypy as spice


@contextmanager
def kernel_session(paths: dict):
    # Dedicated single-process CLI; later API workers must isolate SPICE state.
    spice.kclear()
    try:
        for key in ("lsk", "constants", "spk", "orientation", "frames"):
            spice.furnsh(str(paths[key]))
        if spice.namfrm("MOON_ME_DE421") == 0:
            raise ValueError("MOON_ME_DE421 frame was not loaded")
        yield
    finally:
        spice.kclear()


def coverage_report(paths: dict) -> dict:
    def describe(window):
        return [
            {
                "start_utc": spice.et2utc(spice.wnfetd(window, i)[0], "ISOC", 3) + "Z",
                "end_utc": spice.et2utc(spice.wnfetd(window, i)[1], "ISOC", 3) + "Z",
            }
            for i in range(spice.wncard(window))
        ]
    return {
        "spk": {str(body): describe(spice.spkcov(str(paths["spk"]), body)) for body in (10, 301, 399)},
        "orientation": describe(spice.pckcov(str(paths["orientation"]), 31006)),
        "frame": "MOON_ME_DE421",
        "aberration_correction": "NONE (geometric, no light-time or stellar-aberration correction)",
        "leap_seconds_note": "Uses pinned naif0012.tls; future UTC assumes no additional unrepresented leap seconds.",
    }


def positions(site: dict, utc_values: list[str]) -> list[dict]:
    lat = math.radians(site["latitude_deg"])
    lon = math.radians(site["longitude_deg"])
    up = np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])
    east = np.array([-math.sin(lon), math.cos(lon), 0.0])
    north = np.cross(up, east)
    observer_km = up * site["observer_radius_m"] / 1000
    radii = {name: float(spice.bodvrd(name, "RADII", 3)[1][0]) for name in ("SUN", "EARTH")}
    rows = []
    for utc in utc_values:
        et = spice.str2et(utc)
        # This also proves the orientation kernel can supply this instant.
        spice.pxform("J2000", "MOON_ME_DE421", et)
        for body in ("SUN", "EARTH"):
            vector, _ = spice.spkpos(body, et, "MOON_ME_DE421", "NONE", "MOON")
            topocentric = np.asarray(vector) - observer_km
            distance = float(np.linalg.norm(topocentric))
            horizontal = math.hypot(float(topocentric @ east), float(topocentric @ north))
            rows.append({
                "site_id": site["id"], "utc": utc, "body": body,
                "azimuth_deg": math.degrees(math.atan2(float(topocentric @ east), float(topocentric @ north))) % 360,
                "center_elevation_deg": math.degrees(math.atan2(float(topocentric @ up), horizontal)),
                "distance_km": distance,
                "angular_radius_deg": math.degrees(math.asin(min(1.0, radii[body] / distance))),
            })
    return rows
