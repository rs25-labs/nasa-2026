"""Coarse Sun-shadow mask over a square south-polar map area at one instant.

A map-scale visual aid: which ground is sunlit and which is in terrain shadow.
It is NOT the per-site visibility estimate; that (2 m mast, 150 km horizon ring,
refined events) stays the authority for numbers.

Request (see planner_server): GET /api/terrain/shadow?x=&y=&span=&size=&utc=
  x,y   centre of the area in the south-polar stereographic plane, metres,
        within +-200 km (same plane and limits as /api/terrain/tile)
  span  side of the square area, 7 680-320 000 m
  size  64, 128, 192 or 256 cells per side
  utc   UTC timestamp with a timezone, 1969-01-01 up to (excluding) 2036-01-01

Response body: size*size unsigned bytes, row-major, north row (largest y) first,
west column (smallest x) first. Cell (row, col) is the cell centred at
x - span/2 + (col + .5)*span/size, y + span/2 - (row + .5)*span/size.
  0        Sun's disc fully blocked by terrain (including a Sun below the cell's horizon)
  1..249   partly lit: round(250 * lit fraction of the Sun's disc), kept within
           1..249 unless the fraction is exactly 0 or 1
  250      Sun's disc fully clear
  251..254 unused
  255      no terrain data for this cell (outside the LOLA polar cap or invalid)
Lit fraction = 0.5 + (u*sqrt(1-u^2) + asin(u))/pi with u = clip((Sun centre
elevation - horizon elevation)/Sun angular radius, -1, 1): the circular-segment
formula hourly_estimates.estimate_rows uses.

Headers: X-Sun-Azimuth-Deg and X-Sun-Elevation-Deg (geometric centre of the Sun,
at the area centre, LT+S corrected, degrees from local north toward east and
above the local horizontal), X-Terrain-Product (source raster ids used,
comma-separated, finest first).

Method. Heights come from TerrainView.tile (vertex-registered bilinear tiles,
the raster product is chosen by the tile code). A coarse working tile covers the
area plus a margin of 30 km on every side (the span is capped at 320 km, so a
320 km area has no margin; the LOLA cap itself ends 152 km from the pole). For
areas up to about 20 km a finer tile covers the area plus a margin of up to
12 km and serves the first part of every ray. Each output cell marches toward
the Sun through the working tiles; sample distance grows as
max(tile spacing, 4 % of the distance), so near terrain is read at tile spacing
and far terrain at coarser steps (a ridge narrower than 4 % of its distance can
be missed). The highest terrain elevation along the ray, with the Moon's
curvature lowering terrain at distance d by d^2/(2R), R = 1 737 400 m, and
measured from the cell's own tangent plane (so a peak's horizon dips below 0),
is the horizon in the Sun's direction; a cell whose rays meet no terrain at all
uses the flat horizontal (0).
Rays stop where they leave the working tile; terrain beyond it is not considered,
and samples with missing terrain are ignored.

Sun direction. One topocentric Sun azimuth/elevation at the area centre from
ephemeris.positions with the aberration correction on-demand estimates use
(LT+S), inside GEOMETRY_LOCK and kernel_session. That fixes the Sun's unit
vector in the lunar frame; each cell then gets its own azimuth, elevation and
map direction from it, so the Sun's change across the area is included (parallax
of the Sun across the Moon is ~1e-5 rad and ignored). Map direction of the Sun
from a cell at longitude L with azimuth A is (sin(L+A), cos(L+A)) in (x, y): the
same bearing = longitude + azimuth rule as expedition.departure_shadow_cost and
the old frontend's skyDirection in terrain3d.js.

Limitations: ground-level observer (no mast); rays are straight lines in the
map plane (great circles curve slightly; stereographic scale error <0.3 % within
the cap); the Sun disc is a circle with the radius reported by the ephemeris;
cells are point samples, so shadows narrower than a cell can be missed.
"""
from collections import OrderedDict
from datetime import datetime,timezone
import math
import threading

import numpy as np

from .ephemeris import kernel_session,positions
from .hourly_publication import GEOMETRY_LOCK,stamp
from .live_estimates import FIRST,LAST,CORRECTION
from .terrain_view import RADIUS

SIZES=(64,128,192,256)
MARGIN_M=30000.
FINE_MARGIN_M=12000.
STEP_FRACTION=.04
WORKING_SIZE=513
CACHE_ENTRIES=64
LIT_SCALE=250
NO_DATA=255
_cache=OrderedDict()
_cache_lock=threading.Lock()


