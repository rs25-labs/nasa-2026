"""Curvature-aware terrain horizon from the Batch 01 polar DEM.

Correction pass (Codex audit):
- Ground-track destinations use vector rotation in the Moon-fixed frame,
  preserving the longitude-defined tangent axes at the exact pole.
- The sampled maximum is a DIAGNOSTIC value only. No conservative bound
  on omitted terrain is established in this pass, so no horizon is
  reported as complete: every azimuth stays INDETERMINATE with an
  explicit termination reason (missing raster vs search cutoff).
- Radial sampling is densified toward the terrain-cell scale and reports
  unresolved gaps instead of claiming a complete terrain maximum.
- Optional far-field radii remain supported but unused (far_field=None).

Frame/units match Batch 01: MOON_ME_DE421 planetocentric east-positive,
radius equation 1737400 + DN*0.5 m, angles in degrees, distances in meters
unless noted. No refraction, no terrain-normal tilt, no SPICE needed here.
"""
from __future__ import annotations

import math

import numpy as np


REFERENCE_RADIUS_M = 1737400.0


def local_basis(latitude_deg: float, longitude_deg: float):
    """East/north/radial-up unit vectors for a planetocentric position."""
    lat = math.radians(latitude_deg)
    lon = math.radians(longitude_deg)
    up = np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)],
        dtype=float,
    )
    east = np.array([-math.sin(lon), math.cos(lon), 0.0], dtype=float)
    norm = float(np.linalg.norm(east))
    if norm < 1e-12:  # Numerical guard; lon always defines the tangent axes.
        east = np.array([0.0, 1.0, 0.0], dtype=float)
    else:
        east /= norm
    north = np.cross(up, east)
    north /= float(np.linalg.norm(north))
    return east, north, up


def radial_vector(latitude_deg: float, longitude_deg: float, radius_m: float):
    lat = math.radians(latitude_deg)
    lon = math.radians(longitude_deg % 360.0)
    direction = np.array(
        [math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)],
        dtype=float,
    )
    return direction * float(radius_m)


def destination_point(lat0_deg: float, lon0_deg: float, azimuth_deg: float, distance_m: float):
    """Great-circle destination via Moon-fixed vector rotation.

    direction = up*cos(delta) + (north*cos(az) + east*sin(az))*sin(delta),
    with delta = distance / reference radius. Latitude is recovered with
    atan2(z, hypot(x, y)) and longitude with atan2(y, x), normalized to
    [0, 360). The east/north tangent axes come from local_basis(), so the
    exact pole keeps its longitude-defined convention and the existing
    reference-sphere/frame conventions are preserved.
    """
    east, north, up = local_basis(float(lat0_deg), float(lon0_deg) % 360.0)
    az = math.radians(float(azimuth_deg) % 360.0)
    delta = float(distance_m) / REFERENCE_RADIUS_M
    direction = up * math.cos(delta) + (north * math.cos(az) + east * math.sin(az)) * math.sin(delta)
    norm = float(np.linalg.norm(direction))
    if not math.isfinite(norm) or norm < 1e-15:
        raise ValueError("Degenerate destination direction")
    direction = direction / norm
    lat1_deg = math.degrees(math.atan2(direction[2], math.hypot(direction[0], direction[1])))
    lon1_deg = math.degrees(math.atan2(direction[1], direction[0])) % 360.0
    return float(lat1_deg), float(lon1_deg)


def _sample_radius_m(terrain, latitude_deg: float, longitude_deg: float):
    """Return surface radius in meters, or None when the pixel is unusable.

    Reuses the Batch 01 nearest-pixel validation (domain, integer
    endpoints, label-derived DN bounds). Any ValueError means unknown
    terrain, never a guessed elevation.
    """
    try:
        sample = terrain.sample(float(latitude_deg), float(longitude_deg), 0.0)
    except ValueError:
        return None
    return float(sample["surface_radius_m"])


def base_log_grid(min_distance_m: float, max_distance_m: float, steps: int):
    """Log-spaced base grid emphasizing near-field obstruction."""
    if steps < 16:
        raise ValueError("distance steps must be >= 16 for a bounded comparison")
    lo = max(1.0, float(min_distance_m))
    hi = float(max_distance_m)
    if not lo < hi:
        raise ValueError("min distance must be below max distance")
    grid = np.unique(np.logspace(math.log10(lo), math.log10(hi), num=int(steps)))
    return [float(d) for d in grid]


