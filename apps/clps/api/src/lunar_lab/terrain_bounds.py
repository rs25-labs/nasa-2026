"""Cell footprint enclosures and sector obstruction witnesses.

The inner projected circle is a subset of a constant-radius pixel; the
outer circle encloses the whole pixel. No unvisited cell is called empty.
All deciding arithmetic uses Decimal intervals. Float calculations only
select candidates, propose lower bounds, or skip opportunities for proof.
"""
from __future__ import annotations

from functools import lru_cache
import math
import time

from .bounded_math import Interval, basis, dot, sin_cos_degrees
from .horizon import destination_point

MODEL_ID = 'lml-polar-cell-solid-v1'
SECTOR_STEP_DEG = 0.25
CANDIDATE_CAP = 8192


@lru_cache(maxsize=8192)
def trig(angle):
    return sin_cos_degrees(angle)


def circle_cap(x, y, radius, reference_radius):
    """Inverse stereographic circle: unit n satisfies v dot n >= k.

    Algebraically exact before outward interval rounding. Inner/outer
    circle inclusion is done in the projection plane, not by sampling
    curved footprint corners.
    """
    R = Interval(reference_radius)
    q = x.square() + y.square() - radius.square()
    # South-polar lon_0=0 stereographic uses projected x along lunar +Y
    # (east at lon 0), and projected y along lunar +X (north at lon 0).
    v = (4*R*y, 4*R*x, q - 4*R.square())
    k = 4*R.square() + q
    return v, k


def cap_cosine_range(v, k, up):
    """Enclose n dot up for every unit n in a small spherical cap."""
    norm = dot(v, v).sqrt()
    c = dot(v, up) / norm
    s = k / norm
    a = c*s
    b = ((1-c.square()).nonnegative() * (1-s.square()).nonnegative()).sqrt()
    lo = max(-1, (a-b).lo)
    hi = min(1, (a+b).hi)
    # If up or -up is inside (or cannot be excluded from) the cap,
    # the corresponding extremum is attained in its interior.
    A = dot(v, up)
    if A.hi >= k.lo:
        hi = 1
    if (-A).hi >= k.lo:
        lo = -1
    return Interval(lo, hi)


def elevation_lower(v, k, surface_radius, observer_radius, up):
    """A verified lower elevation across the entire inner cap, or -90."""
    cosine = cap_cosine_range(v, k, up)
    z = surface_radius*cosine - observer_radius
    horizontal = surface_radius * (1-cosine.square()).nonnegative().sqrt()
    h = horizontal.hi if z.lo >= 0 else horizontal.lo
    proposal = math.degrees(math.atan2(float(z.lo), float(h)))
    tick = max(-8999, min(8999, math.floor(proposal*100)-1))
    angle = f'{tick / 100:.2f}'
    sine, cosine_angle = trig(angle)
    # cos(angle)>0 and horizontal>=0 make this comparison equivalent
    # to elevation>angle for all enclosed points. Failure proves nothing.
    if (z*cosine_angle - horizontal*sine).lo > 0:
        return math.nextafter(float(angle), -math.inf)
    return -90.0


def covers_sector(v, k, east, north, up, start_deg, end_deg):
    """Prove that every forward great circle in a sector meets the cap.

    A=v.up; B(a)=v.(east*sin(a)+north*cos(a)). A>0, B>0 and
    A²+B²>k² ensure an intersection at delta in (0,pi/2).
    For sector width<180 degrees with both endpoint B values positive,
    B remains positive and concave, so its minimum is at an endpoint.
    """
    if not 0 < end_deg-start_deg < 180:
        return False
    A = dot(v, up)
    E, N = dot(v, east), dot(v, north)
    s0, c0 = trig(str(start_deg))
    s1, c1 = trig(str(end_deg))
    b0, b1 = E*s0 + N*c0, E*s1 + N*c1
    minimum = min(b0.lo, b1.lo)
    return A.lo > 0 and minimum > 0 and (A.square()+Interval(minimum).square()).lo > k.square().hi


def candidate_cells(terrain, site, profiles):
    """Bounded discovery only; selection never certifies coverage."""
    seeds = [(site['sample_row_zero_based'], site['sample_col_zero_based'])]
    for profile in profiles:
        if profile['samples_used'] <= 0:
            continue
        lat, lon = destination_point(site['latitude_deg'], site['longitude_deg'], profile['azimuth_deg'], profile['diagnostic_max_distance_m'])
        try:
            sample = terrain.sample(lat, lon)
        except ValueError:
            continue
        seeds.append((sample['sample_row_zero_based'], sample['sample_col_zero_based']))
    cells = set()
    for row, col in seeds:
        for dr in range(-2, 3):
            for dc in range(-2, 3):
                if 0 <= row+dr < terrain.rows and 0 <= col+dc < terrain.cols:
                    cells.add((row+dr, col+dc))
                    if len(cells) >= CANDIDATE_CAP:
                        return sorted(cells), True
    return sorted(cells), False


