"""Sufficient whole-disk obstruction proof, conditional on raster/geometry.

No full-horizon requirement is imposed on a valid obstruction witness.
There is no global terrain upper envelope, so FULL/PARTIAL are not emitted.
"""
from __future__ import annotations

from dataclasses import dataclass
import math

from .bounded_math import Interval, sin_cos_degrees
from .terrain_bounds import MODEL_ID, trig


@dataclass(frozen=True)
class Sector:
    start: float
    end: float
    lower: float
    witness: str
    model_id: str
    start_sine: Interval
    start_cosine: Interval
    end_sine: Interval
    end_cosine: Interval
    middle_sine: Interval
    middle_cosine: Interval
    gap: bool = False


def prepare_sectors(bounds: list[dict]) -> list[Sector]:
    """Validate nonoverlapping sectors and insert unknown gaps explicitly."""
    result = []

    def append(start, end, row=None):
        if row is None and end-start >= 180:
            middle = (start+end)/2
            append(start, middle)
            append(middle, end)
            return
        lower = float(row.get('horizon_lower_deg', -90)) if row else -90.0
        if not math.isfinite(lower) or not -90 <= lower <= 90:
            raise ValueError('Invalid sector lower bound')
        ss, sc = trig(start)
        es, ec = trig(end)
        ms, mc = sin_cos_degrees((Interval(start)+Interval(end))/2)
        result.append(Sector(start, end, lower, str(row.get('witness_cell_id', '')) if row else '',
                             str(row.get('model_id', '')) if row else '', ss, sc, es, ec, ms, mc, row is None))

    ordered = []
    for row in bounds:
        start, end = float(row['az_start_deg']), float(row['az_end_deg'])
        if not all(math.isfinite(x) for x in (start,end)) or not 0 <= start < end <= 360 or end-start >= 180:
            raise ValueError('Sector must be finite, inside [0,360], and narrower than 180 degrees')
        ordered.append((start,end,row))
    cursor = 0.0
    for start,end,row in sorted(ordered, key=lambda entry: entry[0]):
        if start < cursor:
            raise ValueError('Overlapping sectors cannot establish a partition')
        if start > cursor:
            append(cursor,start)
        append(start,end,row)
        cursor = end
    if cursor < 360:
        append(cursor,360.0)
    return result


def classify_disk(row: dict, sectors: list[Sector]) -> dict:
    """Require witnesses over a conservative superset of the disk footprint.

    A disk direction differs from its center by chord length at most
    2*sin(radius/2). A unit inward meridian normal therefore has dot
    product <= its dot with the center plus that chord bound. Only a
    strictly negative upper endpoint permits exclusion from a sector.
    The test includes tangent sectors and handles poles without azimuth
    division or an inverse trig approximation.
    The forward midpoint hemisphere also contains the complete sector;
    it rejects the opposite-bearing false positives of separate endpoint
    half-space tests on very narrow sectors.
    """
    az = float(row['azimuth_deg'])
    elev = float(row['center_elevation_deg'])
    radius = float(row['angular_radius_deg'])
    if not all(math.isfinite(x) for x in (az,elev,radius)) or not -90 <= elev <= 90 or not 0 < radius < 90:
        raise ValueError('Disk geometry must be finite with elevation in [-90,90] and radius in (0,90)')
    sa, ca = sin_cos_degrees(az % 360)
    se, ce = sin_cos_degrees(elev)
    center_east, center_north = ce*sa, ce*ca
    chord_sine, _ = sin_cos_degrees(Interval(radius)/2)
    chord = 2*chord_sine
    selected = []
    for sector in sectors:
        start_dot = sector.start_cosine*center_east - sector.start_sine*center_north
        end_dot = -sector.end_cosine*center_east + sector.end_sine*center_north
        middle_dot = sector.middle_sine*center_east + sector.middle_cosine*center_north
        if (start_dot+chord).hi < 0 or (end_dot+chord).hi < 0 or (middle_dot+chord).hi < 0:
            continue
        selected.append(sector)
    elevation_upper = min(Interval(90).hi, (Interval(elev)+Interval(radius)).hi)
    witnessed = [s for s in selected if s.witness and s.model_id == MODEL_ID]
    blocked = bool(selected) and len(witnessed) == len(selected) and all(Interval(s.lower).lo > elevation_upper for s in selected)
    if blocked:
        reason = 'entire-disk-below-witnessed-sector-lower-bounds; raster-model conditional'
    elif not selected:
        reason = 'no-supported-disk-sector-coverage'
    elif any(s.gap for s in selected):
        reason = 'missing-sector-coverage-in-disk-footprint'
    elif len(witnessed) != len(selected):
        reason = 'missing-or-model-mismatched-witness-in-disk-footprint'
    else:
        reason = 'disk-not-strictly-below-all-sector-lower-bounds; upper-terrain-envelope-unavailable'
    return {
        'state': 'BLOCKED' if blocked else 'UNKNOWN',
        'state_reason': reason,
        'visible_fraction': 0.0 if blocked else '',
        'visible_fraction_lower': 0.0,
        'visible_fraction_upper': 0.0 if blocked else 1.0,
        'disk_elevation_upper_deg': min(90.0, math.nextafter(float(elevation_upper), math.inf)),
        'footprint_sectors': len(selected),
        'witnessed_footprint_sectors': len(witnessed),
        'footprint_sector_ids': ';'.join(f'{s.start}:{s.end}' for s in selected),
        'witness_cell_ids': ';'.join(sorted({s.witness for s in witnessed})),
        'visibility_model_id': MODEL_ID,
        'visibility_basis': 'bounds conditional on reported geometric directions and constant-radius pixel solids; no physical height-error envelope',
    }