def densified_radial_grid(base_grid: list[float], cell_m: float, cap: int = 4096):
    """Subdivide base intervals toward the terrain-cell scale (bounded).

    Any base interval wider than one terrain cell is split into substeps
    of at most cell_m. When the cap would be exceeded, the grid is
    truncated and flagged unresolved by the caller via max_gap_m.
    Returns (grid, truncated).
    """
    cell = max(1.0, float(cell_m))
    out: list[float] = []
    for index, dist in enumerate(base_grid):
        if len(out) >= int(cap):
            return out, True
        out.append(float(dist))
        if index + 1 >= len(base_grid):
            break
        nxt = float(base_grid[index + 1])
        gap = nxt - float(dist)
        if gap > cell:
            needed = int(math.ceil(gap / cell)) - 1
            for k in range(1, needed + 1):
                if len(out) >= int(cap):
                    return out, True
                out.append(float(dist) + gap * (k / (needed + 1)))
    if len(out) > int(cap):
        return out[: int(cap)], True
    return out, False


def azimuth_separation_deg(first_deg: float, second_deg: float) -> float:
    """Smallest absolute separation between two azimuths in degrees."""
    return abs((float(first_deg) - float(second_deg) + 180.0) % 360.0 - 180.0)


def horizon_profile(
    terrain,
    site_latitude_deg: float,
    site_longitude_deg: float,
    observer_radius_m: float,
    az_step_deg: float = 2.0,
    max_distance_m: float = 150000.0,
    distance_steps: int = 256,
    far_field=None,
):
    """Compute the diagnostic terrain-horizon ring around one observer.

    Completeness: this pass establishes no conservative bound on terrain
    omitted beyond the search cutoff or outside raster coverage, so every
    azimuth is reported INDETERMINATE with a termination reason:
      - "missing-raster": sampling met invalid/out-of-domain terrain.
      - "search-cutoff": the grid reached max_distance_m with no
        completeness bound, so farther terrain could still raise the
        horizon.
      - "radial-sampling-cap": the point cap stopped the grid before the
        requested cutoff; unknown_beyond_m reports the actual extent.
    The sampled maximum is retained as a diagnostic
    (diagnostic_max_elevation_deg / horizon_elevation_deg alias) and must
    not be read as a complete horizon. far_field is accepted but unused
    as a completeness bound in this pass (far_field=None); a far-field
    dataset is not added here.
    """
    if not 0.25 <= az_step_deg <= 10.0:
        raise ValueError("azimuth step must be in [0.25, 10] degrees")
    if not 5000.0 <= max_distance_m <= 400000.0:
        raise ValueError("max distance must be in [5, 400] km")
    east, north, up = local_basis(site_latitude_deg, site_longitude_deg % 360.0)
    observer = radial_vector(site_latitude_deg, site_longitude_deg % 360.0, observer_radius_m)
    cell_m = float(getattr(terrain, "scale", 40.0))
    base = base_log_grid(max(cell_m, 20.0), max_distance_m, distance_steps)
    grid, truncated = densified_radial_grid(base, cell_m, cap=4096)
    max_gap_m = 0.0
    for a, b in zip(grid, grid[1:]):
        max_gap_m = max(max_gap_m, float(b) - float(a))
    spacing_within_cell = (not truncated) and max_gap_m <= cell_m * 1.000001
    azimuths = np.arange(0.0, 360.0, float(az_step_deg))
    profiles = []
    for az in azimuths:
        az = float(az)
        best_elev = -90.0
        best_dist = 0.0
        used = 0
        exit_at = None
        termination = "radial-sampling-cap" if truncated else "search-cutoff"
        for dist in grid:
            lat1, lon1 = destination_point(site_latitude_deg, site_longitude_deg, az, dist)
            radius = _sample_radius_m(terrain, lat1, lon1)
            if radius is None and far_field is not None:
                try:
                    radius = far_field(lat1, lon1)
                except ValueError:
                    radius = None
            if radius is None:
                termination = "missing-raster"
                exit_at = dist if exit_at is None else exit_at
                break
            used += 1
            target = radial_vector(lat1, lon1, radius)
            vec = target - observer
            horizontal = math.hypot(float(vec @ east), float(vec @ north))
            if horizontal < 1e-9:
                continue
            elev = math.degrees(math.atan2(float(vec @ up), horizontal))
            if elev > best_elev:
                best_elev = elev
                best_dist = dist
        if termination != "missing-raster":
            exit_at = float(grid[-1])
        profiles.append(
            {
                "azimuth_deg": round(az, 4),
                # Diagnostic sampled maximum; not a complete horizon.
                "horizon_elevation_deg": float(best_elev),
                "diagnostic_max_elevation_deg": float(best_elev),
                "diagnostic_max_distance_m": float(best_dist),
                "horizon_distance_m": float(best_dist),
                "samples_used": int(used),
                "effective_radial_samples": int(len(grid)),
                "max_gap_m": float(max_gap_m),
                "spacing_within_cell": bool(spacing_within_cell),
                "sampling_resolved": False,
                "sampling_note": "Point spacing does not prove crossed-cell coverage; near-field and between-ray terrain remain unresolved",
                "horizon_is_complete": False,
                "completeness": "UNRESOLVED: no bound on omitted terrain beyond cutoff/coverage",
                "status": "INDETERMINATE",
                "termination": termination,
                "unknown_beyond_m": float(exit_at) if exit_at is not None else None,
            }
        )
    return profiles


