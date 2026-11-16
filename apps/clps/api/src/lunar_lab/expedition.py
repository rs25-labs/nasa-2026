"""Bounded illustrative traverses on native south-polar LOLA pixels.

No lighting, rocks, traction or radio performance is inferred by this model.
"""
import heapq
import math
import threading
import time

import numpy as np

from .terrain_view import polar_xy, polar_lonlat

MODEL = 'lml-native-grid-traverse-v1'
MAX_TARGET_M = 8000
PADDING_M = 1000
MAX_SIDE = 401
SNAP_M = 60
MAX_EXPANSIONS = 120000
MAX_SECONDS = 6
# The 10 m product is searched over 16 times the cells of the 40 m one for the same ground.
FINE_SCALE_M = 10
FINE_EXPANSION_FACTOR = 4
FINE_SECONDS = 12
ROUTE_LOCK = threading.Lock()


class NoRoute(ValueError):
    """No supported route within the searched window and slope rule."""


class SearchLimit(ValueError):
    """A bounded search stopped before it could establish reachability."""


def validate(values):
    expected = {'latitude', 'longitude', 'target_latitude', 'target_longitude', 'slope', 'speed'}
    if not expected<=set(values) or set(values)-expected-{'sunlight','departure','height'}:
        raise ValueError('Provide start and target latitude/longitude, slope and speed.')
    checked = {}
    for name in expected:
        try:
            value = float(values[name])
        except (ValueError, TypeError):
            raise ValueError(f'{name} must be a number.') from None
        if not math.isfinite(value):
            raise ValueError(f'{name} must be finite.')
        low, high = ((-90, -85) if 'latitude' in name else (-180, 180) if 'longitude' in name
                     else (1, 35) if name == 'slope' else (.1, 10))
        if not low <= value <= high:
            raise ValueError(f'{name} must be between {low} and {high}.')
        checked[name] = value
    start = polar_xy(checked['latitude'], checked['longitude'])
    target = polar_xy(checked['target_latitude'], checked['target_longitude'])
    if math.dist(start, target) > MAX_TARGET_M:
        raise ValueError('Choose a target within 8 km of the landing site.')
    if values.get('sunlight','0') not in ('0','1'):raise ValueError('Sunlight preference must be 0 or 1.')
    checked['prefer_sunlight']=values.get('sunlight','0')=='1'
    if checked['prefer_sunlight']:
        from .expedition_environment import validate as validate_waypoint
        waypoint=validate_waypoint(dict(latitude=values['latitude'],longitude=values['longitude'],height=values.get('height','2'),arrival=values.get('departure',''),forecast='0'))
        checked.update(departure_utc=waypoint['arrival_utc'],observer_height_m=waypoint['observer_height_m'])
    return checked


def cell_slopes(heights, spacing):
    """Central differences; missing neighbours and array edges are impassable."""
    slopes = np.full(heights.shape, np.inf)
    dx = (heights[1:-1, 2:] - heights[1:-1, :-2]) / (2 * spacing)
    dy = (heights[2:, 1:-1] - heights[:-2, 1:-1]) / (2 * spacing)
    values = np.degrees(np.arctan(np.hypot(dx, dy)))
    valid = (np.isfinite(heights[1:-1, 1:-1]) & np.isfinite(dx) & np.isfinite(dy))
    slopes[1:-1, 1:-1] = np.where(valid, values, np.inf)
    return slopes


def snap_usable(usable, cell, spacing):
    """An endpoint on a pixel over the slope limit moves to the nearest usable pixel within SNAP_M, else stays."""
    if usable[cell]:
        return cell
    reach = math.ceil(SNAP_M / spacing)
    r0, c0 = cell
    best, found = None, cell
    for r in range(max(0, r0 - reach), min(usable.shape[0], r0 + reach + 1)):
        for c in range(max(0, c0 - reach), min(usable.shape[1], c0 + reach + 1)):
            distance = math.hypot(r - r0, c - c0)
            if usable[r, c] and distance * spacing <= SNAP_M and (best is None or distance < best):
                best, found = distance, (r, c)
    return found


