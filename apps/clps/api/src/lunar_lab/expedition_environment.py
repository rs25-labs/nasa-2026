"""Arrival-time waypoint estimates using the Stage 1 sampled-horizon model."""
from datetime import datetime, timedelta, timezone
import json
import math
import threading
import time

import numpy as np

from .ephemeris import kernel_session, positions
from .hourly_estimates import estimate_rows
from .hourly_publication import GEOMETRY_LOCK, stamp, utc
from .terrain_view import polar_lonlat
from .live_estimates import CORRECTION, FIRST, LAST, RING_AZIMUTHS, find_events

WAYPOINT_LOCK = threading.Lock()
LOOKAHEAD_HOURS = 48


def validate(values):
    if set(values)-{'latitude', 'longitude', 'height', 'arrival', 'forecast'} or not {'latitude', 'longitude', 'height', 'arrival'}<=set(values):
        raise ValueError('Provide waypoint latitude, longitude, observer height and arrival UTC.')
    numbers = {}
    for name, low, high in [('latitude', -90, 90), ('longitude', -180, 180), ('height', 0, 20)]:
        try:
            value = float(values[name])
        except (ValueError, TypeError):
            raise ValueError(f'{name} must be a number.') from None
        if not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f'{name} must be between {low} and {high}.')
        numbers[name] = value
    try:
        arrival = datetime.fromisoformat(values['arrival'].replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('Arrival must be a valid UTC timestamp.') from None
    if arrival.tzinfo is None:
        raise ValueError('Arrival must include a timezone.')
    arrival = arrival.astimezone(timezone.utc).replace(microsecond=0)
    if not FIRST <= arrival < LAST:
        raise ValueError('Waypoint arrival must be within 1969–2035.')
    if values.get('forecast','1') not in ('0','1'):raise ValueError('Forecast must be 0 or 1.')
    return dict(site_id='expedition-waypoint', latitude_deg=numbers['latitude'],
                longitude_deg=numbers['longitude'], observer_height_m=numbers['height'],
                arrival_utc=stamp(arrival), forecast=values.get('forecast','1')=='1')


def waypoint_environment(live, request):
    """Visibility at arrival; future events assume the observer stays here.

    Each HTTP request handles one waypoint, letting the UI show progress,
    preserve individual failures and stop issuing work when inputs change.
    """
    began = time.monotonic()
    global_site=request['latitude_deg']>-85
    view=live.global_view if global_site else live.terrain_view
    with view.lock:
        site, horizon = live.site_and_horizon(request)
        source = view.hashes['global_terrain_image' if global_site else 'terrain_image']
    arrival = utc(request['arrival_utc'])
    end = min(arrival + timedelta(hours=LOOKAHEAD_HOURS if request['forecast'] else 0), LAST)
    times = [arrival]
    while times[-1] + timedelta(hours=1) < end:
        times.append(times[-1] + timedelta(hours=1))
    if times[-1] < end:
        times.append(end)
    ring = np.asarray(horizon['elevation_deg'], dtype=float)
    closed_ring = np.r_[ring, ring[0]]

    def edge_at(azimuth):
        return float(np.interp(azimuth % 360, RING_AZIMUTHS, closed_ring))

    spec = json.loads((live.repo / 'data/manifests/clps/foundation-sources.json').read_text())
    paths = {asset['id']: live.root / 'assets' / asset['filename'] for asset in spec['assets']}
    # All API consumers of process-global SPICE state use this same lock.
    with GEOMETRY_LOCK:
        with kernel_session(paths):
            geometry = positions(site, [stamp(moment) for moment in times], CORRECTION)
            events = find_events(site, geometry, edge_at, CORRECTION)
    codes = np.frombuffer(estimate_rows(geometry[:2], horizon), dtype=np.uint8)
    bodies = {}
    for row, code in zip(geometry[:2], codes):
        code = int(code)
        upcoming = [event for event in events if event['body'] == row['body']]
        next_events = {}
        for kind in ('rise', 'set'):
            event = next((event for event in upcoming if event['kind'] == kind), None)
            next_events[kind] = (dict(event, seconds_after_arrival=(utc(event['utc']) - arrival).total_seconds())
                                 if event else None)
        bodies[row['body']] = dict(row,
            state='FULL' if code == 255 else 'BLOCKED' if code == 0 else 'PARTIAL',
            visible_fraction=code / 255, horizon_elevation_deg=edge_at(row['azimuth_deg']),
            next_events=next_events)
    return dict(model=horizon['model'], terrain=live.terrain_resolution(horizon['model'], horizon), terrain_products=horizon.get('bands'),
                aberration_correction=CORRECTION, request=request,
                arrival_utc=stamp(arrival), lookahead_end_utc=stamp(end), bodies=bodies,
                source_sha256=source, source_pixel_size_m=1895 if global_site else horizon['bands'][0]['pixel_size_m'] if horizon.get('bands') else 40, frame='MOON_ME_DE421',
                calculation_seconds=time.monotonic() - began,
                countdown_basis='Stationary at this waypoint from arrival; not a prediction while moving.',
                methods='Arrival-time Sun/Earth disk estimates from a local terrain horizon with LT+S. Future upper-limb rise/set events sampled hourly and refined to about one minute, up to 48 hours after arrival. Shorter events between hourly samples can be missed.',
                horizon_coverage=horizon['coverage'],
                limitations='Numerical estimates, not certified bounds. Unsampled terrain and between-waypoint conditions are unknown. Earth disk visibility is geometry, not a radio link budget.')


DRIVE_HOURS=72
DEFAULT_MAST_HEIGHT_M=2


def validate_drive(values):
    """Route parameters plus samples and a required departure; returns (route request, samples)."""
    values=dict(values)
    try:samples=int(values.pop('samples','24'))
    except ValueError:raise ValueError('samples must be a whole number.') from None
    if not 2<=samples<=48:raise ValueError('samples must be between 2 and 48.')
    from .expedition import validate as validate_route
    request=validate_route(values)
    waypoint=validate(dict(latitude=values['latitude'],longitude=values['longitude'],height=values.get('height',str(DEFAULT_MAST_HEIGHT_M)),
                           arrival=values.get('departure',''),forecast='0'))
    request.update(departure_utc=waypoint['arrival_utc'],observer_height_m=waypoint['observer_height_m'])
    return request,samples


def sample_route(points,samples):
    """Points evenly spaced by distance along the route, first and last included, interpolated between route vertices."""
    total=points[-1]['distance_m']
    sampled=[];segment=1
    for index in range(samples):
        distance=total*index/(samples-1)
        while segment<len(points)-1 and points[segment]['distance_m']<distance:segment+=1
        before,after=points[segment-1],points[segment]
        span=after['distance_m']-before['distance_m']
        weight=min(1.,max(0.,(distance-before['distance_m'])/span)) if span else 1.
        blend=lambda key:before[key]+(after[key]-before[key])*weight
        x,y=blend('x_m'),blend('y_m')
        latitude,longitude=polar_lonlat(x,y)
        sampled.append(dict(index=index,distance_m=distance,elapsed_seconds=blend('elapsed_seconds'),
                            latitude_deg=latitude,longitude_deg=longitude,elevation_m=blend('elevation_m'),slope_deg=blend('slope_deg')))
    return sampled


def drive_environment(live,route,samples):
    """Sun and Earth state at evenly spaced route points, each at its arrival time, with one kernel session.

    A point that cannot be calculated carries an error string instead of failing the response.
    """
    request=route['request']
    departure=utc(request['departure_utc'])
    entries=sample_route(route['points'],samples)
    prepared=[];models=[]
    for entry in entries:
        arrival=departure+timedelta(seconds=int(entry['elapsed_seconds']))
        entry['utc']=stamp(arrival)
        place=dict(site_id=f'drive-{entry["index"]}',latitude_deg=entry['latitude_deg'],longitude_deg=entry['longitude_deg'],
                   observer_height_m=request['observer_height_m'])
        try:
            if not FIRST<=arrival<LAST:raise ValueError('Arrival must be within 1969–2035.')
            found=live.site_and_horizon(place);models.append(found[1]['model'])
            prepared.append((entry,place,)+found)
        except Exception as exc:
            prepared.append((entry,None,None,f'Terrain could not be sampled: {exc}'))
    with GEOMETRY_LOCK:
        with kernel_session(live.kernel_paths()):
            for entry,place,site,horizon in prepared:
                if place is None:
                    entry.update(sun=None,earth=None,error=horizon);continue
                try:
                    calc=live.calculate(dict(start_utc=entry['utc'],days=DRIVE_HOURS//24),site,horizon)
                    for offset,name in enumerate(('sun','earth')):
                        row=calc['geometry'][offset]
                        upcoming=next((event for event in calc['events'] if event['body']==name.upper()),None)
                        entry[name]=dict(fraction=int(calc['codes'][0,offset])/255,azimuth_deg=row['azimuth_deg'],
                                         elevation_deg=row['center_elevation_deg'],
                                         next_event=dict(kind=upcoming['kind'],utc=upcoming['utc']) if upcoming else None)
                except Exception as exc:
                    entry.update(sun=None,earth=None,error=f'Estimate failed: {exc}')
    return dict(environment=entries,environment_model=models[0] if models else live.model_for(dict(latitude_deg=-90.)),environment_horizon_hours=DRIVE_HOURS)