def horizon_at_azimuth(profiles, azimuth_deg: float):
    """Nearest-profile lookup for a body azimuth (auditable, no interpolation)."""
    az = float(azimuth_deg) % 360.0
    best = min(profiles, key=lambda p: azimuth_separation_deg(p["azimuth_deg"], az))
    return best


def profiles_in_footprint(profiles, center_azimuth_deg: float, half_width_deg: float):
    """Profiles whose azimuth lies within a disk footprint (inclusive)."""
    center = float(center_azimuth_deg) % 360.0
    half = max(0.0, float(half_width_deg))
    return [p for p in profiles if azimuth_separation_deg(p["azimuth_deg"], center) <= half + 1e-9]


def compare_refinement(fine: list[dict], coarse: list[dict]):
    """Split refinement reporting; never a guaranteed error bound.

    - Radial sensitivity: same-bearing diagnostic-max differences at
      overlapping azimuths (sparse point sampling; unresolved gaps noted).
    - Angular sensitivity: intermediate-bearing diagnostic-max differences
      between fine azimuths and a fine-grid profile at the nearest coarse
      bearing, holding the radial grid fixed (missed
      intermediate-bearing obstructions are not measured, only indicated).
    - Complete-horizon comparison: no profile is complete in this pass,
      so eligible comparisons are unavailable (not zero).
    """
    def usable(p):
        return p["samples_used"] > 0 and math.isfinite(float(p["diagnostic_max_elevation_deg"]))

    fine_by_az = {round(float(p["azimuth_deg"]), 4): p for p in fine if usable(p)}
    coarse_by_az = {round(float(p["azimuth_deg"]), 4): p for p in coarse if usable(p)}
    radial_diffs: list[float] = []
    for p in fine:
        key = round(float(p["azimuth_deg"]), 4)
        if usable(p) and key in coarse_by_az:
            radial_diffs.append(
                abs(float(p["diagnostic_max_elevation_deg"]) - float(coarse_by_az[key]["diagnostic_max_elevation_deg"]))
            )
    coarse_az = sorted(set(coarse_by_az) & set(fine_by_az))
    angular_diffs: list[float] = []
    for p in fine:
        key = round(float(p["azimuth_deg"]), 4)
        if not usable(p) or key in coarse_by_az or not coarse_az:
            continue
        nearest = min(coarse_az, key=lambda c: azimuth_separation_deg(key, c))
        angular_diffs.append(
            abs(float(p["diagnostic_max_elevation_deg"]) - float(fine_by_az[nearest]["diagnostic_max_elevation_deg"]))
        )
    return {
        "radial_common_bearings": len(radial_diffs),
        "radial_max_abs_diff_deg": max(radial_diffs) if radial_diffs else "",
        "radial_mean_abs_diff_deg": (sum(radial_diffs) / len(radial_diffs)) if radial_diffs else "",
        "angular_intermediate_bearings": len(angular_diffs),
        "angular_max_abs_diff_deg": max(angular_diffs) if angular_diffs else "",
        "angular_mean_abs_diff_deg": (sum(angular_diffs) / len(angular_diffs)) if angular_diffs else "",
        "eligible_complete_horizon_comparisons": "unavailable: no horizon is complete in this pass",
        "interpretation": (
            "Diagnostic sensitivities of sparse point-sampled maxima; "
            "not a guaranteed error bound. Radial diffs ignore missed "
            "intermediate bearings; angular diffs indicate bearing "
            "sensitivity only. Incomplete/unresolved profiles are excluded "
            "from any complete-horizon statistic."
        ),
    }