class Unavailable(Exception):
    """Terrain or ephemeris kernels could not be read."""


def validate(values):
    """Checked (x, y, span, size, utc) from one query mapping; x, y and span are rounded to whole metres."""
    if set(values)!={'x','y','span','size','utc'}:raise ValueError('Provide x, y, span, size and utc once each.')
    numbers={}
    for key in ('x','y','span'):
        try:number=float(values[key])
        except ValueError:raise ValueError(f'{key} must be a number.') from None
        if not math.isfinite(number):raise ValueError(f'{key} must be a finite number.')
        numbers[key]=float(round(number))
    if abs(numbers['x'])>200000 or abs(numbers['y'])>200000:raise ValueError('Area centre must be within ±200 km.')
    if not 7680<=numbers['span']<=320000:raise ValueError('Span must be 7 680–320 000 m.')
    try:size=int(values['size'])
    except ValueError:raise ValueError('Size must be 64, 128, 192 or 256.') from None
    if size not in SIZES:raise ValueError('Size must be 64, 128, 192 or 256.')
    text=values['utc'].strip().replace(' ','+')
    try:moment=datetime.fromisoformat(text.replace('Z','+00:00'))
    except ValueError:raise ValueError('utc must be a valid UTC timestamp such as 2026-11-23T21:00:00Z.') from None
    if moment.tzinfo is None:raise ValueError('utc must include a timezone, for example Z.')
    moment=moment.astimezone(timezone.utc).replace(microsecond=0)
    if not FIRST<=moment<LAST:raise ValueError('utc must fall within 1969–2035.')
    return numbers['x'],numbers['y'],numbers['span'],size,moment


class Level:
    """One vertex-registered working height tile (float32, NaN where missing)."""
    def __init__(self,terrain_view,x,y,span):
        try:
            raw,product,_=terrain_view.tile(x,y,span,WORKING_SIZE)
        except (OSError,KeyError,ValueError) as exc:raise Unavailable(f'Cached terrain unavailable: {exc}') from None
        self.heights=np.frombuffer(raw,dtype='<f4').astype(np.float32).reshape(WORKING_SIZE,WORKING_SIZE)
        self.flat=self.heights.ravel()
        self.product=product;self.span=span
        self.spacing=np.float32(span/(WORKING_SIZE-1))
        self.left=x-span/2;self.top=y+span/2

    def sample(self,px,py):
        """Bilinear heights at map points and a mask of points inside the tile; NaN where outside or missing."""
        n=WORKING_SIZE
        fc=(px-self.left)/self.spacing;fr=(self.top-py)/self.spacing
        inside=(fc>=0)&(fc<=n-1)&(fr>=0)&(fr<=n-1)
        c0=np.clip(np.floor(fc),0,n-2).astype(np.intp);r0=np.clip(np.floor(fr),0,n-2).astype(np.intp)
        tc=np.clip(fc-c0,0,1);tr=np.clip(fr-r0,0,1)
        base=r0*n+c0
        top=self.flat[base]*(1-tc)+self.flat[base+1]*tc
        bottom=self.flat[base+n]*(1-tc)+self.flat[base+n+1]*tc
        return np.where(inside,top*(1-tr)+bottom*tr,np.nan).astype(np.float32),inside


def sun_at_centre(live,x,y,moment):
    """Sun azimuth, elevation (degrees) and angular radius at the area centre, LT+S corrected."""
    latitude=-90+math.degrees(2*math.atan(math.hypot(x,y)/(2*RADIUS)));longitude=math.degrees(math.atan2(x,y))
    site=dict(id='shadow-centre',latitude_deg=latitude,longitude_deg=longitude,observer_radius_m=RADIUS)
    try:
        with GEOMETRY_LOCK:
            with kernel_session(live.kernel_paths()):
                rows=positions(site,[stamp(moment)],CORRECTION)
    except Exception as exc:raise Unavailable(f'Ephemeris kernels unavailable: {exc}') from None
    sun=next(row for row in rows if row['body']=='SUN')
    return sun['azimuth_deg'],sun['center_elevation_deg'],sun['angular_radius_deg'],math.radians(latitude),math.radians(longitude)


