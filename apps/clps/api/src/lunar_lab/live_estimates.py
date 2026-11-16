"""On-demand hourly estimates for any supported polar site, height and date.

Same sampled-horizon method as the published hourly archive, computed per
request, with light-time and stellar-aberration correction and refined
rise/set times. Results are estimates, not certified bounds.
"""
from datetime import datetime,timedelta,timezone
import hashlib
import json
import math
from pathlib import Path
import re
import time

import numpy as np

from .environment import compress_intervals
from .ephemeris import kernel_session,positions
from .hourly_estimates import estimate_rows,sampled_horizon
from .hourly_publication import GEOMETRY_LOCK,segment_measures,stamp,utc
from .multires_horizon import MODEL as MULTIRES_MODEL,multires_horizon
from .terrain import image_parts

MODEL='lml-sampled-horizon-estimate-v2-lts'
GLOBAL_MODEL='lml-sampled-horizon-estimate-v3-global-lts'
KNOWN_MODELS=(MODEL,GLOBAL_MODEL,MULTIRES_MODEL)
CORRECTION='LT+S'
FIRST=datetime(1969,1,1,tzinfo=timezone.utc)
LAST=datetime(2036,1,1,tzinfo=timezone.utc)
EVENT_TOLERANCE_SECONDS=60
MAX_CACHED_HORIZONS=32
MAX_BATCH_SITES=8
RING_AZIMUTHS=np.arange(0.,362.,2.)


def validate(values):
    """Turn one query-string mapping into a checked request."""
    site_id=values.get('site','custom-site')
    if not re.fullmatch('[A-Za-z0-9_-]{1,48}',site_id):
        raise ValueError('Site name must have 1–48 letters, numbers, underscores or hyphens.')
    numbers={}
    for key,low,high in [('latitude',-90,90),('longitude',-180,180),('height',0,20),('days',1,30)]:
        try:number=float(values[key])
        except (KeyError,ValueError):raise ValueError(f'{key} must be a number.') from None
        if not math.isfinite(number) or not low<=number<=high:raise ValueError(f'{key} must be between {low} and {high}.')
        numbers[key]=number
    if not numbers['days'].is_integer():raise ValueError('Duration must be a whole number of days.')
    days=int(numbers['days'])
    try:start=datetime.fromisoformat(values['start'].replace('Z','+00:00'))
    except (KeyError,ValueError):raise ValueError('Start must be a valid UTC timestamp.') from None
    if start.tzinfo is None:raise ValueError('Start must include a timezone.')
    start=start.astimezone(timezone.utc)
    if start<FIRST or start+timedelta(days=days)>LAST:raise ValueError('The full stay must fit within 1969–2035.')
    return dict(site_id=site_id,latitude_deg=numbers['latitude'],longitude_deg=numbers['longitude'],
                observer_height_m=numbers['height'],start_utc=stamp(start),days=days)


def validate_batch(data):
    """Turn one JSON body into a checked request per site, sharing the single-site rules."""
    if not isinstance(data,dict) or set(data)!={'start','days','observer_height_m','sites'}:
        raise ValueError('Provide start, days, observer_height_m and sites only.')
    sites=data['sites']
    if not isinstance(sites,list) or not 1<=len(sites)<=MAX_BATCH_SITES:raise ValueError(f'Provide 1–{MAX_BATCH_SITES} sites.')
    if not isinstance(data['start'],str):raise ValueError('Start must be a UTC timestamp.')
    requests=[];seen=set()
    for site in sites:
        if not isinstance(site,dict) or set(site)!={'site_id','latitude_deg','longitude_deg'}:
            raise ValueError('Each site needs site_id, latitude_deg and longitude_deg only.')
        if not isinstance(site['site_id'],str):raise ValueError('Site name must be text.')
        values=dict(site=site['site_id'],latitude=site['latitude_deg'],longitude=site['longitude_deg'],
                    height=data['observer_height_m'],days=data['days'],start=data['start'])
        for key,value in values.items():
            if key in ('latitude','longitude','height','days') and (isinstance(value,bool) or not isinstance(value,(int,float))):
                raise ValueError(f'{key} must be a number.')
        request=validate(values)
        if request['site_id'] in seen:raise ValueError(f'Site name {request["site_id"]} is used more than once.')
        seen.add(request['site_id']);requests.append(request)
    start=utc(requests[0]['start_utc'])
    if start.minute or start.second or start.microsecond:raise ValueError('Start must be on a whole hour.')
    return requests


