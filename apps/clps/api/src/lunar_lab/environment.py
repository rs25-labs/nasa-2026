"""Finite-disk visibility, intervals, and planning metrics for Batch 02.

Correction pass (Codex audit):
- The circular-segment formula is preserved as an explicitly identified
  approximation for a uniform disk behind a horizontal straight edge. It
  is not a varying-horizon integrator.
- No disk is classified from a single center-azimuth profile. The disk's
  azimuth footprint is checked for unresolved coverage/horizon
  uncertainty; any gap propagates to UNKNOWN. FULL/BLOCKED need
  conservative bounds that do not exist in this pass, and PARTIAL needs
  an applicability condition that is not established, so current profiles
  yield UNKNOWN with no numeric fraction.
- Intervals use an explicit left-held sample-state interpretation over
  [t_i, t_{i+1}); the terminal boundary sample carries zero elapsed time
  and starts no zero-length interval.
- Summaries weight by elapsed duration, not sample counts. Six-hour
  sampling gives coarse sampled estimates, not precise event times.
"""
from __future__ import annotations

import math
from datetime import datetime, timezone

from .horizon import horizon_at_azimuth, profiles_in_footprint


def visible_fraction(center_elev_deg: float, horizon_elev_deg: float, radius_deg: float) -> float:
    """Uniform disk behind a horizontal straight edge (approximation).

    u = (center - horizon) / radius in [-1, 1];
    fraction = 0.5 + (u*sqrt(1-u^2) + asin(u)) / pi.
    Full when center >= horizon + radius; blocked when center <= horizon
    - radius. Valid only as a straight-edge approximation with a bound on
    horizon variation across the disk footprint; that bound is not
    established in this pass.
    """
    radius = float(radius_deg)
    if not math.isfinite(radius) or radius <= 0:
        raise ValueError("angular radius must be finite and positive")
    center = float(center_elev_deg)
    horizon = float(horizon_elev_deg)
    if not math.isfinite(center) or not math.isfinite(horizon):
        raise ValueError("center and horizon elevations must be finite")
    delta = center - horizon
    if delta >= radius:
        return 1.0
    if delta <= -radius:
        return 0.0
    u = max(-1.0, min(1.0, delta / radius))
    return 0.5 + (u * math.sqrt(max(0.0, 1.0 - u * u)) + math.asin(u)) / math.pi


def classify(center_elev_deg: float, horizon_elev_deg: float, radius_deg: float) -> str:
    frac = visible_fraction(center_elev_deg, horizon_elev_deg, radius_deg)
    if frac >= 1.0:
        return "FULL"
    if frac <= 0.0:
        return "BLOCKED"
    return "PARTIAL"


def footprint_half_width_deg(center_elev_deg: float, radius_deg: float) -> float:
    """Azimuth half-width of a disk centered at an elevation.

    sin(half_width) * cos(center_elev) = sin(radius). Near the zenith the
    footprint spans all azimuths (180 deg).
    """
    center = math.radians(float(center_elev_deg))
    radius = math.radians(max(0.0, float(radius_deg)))
    cos_center = math.cos(center)
    if cos_center <= 0.0:
        return 180.0
    ratio = math.sin(radius) / cos_center
    if ratio >= 1.0:
        return 180.0
    return math.degrees(math.asin(max(0.0, min(1.0, ratio))))


def _unknown_row(row: dict, horizon, reason: str, half_width: float, footprint_count: int) -> dict:
    return {
        "site_id": row["site_id"],
        "utc": row["utc"],
        "body": row["body"],
        "azimuth_deg": row["azimuth_deg"],
        "center_elevation_deg": row["center_elevation_deg"],
        "horizon_elevation_deg": horizon["horizon_elevation_deg"],
        "horizon_status": horizon["status"],
        "angular_radius_deg": row["angular_radius_deg"],
        "footprint_half_width_deg": round(float(half_width), 6),
        "footprint_profiles": int(footprint_count),
        "visible_fraction": "",
        "state": "UNKNOWN",
        "state_reason": reason,
    }


def build_timeseries(geometry_rows: list[dict], profiles: list[dict]) -> list[dict]:
    """Join each geometric row with its disk footprint's horizon state.

    No complete-horizon bound exists in this pass (every profile is
    INDETERMINATE with horizon_is_complete False), so every footprint is
    unresolved and every row is UNKNOWN. The FULL/PARTIAL/BLOCKED path is
    retained for a future bounded pass but requires all footprint profiles
    to be complete with a straight-edge applicability bound; otherwise the
    row stays UNKNOWN with an empty fraction to keep labels consistent.
    """
    out = []
    for row in geometry_rows:
        horizon = horizon_at_azimuth(profiles, row["azimuth_deg"])
        half_width = footprint_half_width_deg(row["center_elevation_deg"], row["angular_radius_deg"])
        footprint = profiles_in_footprint(profiles, row["azimuth_deg"], half_width)
        if not footprint:
            out.append(_unknown_row(row, horizon, "no-footprint-coverage", half_width, 0))
            continue
        unresolved = [p for p in footprint if (p.get("status") != "DETERMINED" or not p.get("horizon_is_complete"))]
        if unresolved:
            out.append(
                _unknown_row(
                    row, horizon, "footprint-unresolved: INDETERMINATE or incomplete horizon", half_width, len(footprint)
                )
            )
            continue
        if any(not p.get("sampling_resolved", False) for p in footprint):
            out.append(
                _unknown_row(row, horizon, "footprint-unresolved: radial sampling", half_width, len(footprint))
            )
            continue
        # Reachable only with complete, resolved footprints plus a
        # straight-edge applicability bound (not established here).
        out.append(
            _unknown_row(row, horizon, "straight-edge applicability unestablished", half_width, len(footprint))
        )
    return out