def compute(terrain_view,live,x,y,span,size,moment):
    azimuth,elevation,sun_radius,centre_lat,centre_lon=sun_at_centre(live,x,y,moment)
    # Sun unit vector in the lunar frame, from the centre's local basis.
    up=np.array([math.cos(centre_lat)*math.cos(centre_lon),math.cos(centre_lat)*math.sin(centre_lon),math.sin(centre_lat)])
    east=np.array([-math.sin(centre_lon),math.cos(centre_lon),0.]);north=np.cross(up,east)
    a,e=math.radians(azimuth),math.radians(elevation)
    sun=math.cos(e)*(math.sin(a)*east+math.cos(a)*north)+math.sin(e)*up

    coarse_span=min(320000.,span+2*MARGIN_M)
    levels=[]
    fine_margin=min(span,FINE_MARGIN_M);fine_span=span+2*fine_margin
    coarse=Level(terrain_view,x,y,coarse_span)
    if fine_span<.6*coarse_span:levels.append((Level(terrain_view,x,y,fine_span),fine_margin))
    levels.append((coarse,math.inf))

    step=span/size
    columns=np.arange(size);rows=np.arange(size)
    cell_x=np.broadcast_to(x-span/2+(columns+.5)*step,(size,size)).ravel()
    cell_y=np.broadcast_to((y+span/2-(rows+.5)*step)[:,None],(size,size)).ravel()
    # Per cell: Sun azimuth/elevation from the fixed Sun vector, then the map direction of the Sun.
    radius=np.hypot(cell_x,cell_y)
    lat=np.radians(-90+np.degrees(2*np.arctan(radius/(2*RADIUS))));lon=np.arctan2(cell_x,cell_y)
    cell_up=np.stack([np.cos(lat)*np.cos(lon),np.cos(lat)*np.sin(lon),np.sin(lat)],axis=1)
    cell_east=np.stack([-np.sin(lon),np.cos(lon),np.zeros_like(lon)],axis=1)
    cell_north=np.cross(cell_up,cell_east)
    sun_up=np.clip(cell_up@sun,-1,1)
    sun_elevation=np.degrees(np.arcsin(sun_up))
    bearing=lon+np.arctan2(cell_east@sun,cell_north@sun)
    direction_x=np.sin(bearing).astype(np.float32);direction_y=np.cos(bearing).astype(np.float32)

    origin_x=cell_x.astype(np.float32);origin_y=cell_y.astype(np.float32)
    first=levels[0][0]
    origin_height,_=first.sample(origin_x,origin_y)
    horizon=np.full(origin_x.shape,-np.inf,dtype=np.float32)
    distance=float(first.spacing)
    limit=1.42*coarse_span
    while distance<=limit:
        level=next(item for item,reach in levels if distance<=reach)
        height,inside=level.sample(origin_x+direction_x*distance,origin_y+direction_y*distance)
        tangent=(height-origin_height-np.float32(distance*distance/(2*RADIUS)))/np.float32(distance)
        np.fmax(horizon,tangent,out=horizon)
        if level is coarse and not inside.any():break
        distance+=max(float(level.spacing),STEP_FRACTION*distance)

    # Cells whose rays met no terrain at all keep the flat local horizontal.
    horizon=np.where(np.isfinite(horizon),horizon,0)
    horizon_deg=np.degrees(np.arctan(horizon.astype(np.float64)))
    u=np.clip((sun_elevation-horizon_deg)/sun_radius,-1,1)
    fraction=.5+(u*np.sqrt(np.maximum(0,1-u*u))+np.arcsin(u))/math.pi
    codes=np.clip(np.floor(fraction*LIT_SCALE+.5),1,LIT_SCALE-1)
    codes=np.where(u<=-1,0,np.where(u>=1,LIT_SCALE,codes)).astype(np.uint8)
    codes[~np.isfinite(origin_height)]=NO_DATA
    products=[]
    for item,_ in levels:
        if item.product not in products:products.append(item.product)
    return codes.tobytes(),dict(azimuth=azimuth,elevation=elevation,product=','.join(products))


def shadow_mask(terrain_view,live,values):
    """Mask bytes and header values for one validated query mapping; small in-memory LRU."""
    x,y,span,size,moment=validate(values)
    key=(x,y,span,size,moment)
    with _cache_lock:
        if key in _cache:
            _cache.move_to_end(key);return _cache[key]
    result=compute(terrain_view,live,x,y,span,size,moment)
    with _cache_lock:
        _cache[key]=result
        while len(_cache)>CACHE_ENTRIES:_cache.popitem(last=False)
    return result