def limb_clearance(row,edge_at):
    """Degrees by which the body's upper limb clears the sampled horizon at its bearing."""
    return row['center_elevation_deg']+row['angular_radius_deg']-edge_at(row['azimuth_deg'])


def refine_event(site,body,before,after,edge_at,correction):
    """Bisect the hour between two samples to when the upper limb meets the horizon."""
    low,high=utc(before['utc']),utc(after['utc'])
    rising=limb_clearance(after,edge_at)>0
    while (high-low).total_seconds()>EVENT_TOLERANCE_SECONDS:
        middle=low+(high-low)/2
        row=next(r for r in positions(site,[stamp(middle)],correction) if r['body']==body)
        if (limb_clearance(row,edge_at)>0)==rising:high=middle
        else:low=middle
    return high


def find_events(site,geometry,edge_at,correction):
    """Rise and set times for both bodies. Requires an open kernel session.

    correction must match the one used for geometry.
    """
    events=[]
    for offset,body in enumerate(('SUN','EARTH')):
        series=geometry[offset::2]
        for before,after in zip(series,series[1:]):
            was_up=limb_clearance(before,edge_at)>0;is_up=limb_clearance(after,edge_at)>0
            if was_up==is_up:continue
            events.append(dict(body=body,kind='rise' if is_up else 'set',
                               utc=stamp(refine_event(site,body,before,after,edge_at,correction)),
                               tolerance_seconds=EVENT_TOLERANCE_SECONDS,
                               basis='Upper limb meets the sampled horizon; bisected between hourly samples'))
    return sorted(events,key=lambda event:event['utc'])