def build_sector_bounds(terrain, site, profiles):
    """Return (cell evidence, complete sector partition, checkpoint metadata).

    Only inner circles fully contained in the nominal cap become witnesses.
    Clipped/invalid cells remain unknown. The observer's cell is visited,
    including its near field, but zero-height contact gives no proof.
    """
    began = time.perf_counter()
    east, north, up = basis(site['latitude_deg'], site['longitude_deg'])
    cells, truncated = candidate_cells(terrain, site, profiles)
    sectors = [
        {
            'az_start_deg': index*SECTOR_STEP_DEG,
            'az_end_deg': (index+1)*SECTOR_STEP_DEG,
            'horizon_lower_deg': -90.0,
            'horizon_upper_deg': 90.0,
            'upper_bound_available': False,
            'witness_cell_id': '',
            'model_id': MODEL_ID,
            'status': 'INDETERMINATE',
            'reason': 'No global upper envelope; unvisited/invalid terrain unknown',
        }
        for index in range(round(360/SECTOR_STEP_DEG))
    ]
    # Nominal-cap boundary in stereographic meters: 2R*tan((90+lat)/2).
    sine, cosine = trig(str((90+terrain.max_lat)/2))
    cap_radius = 2*Interval(terrain.radius)*sine/cosine
    evidence = []
    for row, col in cells:
        dn = int(terrain.raw[row, col])
        if not terrain.valid_dn(dn):
            continue
        x = (Interval(col)-terrain.col_offset)*terrain.scale
        y = (Interval(terrain.row_offset)-row)*terrain.scale
        inner_radius = Interval(terrain.scale)/2
        outer_radius = inner_radius*Interval(2).sqrt()
        inner_v, inner_k = circle_cap(x, y, inner_radius, terrain.radius)
        outer_v, outer_k = circle_cap(x, y, outer_radius, terrain.radius)
        inside = ((x.square()+y.square()).sqrt()+inner_radius).hi < cap_radius.lo
        surface_radius = Interval(terrain.radius)+Interval(dn)*terrain.factor
        lower = elevation_lower(inner_v, inner_k, surface_radius, Interval(site['observer_radius_m']), up) if inside else -90.0
        record = {
            'cell_id': f'{row}:{col}', 'row': row, 'col': col, 'raw_dn': dn,
            'surface_radius_m': surface_radius.midpoint_float(),
            'inner_circle_within_nominal_cap': inside,
            'inner_cap_elevation_lower_deg': lower,
            'observer_cell': row == site['sample_row_zero_based'] and col == site['sample_col_zero_based'],
            'model_id': MODEL_ID,
        }
        for label, vector, threshold in (('inner',inner_v,inner_k), ('outer',outer_v,outer_k)):
            for name, value in zip(('vx','vy','vz','k'), (*vector,threshold)):
                record[f'{label}_{name}_lo'] = str(value.lo)
                record[f'{label}_{name}_hi'] = str(value.hi)
        evidence.append(record)
        if not inside or lower <= -90:
            continue
        # Approximate bearing only prioritizes nearby sectors. A miss
        # loses a witness; every accepted sector is independently proven.
        E, N = dot(inner_v,east), dot(inner_v,north)
        bearing = math.degrees(math.atan2(E.midpoint_float(), N.midpoint_float())) % 360
        horizontal = math.hypot(E.midpoint_float(), N.midpoint_float())
        norm2 = dot(inner_v,inner_v)
        cap_sine_numerator = (norm2-inner_k.square()).nonnegative().sqrt().midpoint_float()
        if horizontal > cap_sine_numerator > 0:
            half_width = math.degrees(math.asin(min(1,cap_sine_numerator/horizontal))) + SECTOR_STEP_DEG
            indices = {i % len(sectors) for i in range(math.floor((bearing-half_width)/SECTOR_STEP_DEG), math.ceil((bearing+half_width)/SECTOR_STEP_DEG)+1)}
        else:
            indices = range(len(sectors))
        for index in indices:
            sector = sectors[index]
            if lower > sector['horizon_lower_deg'] and covers_sector(inner_v,inner_k,east,north,up,sector['az_start_deg'],sector['az_end_deg']):
                sector['horizon_lower_deg'] = lower
                sector['witness_cell_id'] = record['cell_id']
    return evidence, sectors, {
        'model_id': MODEL_ID,
        'scope': 'Cell enclosures and inner-cap obstruction witnesses only; no disk classification yet',
        'arithmetic': '50-digit outward Decimal intervals; 100-term trig with Lagrange remainder',
        'candidate_selection': 'Observer cell neighborhood plus diagnostic-maximum neighborhoods; not exhaustive',
        'candidate_cap': CANDIDATE_CAP,
        'candidate_cap_reached': truncated,
        'candidate_cells': len(cells),
        'valid_cell_enclosures': len(evidence),
        'sector_step_deg': SECTOR_STEP_DEG,
        'sectors': len(sectors),
        'sectors_with_lower_witness': sum(bool(s['witness_cell_id']) for s in sectors),
        'sectors_with_upper_bound': 0,
        'wall_seconds': time.perf_counter()-began,
        'physical_uncertainty': 'No physical height-error envelope; bounds conditional on constant-radius pixel solids',
    }