def find_path(heights, start, target, spacing, limit, penalties=None, max_expansions=MAX_EXPANSIONS, max_seconds=MAX_SECONDS):
    """A* minimizes distance with a slope penalty on an eight-neighbour graph."""
    slopes = cell_slopes(heights, spacing)
    usable = slopes <= limit
    start, target = snap_usable(usable, start, spacing), snap_usable(usable, target, spacing)
    if not usable[start] or not usable[target]:
        raise NoRoute('An endpoint has missing terrain or exceeds the slope limit. Choose another target or limit.')
    if start == target:
        raise NoRoute('Start and target snap to the same terrain pixel. Choose a farther target.')
    began = time.monotonic()
    rows, cols = heights.shape
    best = np.full(heights.shape, np.inf); best[start] = 0
    previous = {}
    closed = np.zeros(heights.shape, dtype=bool)
    queue = [(math.dist(start, target) * spacing, 0., start)]
    expansions = 0
    while queue:
        _, cost, here = heapq.heappop(queue)
        if closed[here] or cost > best[here]:
            continue
        if here == target:
            path = [here]
            while path[-1] != start:
                path.append(previous[path[-1]])
            return path[::-1], slopes
        closed[here] = True
        expansions += 1
        if expansions >= max_expansions or (expansions % 128 == 0 and time.monotonic() - began > max_seconds):
            raise SearchLimit('Search limit reached; reachability is unknown. Choose a nearer target.')
        r, c = here
        for dr, dc in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)):
            nr, nc = r + dr, c + dc
            there = (nr, nc)
            if not (0 <= nr < rows and 0 <= nc < cols) or not usable[there] or closed[there]:
                continue
            if dr and dc and (not usable[r, nc] or not usable[nr, c]):
                continue
            distance = spacing * math.hypot(dr, dc)
            grade = math.degrees(math.atan2(abs(float(heights[there] - heights[here])), distance))
            if grade > limit:
                continue
            slope = max(float(slopes[here]), float(slopes[there]), grade)
            penalty=max(float(penalties[here]),float(penalties[there])) if penalties is not None else 1
            next_cost = cost + distance * (1 + (slope / limit) ** 2)*penalty
            if next_cost < best[there]:
                best[there] = next_cost
                previous[there] = here
                heuristic = math.dist(there, target) * spacing
                heapq.heappush(queue, (next_cost + heuristic, next_cost, there))
    raise NoRoute('No route within this search window at this slope limit. Try a nearer target or a different limit.')


def route_profile(path, heights, slopes, spacing, speed):
    profile = []
    distance = 0.
    for index, (r, c) in enumerate(path):
        grade = 0.
        if index:
            before = path[index - 1]
            segment = math.dist(before, (r, c)) * spacing
            distance += segment
            grade = math.degrees(math.atan2(abs(float(heights[r, c] - heights[before])), segment))
        profile.append(dict(distance_m=distance, elapsed_seconds=distance / (speed / 3.6),
                            elevation_m=float(heights[r, c]), slope_deg=float(slopes[r, c]),
                            segment_grade_deg=grade))
    return profile


def departure_shadow_cost(heights,xs,ys,start_xy,azimuth,elevation,longitude,height):
    """Bounded local centre-ray proxy, not moving-observer disk visibility."""
    x=xs[None,:]-start_xy[0];y=ys[:,None]-start_xy[1]
    curved=heights-(x*x+y*y)/(2*1737400)
    blocked=np.zeros(heights.shape,dtype=bool);unknown=np.zeros(heights.shape,dtype=bool)
    bearing=math.radians(longitude+azimuth);rise=math.tan(math.radians(elevation))
    rows,cols=heights.shape;seen=set();began=time.monotonic()
    for step in range(1,math.ceil(math.hypot(rows,cols))+1):
        if step%16==0 and time.monotonic()-began>MAX_SECONDS:raise SearchLimit('Departure shadow calculation limit reached. Disable sunlight preference or choose a nearer target.')
        dr=round(-math.cos(bearing)*step);dc=round(math.sin(bearing)*step)
        if (dr,dc)==(0,0) or (dr,dc) in seen:continue
        seen.add((dr,dc));r0=max(0,-dr);r1=min(rows,rows-dr);c0=max(0,-dc);c1=min(cols,cols-dc)
        if r0>=r1 or c0>=c1:continue
        there=curved[r0+dr:r1+dr,c0+dc:c1+dc];here=curved[r0:r1,c0:c1]
        unknown[r0:r1,c0:c1]|=~np.isfinite(there)
        blocked[r0:r1,c0:c1]|=there>here+height+40*math.hypot(dr,dc)*rise
    return np.where(blocked,3.,np.where(unknown,4.,1.))


def plan_route(view, request, live=None):
    """Plan on the 10 m product when it is installed, the surface the renderer draws; where its steeper slopes leave no
    route under the limit, fall back to the 40 m grid (the response says which pixel size was used)."""
    try:
        return _plan_route(view, request, live, True)
    except NoRoute:
        return _plan_route(view, request, live, False)