def _parse_utc(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def compress_intervals(timeseries: list[dict], site_id: str, body: str) -> list[dict]:
    """Compress one site/body series into left-held state intervals.

    Interpretation: sample state at t_i holds over [t_i, t_{i+1}). The
    final end-boundary sample terminates the previous interval and carries
    zero elapsed time itself, so a trailing single-sample run produces no
    zero-length terminal interval.
    """
    series = [r for r in timeseries if r["site_id"] == site_id and r["body"] == body]
    series.sort(key=lambda r: _parse_utc(r["utc"]))
    intervals = []
    if not series:
        return intervals
    start = series[0]
    prev = series[0]
    for row in series[1:]:
        if row["state"] == prev["state"]:
            prev = row
            continue
        intervals.append(
            {
                "site_id": site_id,
                "body": body,
                "state": prev["state"],
                "start_utc": start["utc"],
                "end_utc": row["utc"],
                "duration_hours": round(
                    (_parse_utc(row["utc"]) - _parse_utc(start["utc"])).total_seconds() / 3600.0, 4
                ),
            }
        )
        start = row
        prev = row
    # Tail run [start, prev]: omit when it carries zero elapsed time.
    if _parse_utc(prev["utc"]) > _parse_utc(start["utc"]):
        intervals.append(
            {
                "site_id": site_id,
                "body": body,
                "state": prev["state"],
                "start_utc": start["utc"],
                "end_utc": prev["utc"],
                "duration_hours": round(
                    (_parse_utc(prev["utc"]) - _parse_utc(start["utc"])).total_seconds() / 3600.0, 4
                ),
            }
        )
    return intervals


def _sample_durations_hours(series: list[dict]) -> list[float]:
    """Left-held elapsed time per sample; terminal sample is zero."""
    times = [_parse_utc(r["utc"]) for r in series]
    durations = []
    for index in range(len(times)):
        if index + 1 < len(times):
            durations.append((times[index + 1] - times[index]).total_seconds() / 3600.0)
        else:
            durations.append(0.0)
    return durations


def summarize(timeseries: list[dict], intervals: list[dict], site_id: str, body: str) -> dict:
    """Duration-weighted summary for one site/body.

    Fractions and the visible-fraction mean weight by left-held elapsed
    hours, not sample counts. The mean covers known time only. The longest
    known blocked interval is a lower bound when unknown time remains;
    all-UNKNOWN leaves the mission-wide maximum unresolved (never zero).
    Six-hour sampling gives coarse sampled estimates, not precise event
    times. Example: FULL at 0h, BLOCKED at 6h, FULL at the 12h terminal
    boundary means six FULL hours and six BLOCKED hours (fraction 1/2).
    """
    series = sorted(
        [r for r in timeseries if r["site_id"] == site_id and r["body"] == body],
        key=lambda r: _parse_utc(r["utc"]),
    )
    total = len(series)
    counts = {name: sum(1 for r in series if r["state"] == name) for name in ("FULL", "PARTIAL", "BLOCKED", "UNKNOWN")}
    durations = _sample_durations_hours(series)
    total_hours = sum(durations)
    hours_by_state = {name: 0.0 for name in ("FULL", "PARTIAL", "BLOCKED", "UNKNOWN")}
    weighted_frac = 0.0
    known_hours = 0.0
    for row, hours in zip(series, durations):
        hours_by_state[row["state"]] += hours
        if row["visible_fraction"] != "":
            weighted_frac += float(row["visible_fraction"]) * hours
            known_hours += hours
    body_intervals = [i for i in intervals if i["site_id"] == site_id and i["body"] == body]
    blocked_hours = [i["duration_hours"] for i in body_intervals if i["state"] == "BLOCKED"]
    unknown_hours = hours_by_state["UNKNOWN"]
    if total_hours > 0:
        blocked_fraction = round(hours_by_state["BLOCKED"] / total_hours, 6)
        unknown_fraction = round(unknown_hours / total_hours, 6)
    else:
        blocked_fraction = 0.0
        unknown_fraction = 0.0 if total == 0 else 1.0
    if known_hours > 0:
        mean_fraction = round(weighted_frac / known_hours, 6)
        mean_basis = "duration-weighted over known hours only"
    else:
        mean_fraction = ""
        mean_basis = "no known hours"
    if blocked_hours:
        longest_blocked = round(max(blocked_hours), 4)
        longest_basis = "lower bound; unknown time remains" if unknown_hours > 0 else "known maximum"
    else:
        longest_blocked = "" if unknown_hours > 0 or total_hours == 0 else 0.0
        longest_basis = "unresolved: no known blocked interval" if unknown_hours > 0 or total_hours == 0 else "no blocked time"
    return {
        "site_id": site_id,
        "body": body,
        "samples": total,
        "full_samples": counts["FULL"],
        "partial_samples": counts["PARTIAL"],
        "blocked_samples": counts["BLOCKED"],
        "unknown_samples": counts["UNKNOWN"],
        "total_hours": round(total_hours, 4),
        "known_hours": round(known_hours, 4),
        "unknown_hours": round(unknown_hours, 4),
        "blocked_hours": round(hours_by_state["BLOCKED"], 4),
        "blocked_fraction": blocked_fraction,
        "unknown_fraction": unknown_fraction,
        "mean_visible_fraction": mean_fraction,
        "mean_basis": mean_basis,
        "longest_blocked_hours": longest_blocked,
        "longest_basis": longest_basis,
        "interval_count": len(body_intervals),
        "sampling_note": "left-held sampling gives estimates at the requested cadence, not precise event times",
    }