class LiveEstimates:
    def __init__(self,root,repo,terrain_view):
        self.root=Path(root);self.repo=Path(repo);self.terrain_view=terrain_view
        self.folder=self.root/'live-estimates'
        self.horizons={}
        from .global_view import GlobalView
        self.global_view=GlobalView(root,repo)

    def plan(self,request):
        """Model id and terrain product ids a new estimate of this request uses; ids are empty unless several polar rasters exist."""
        if request['latitude_deg']>-85:return GLOBAL_MODEL,()
        ids=tuple(name for name,_ in self.terrain_view.products())
        return (MULTIRES_MODEL,ids) if len(ids)>1 else (MODEL,())

    def remember(self,request):
        """Store the request so its result can be rebuilt later, with the model and terrain it was created under."""
        model,ids=self.plan(request)
        saved=dict(model=model,request=request)
        if ids:saved['products']=list(ids)
        content=json.dumps(saved,sort_keys=True,separators=(',',':'))
        key=hashlib.sha256(content.encode()).hexdigest()
        path=self.folder/(key+'.json')
        if not path.exists():
            self.folder.mkdir(parents=True,exist_ok=True)
            path.write_text(content)
        return key

    def stored(self,key):
        if not re.fullmatch('[a-f0-9]{64}',key):return None
        path=self.folder/(key+'.json')
        if not path.is_file():return None
        saved=json.loads(path.read_text())
        return saved if saved.get('model') in KNOWN_MODELS else None

    def request_for(self,key):
        saved=self.stored(key)
        return saved['request'] if saved else None

    def site_and_horizon(self,request,model=None,product_ids=()):
        """Site and horizon for a request; a stored estimate passes the model and terrain products it was made with."""
        if model is None:model,product_ids=self.plan(request)
        if request['latitude_deg']>-85:
            view=self.global_view
            with view.lock:
                view.terrain()
                place=(request['latitude_deg'],request['longitude_deg'],request['observer_height_m'],view.hashes['global_terrain_image'])
                cached=self.horizons.get(place)
                if cached is None:
                    site=view.sample(*place[:3]);cached=(site,dict(view.horizon(site),model=GLOBAL_MODEL))
                    if len(self.horizons)>=MAX_CACHED_HORIZONS:self.horizons.clear()
                    self.horizons[place]=cached
            site,horizon=cached
            return dict(site,id=request['site_id']),horizon
        # The terrain reader and its projection are shared with the map endpoints.
        with self.terrain_view.lock:
            terrain=self.terrain_view.terrain()
            products=None
            if model==MULTIRES_MODEL:
                available=dict(self.terrain_view.products())
                missing=[name for name in product_ids if name not in available]
                if missing or len(product_ids)<2:
                    raise ValueError(f'Terrain products {", ".join(missing) or "of this estimate"} are no longer available; open the mission again.')
                products=[(name,available[name]) for name in product_ids]
                signature=tuple((name,*((p.stat().st_mtime_ns,p.stat().st_size) for p in image_parts(item.image_path))) for name,item in products)
            place=(request['latitude_deg'],request['longitude_deg'],request['observer_height_m'],
                   self.terrain_view.hashes['terrain_image'],model,signature if products else ())
            cached=self.horizons.get(place)
            if cached is None:
                site=terrain.sample(*place[:3])
                if products:
                    horizon=multires_horizon(products,site)
                    # The mast stands on the finest ground, not on the nearest 40 m pixel.
                    ground=horizon['observer_ground_height_m']
                    site=dict(site,elevation_above_reference_sphere_m=ground,surface_radius_m=terrain.radius+ground,
                              observer_radius_m=terrain.radius+ground+place[2],
                              terrain_sampling='bilinear on the finest polar product; requested direction retained')
                else:horizon=dict(sampled_horizon(terrain,site),model=MODEL)
                cached=(site,horizon)
                if len(self.horizons)>=MAX_CACHED_HORIZONS:self.horizons.clear()
                self.horizons[place]=cached
        site,horizon=cached
        return dict(site,id=request['site_id']),horizon

    def open(self,request):
        return self.result(request,self.remember(request))

    def kernel_paths(self):
        spec=json.loads((self.repo/'data/manifests/clps/foundation-sources.json').read_text())
        return {asset['id']:self.root/'assets'/asset['filename'] for asset in spec['assets']}

    def calculate(self,request,site,horizon):
        """Geometry, events, visibility codes and summaries for one site. Requires an open kernel session."""
        start=utc(request['start_utc']);hours=request['days']*24;end=start+timedelta(hours=hours)
        times=[stamp(start+timedelta(hours=i)) for i in range(hours+1)]
        ring=np.asarray(horizon['elevation_deg'],dtype=float);closed_ring=np.r_[ring,ring[0]]
        def edge_at(azimuth):return float(np.interp(azimuth%360,RING_AZIMUTHS,closed_ring))
        geometry=positions(site,times,CORRECTION)
        events=find_events(site,geometry,edge_at,CORRECTION)
        # One row per time, columns Sun then Earth, as codes 0..255.
        codes=np.frombuffer(estimate_rows(geometry,horizon),dtype=np.uint8).reshape((-1,2))
        # The last sample marks the end of the stay and adds no duration.
        return dict(start=start,end=end,hours=hours,geometry=geometry,events=events,codes=codes,edge_at=edge_at,
                    summaries=segment_measures(codes[:-1],start,end))

    def estimates(self,requests):
        """Compact results for several sites over one window; a failing site reports its own error."""
        resolved=[]
        for request in requests:
            try:resolved.append((request,)+self.site_and_horizon(request))
            except Exception as exc:resolved.append((request,None,f'Terrain could not be sampled: {exc}'))
        results=[]
        # SPICE owns process-global state; one session serves every site in the batch.
        with GEOMETRY_LOCK:
            with kernel_session(self.kernel_paths()):
                for request,site,horizon in resolved:
                    if site is None:
                        results.append(dict(site_id=request['site_id'],ok=False,error=horizon));continue
                    try:results.append(self.compact(request,site,horizon,self.calculate(request,site,horizon)))
                    except Exception as exc:results.append(dict(site_id=request['site_id'],ok=False,error=f'Estimate failed: {exc}'))
        first=next(request for request,_,_ in resolved)
        start=utc(first['start_utc']);hours=first['days']*24
        return dict(start_utc=stamp(start),end_utc=stamp(start+timedelta(hours=hours)),days=first['days'],step_hours=1,samples=hours+1,results=results)

    def compact(self,request,site,horizon,calc):
        geometry,codes=calc['geometry'],calc['codes']
        series={}
        for offset,name in enumerate(('sun','earth')):
            rows=geometry[offset::2]
            series[name]=dict(fraction=[int(code)/255 for code in codes[:,offset]],
                              azimuth_deg=[round(row['azimuth_deg'],4) for row in rows],
                              elevation_deg=[round(row['center_elevation_deg'],4) for row in rows],
                              angular_radius_deg=[round(row['angular_radius_deg'],4) for row in rows])
        model=horizon['model']
        return dict(site_id=request['site_id'],ok=True,
                    request=dict(site_id=request['site_id'],latitude_deg=request['latitude_deg'],longitude_deg=request['longitude_deg'],
                                 observer_height_m=request['observer_height_m']),
                    model=model,terrain=self.terrain_resolution(model,horizon),terrain_products=horizon.get('bands'),summaries=calc['summaries'],events=calc['events'],
                    horizon_elevation_deg=[round(float(value),4) for value in horizon['elevation_deg']],series=series)

    def model_for(self,request):
        return self.plan(request)[0]

    def terrain_resolution(self,model,horizon=None):
        if model==GLOBAL_MODEL:return 'coarse global, 16 pixels/degree (~1.9 km)'
        if model==MULTIRES_MODEL:
            names=['near field','mid field'] if len(horizon['bands'])>2 else ['near field']
            parts=[f'{band["pixel_size_m"]:g} m {names[index] if index<len(names) else ""}'.strip() for index,band in enumerate(horizon['bands'][:-1])]
            return 'LOLA '+', '.join(parts+[f'{horizon["bands"][-1]["pixel_size_m"]:g} m beyond'])
        return '40 m south-polar terrain'

    def result(self,request,key):
        began=time.perf_counter()
        saved=self.stored(key)
        site,horizon=self.site_and_horizon(request,saved['model'],tuple(saved.get('products',()))) if saved else self.site_and_horizon(request)
        model=horizon['model']
        # SPICE owns process-global state; isolate concurrent HTTP requests.
        with GEOMETRY_LOCK:
            with kernel_session(self.kernel_paths()):
                calc=self.calculate(request,site,horizon)
        start,end,hours,geometry,codes,edge_at=(calc[name] for name in ('start','end','hours','geometry','codes','edge_at'))
        events,summaries=calc['events'],calc['summaries']
        samples=[]
        for index,row in enumerate(geometry):
            code=int(codes[index//2,index%2]);fraction=code/255
            samples.append(dict(row,state='FULL' if code==255 else 'BLOCKED' if code==0 else 'PARTIAL',
                                visible_fraction=fraction,visible_fraction_lower=fraction,visible_fraction_upper=fraction,
                                horizon_elevation_deg=edge_at(row['azimuth_deg']),visibility_model_id=model,
                                metric_kind='hourly',boundary_basis='on-demand hourly estimate'))
        site_id=request['site_id']
        return dict(kind='hourly',source='on-demand',cache_key=key,
                    run_id=f'live-{site_id}-{start:%Y%m%dT%H%M%S}-{request["days"]}d',
                    request=dict(site_id=site_id,latitude_deg=request['latitude_deg'],longitude_deg=request['longitude_deg'],
                                 observer_height_m=request['observer_height_m'],start_utc=stamp(start),end_utc=stamp(end),
                                 days=request['days'],step_hours=1,sample_count_per_body=hours+1),
                    summaries=summaries,samples=samples,events=events,
                    intervals=compress_intervals(samples,site_id,'SUN')+compress_intervals(samples,site_id,'EARTH'),
                    horizon=[dict(azimuth_deg=i*2,horizon_elevation_deg=value,status='SAMPLED') for i,value in enumerate(horizon['elevation_deg'])],
                    created_utc=stamp(datetime.now(timezone.utc)),calculation_seconds=time.perf_counter()-began,
                    model=model,aberration_correction=CORRECTION,
                    terrain_resolution=self.terrain_resolution(model,horizon),terrain_products=horizon.get('bands'),
                    methods=f'{horizon["coverage"]} Hourly sampled horizon and disk visibility with light-time and stellar-aberration correction. Rise/set times refined to about one minute; short events between samples can be missed. Numerical estimates, not certified bounds. Earth disk is not a radio link.')