def _plan_route(view, request, live, fine):
    """Read an aligned native window; never use the decimated display grid."""
    began = time.monotonic()
    requested = [polar_xy(request['latitude'], request['longitude']),
                 polar_xy(request['target_latitude'], request['target_longitude'])]
    with view.lock:
        terrain = view.terrain()
        source_name = 'terrain_image'
        for name, reader in (view.products() if fine else ()):
            if reader.scale <= FINE_SCALE_M:
                terrain, source_name = reader, name
                break
        spacing = terrain.scale
        side_limit = math.ceil(MAX_SIDE * 40 / spacing)
        cells = [(math.floor(terrain.row_offset - y / spacing + .5),
                  math.floor(terrain.col_offset + x / spacing + .5)) for x, y in requested]
        padding = math.ceil(PADDING_M / spacing)
        r0 = max(0, min(r for r, c in cells) - padding)
        r1 = min(terrain.rows, max(r for r, c in cells) + padding + 1)
        c0 = max(0, min(c for r, c in cells) - padding)
        c1 = min(terrain.cols, max(c for r, c in cells) + padding + 1)
        if (r1 <= r0 or c1 <= c0 or max(r1 - r0, c1 - c0) > side_limit
                or any(not (r0 <= r < r1 and c0 <= c < c1) for r, c in cells)):
            raise ValueError('Route endpoints fall outside the bounded terrain window.')
        raw = np.asarray(terrain.raw[r0:r1, c0:c1]).copy()
        xs = (np.arange(c0, c1) - terrain.col_offset) * spacing
        ys = (terrain.row_offset - np.arange(r0, r1)) * spacing
        cap = 2 * terrain.radius * math.tan(math.radians(90 + terrain.max_lat) / 2)
        valid = terrain.valid_dn(raw) & (ys[:, None] ** 2 + xs[None, :] ** 2 <= cap ** 2)
        heights = np.where(valid, raw.astype(float) * terrain.factor, np.nan)
        source = view.hashes['terrain_image'] if source_name == 'terrain_image' else source_name
        site=terrain.sample(request['latitude'],request['longitude'],request.get('observer_height_m',2))
    start, target = [(r - r0, c - c0) for r, c in cells]
    penalties=None
    if request.get('prefer_sunlight'):
        if live is None:raise ValueError('Sunlight-preference routing requires the live geometry service.')
        from .ephemeris import kernel_session,positions
        from .hourly_publication import GEOMETRY_LOCK
        from .live_estimates import CORRECTION
        import json
        spec=json.loads((live.repo/'data/manifests/clps/foundation-sources.json').read_text())
        paths={asset['id']:live.root/'assets'/asset['filename'] for asset in spec['assets']}
        with GEOMETRY_LOCK:
            with kernel_session(paths):sun=positions(dict(site,id='route-departure'),[request['departure_utc']],CORRECTION)[0]
        penalties=departure_shadow_cost(heights,xs,ys,requested[0],sun['azimuth_deg'],sun['center_elevation_deg'],request['longitude'],request['observer_height_m'])
    fine = spacing <= FINE_SCALE_M
    path, slopes = find_path(heights, start, target, spacing, request['slope'], penalties,
                             MAX_EXPANSIONS * (FINE_EXPANSION_FACTOR if fine else 1), FINE_SECONDS if fine else MAX_SECONDS)
    profile = route_profile(path, heights, slopes, spacing, request['speed'])
    for (r, c), point in zip(path, profile):
        x, y = float(xs[c]), float(ys[r])
        latitude, longitude = polar_lonlat(x, y)
        point.update(x_m=x, y_m=y, latitude_deg=latitude, longitude_deg=longitude)
        if penalties is not None:point['departure_light_proxy']='shadowed' if penalties[r,c]==3 else 'unknown' if penalties[r,c]==4 else 'unshadowed within window'
    snaps = [dict(requested_latitude_deg=request[prefix + 'latitude'],
                  requested_longitude_deg=request[prefix + 'longitude'],
                  latitude_deg=point['latitude_deg'], longitude_deg=point['longitude_deg'],
                  offset_m=math.dist(xy, (point['x_m'], point['y_m'])))
             for prefix, xy, point in zip(('', 'target_'), requested, (profile[0], profile[-1]))]
    return dict(model='lml-native-grid-traverse-v2-sun-proxy' if penalties is not None else MODEL, request=request, points=profile, endpoints=snaps,
                sunlight_preference=('Departure-time local centre-ray shadow cost: 1× unshadowed, 3× shadowed, 4× missing ray data. Approximate direction across a bounded native grid; far terrain and changing light during travel omitted. Arrival-time disk visibility is calculated independently.' if penalties is not None else 'Off; shortest slope-penalized distance.'),
                distance_m=profile[-1]['distance_m'], travel_seconds=profile[-1]['elapsed_seconds'],
                max_slope_deg=max(max(p['slope_deg'], p['segment_grade_deg']) for p in profile),
                ascent_m=sum(max(0, b['elevation_m'] - a['elevation_m']) for a, b in zip(profile, profile[1:])),
                descent_m=sum(max(0, a['elevation_m'] - b['elevation_m']) for a, b in zip(profile, profile[1:])),
                search_window=dict(rows=r1-r0, columns=c1-c0, padding_m=PADDING_M),
                source_pixel_size_m=spacing, source_sha256=source, frame='MOON_ME_DE421',
                calculation_seconds=time.monotonic()-began,
                methods=('Eight-neighbour minimum slope-penalized-distance path on native pixels; central-difference terrain slope and segment grade limited; no diagonal corner cutting. Distances and slopes use the projected {spacing:g} m grid. Endpoints snap to pixel centres.').format(spacing=spacing),
                limitations=('Illustrative traverse, not a trafficability assessment. {spacing:g} m terrain cannot resolve rocks or small craters. Route geometry alone carries no visibility; arrival-time visibility is evaluated separately at discrete waypoints.').format(spacing=spacing))
