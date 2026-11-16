"""Read compact hourly coverage for calendars, mission results and exports."""
import base64
import calendar
import csv
from datetime import datetime,timedelta,timezone
from functools import lru_cache
import hashlib
import io
import json
from pathlib import Path
import re
import threading

import numpy as np

from .environment import compress_intervals
from .ephemeris import kernel_session,positions
from .site_catalog import load_catalog

MODEL='lml-sampled-horizon-estimate-v1'
GEOMETRY_LOCK=threading.Lock()


def utc(text):
    value=datetime.fromisoformat(text.replace('Z','+00:00'))
    if value.tzinfo is None:raise ValueError('UTC offset required')
    return value.astimezone(timezone.utc)
def stamp(value):return value.isoformat(timespec='seconds').replace('+00:00','Z')
def enabled(repo):return (Path(repo)/'data/manifests/clps/hourly-ui.json').is_file()


@lru_cache(maxsize=64)
def _record(path,mtime,size):
    if size>100000:raise ValueError('Hourly site file is too large')
    record=json.loads(Path(path).read_text())
    raw=base64.b64decode(record['sun_earth_u8_base64'],validate=True)
    if record['samples']!=26304 or len(raw)!=2*record['samples']:raise ValueError('Hourly site coverage is incomplete')
    values=np.frombuffer(raw,dtype=np.uint8).reshape((-1,2))
    return record,values


def segment_measures(segment,start,end):
    """Summaries for one run of hourly cells: rows of Sun and Earth codes 0..255."""
    hours=len(segment)
    joint=int(np.count_nonzero(np.all(segment>0,axis=1)))
    rows=[]
    for channel,body in enumerate(('SUN','EARTH')):
        series=segment[:,channel]
        transitions=np.diff(np.r_[0,(series==0).astype(np.int8),0])
        lengths=np.flatnonzero(transitions==-1)-np.flatnonzero(transitions==1)
        longest=int(max(lengths,default=0));mean=float(np.mean(series)/255)
        full=int(np.count_nonzero(series==255));blocked=int(np.count_nonzero(series==0))
        rows.append(dict(body=body,start_utc=stamp(start),end_utc=stamp(end),period_complete=True,
                         mean_visible_fraction=mean,mean_visible_fraction_lower=mean,mean_visible_fraction_upper=mean,
                         unknown_hours=0,longest_blocked_hours=longest,longest_basis='hourly samples',
                         total_hours=hours,full_hours=full,blocked_hours=blocked,partial_hours=hours-full-blocked,
                         simultaneous_positive_visibility_hours_lower=joint,simultaneous_positive_visibility_hours_upper=joint,
                         metric_kind='hourly'))
    return rows


class HourlyArchive:
    def __init__(self,root,repo):
        self.root=Path(root);self.repo=Path(repo)
        self.config=json.loads((self.repo/'data/manifests/clps/hourly-ui.json').read_text())
        if self.config['schema_version']!=1 or not re.fullmatch('[a-f0-9]{16}',self.config['folder']):raise ValueError('Invalid hourly publication')
        self.folder=self.root/'hourly-estimates'/self.config['folder']
        content=(self.folder/'manifest.json').read_bytes()
        if hashlib.sha256(content).hexdigest()!=self.config['manifest_sha256']:raise ValueError('Hourly publication changed')
        self.manifest=json.loads(content);m=self.manifest
        self.sites=load_catalog(self.repo/'data/manifests/clps/landing-candidates.csv')
        if (not m['complete'] or m['identity']!=self.config['identity'] or m['model']!=MODEL
                or m['hours_per_site']!=26304 or m['cadence_hours']!=1 or m['observer_height_m']!=2
                or m['start_utc']!='2026-01-01T00:00:00Z' or m['end_exclusive']!='2029-01-01T00:00:00Z'
                or len(m['completed_sites'])!=50 or set(m['completed_sites'])!={s['site_id'] for s in self.sites}):
            raise ValueError('Hourly publication is incomplete')
        published={s['site_id']:s for s in m['sites']}
        if len(published)!=50 or any(published[s['site_id']][k]!=s[k] for s in self.sites for k in ('latitude_deg','longitude_deg')):
            raise ValueError('Hourly catalog coordinates differ')
        self.start=utc(m['start_utc']);self.end=utc(m['end_exclusive'])

    def site(self,site_id):
        candidate=next((s for s in self.sites if s['site_id']==site_id),None)
        if candidate is None:raise ValueError('Choose a catalog site')
        path=self.folder/(site_id+'.json');stat=path.stat()
        record,values=_record(str(path),stat.st_mtime_ns,stat.st_size)
        if record['identity']!=self.manifest['identity'] or record['site_id']!=site_id:
            raise ValueError('Hourly site identity differs')
        if any(record['site'][k]!=candidate[k] for k in ('latitude_deg',)) or record['site']['longitude_deg']%360!=candidate['longitude_deg']%360:
            raise ValueError('Hourly site coordinates differ')
        return candidate,record,values

    def offsets(self,start,end):
        if not self.start<=start<end<=self.end:raise ValueError('Choose dates within 2026–2028')
        a,b=((value-self.start).total_seconds()/3600 for value in (start,end))
        if not a.is_integer() or not b.is_integer():raise ValueError('Choose a start on the hour')
        return int(a),int(b)

    def measures(self,values,start,end):
        a,b=self.offsets(start,end)
        return segment_measures(values[a:b],start,end)

    def planning(self,site_id,year):
        _,_,values=self.site(site_id)
        year=int(year)
        if year not in (2026,2027,2028):raise ValueError('Choose 2026, 2027 or 2028')
        seasonal=[];windows=[]
        first=datetime(year,1,1,tzinfo=timezone.utc);last=datetime(year+1,1,1,tzinfo=timezone.utc)
        for month in range(1,13):
            start=datetime(year,month,1,tzinfo=timezone.utc)
            end=start+timedelta(days=calendar.monthrange(year,month)[1])
            seasonal.extend(dict(row,scope='month') for row in self.measures(values,start,end))
        seasonal.extend(dict(row,scope='year') for row in self.measures(values,first,last))
        cursor=first
        while cursor<last:
            for days in (1,7,14,30):
                end=cursor+timedelta(days=days)
                if end<=self.end:windows.extend(dict(row,mission_days=days) for row in self.measures(values,cursor,end))
            cursor+=timedelta(days=1)
        return dict(available=True,site_id=site_id,year=year,kind='hourly',label=self.config['label'],
                    collection_id=self.manifest['identity'],start_utc=stamp(self.start),end_utc=stamp(self.end),
                    observer_height_m=2,step_hours=1,seasonal=seasonal,windows=windows,notice='')

    def catalog(self):
        sites=[]
        for candidate in self.sites:
            site=dict(candidate);_,record,values=self.site(site['site_id'])
            label=site['source_site_id'] or 'exploratory '+{'xp':'A','xm':'B','yp':'C'}.get(site['site_id'].rsplit('-',1)[-1],site['site_id'])
            conditions=[]
            for row in self.measures(values,self.start,self.end):
                conditions.append(dict(row,explanation=f"{row['mean_visible_fraction']*100:.1f}% average visibility across 2026–2028.",
                                       longest_obstruction_basis=f"{row['longest_blocked_hours']} h in hourly coverage"))
            site.update(name=f"{site['region']} · {label}",data_status='ready',data_label='Hourly coverage · 2026–2028',
                        terrain=dict(elevation_m=record['site']['elevation_above_reference_sphere_m'],diagnostic_slope_deg=None,
                                     local_relief_m=None,terrain_pixel_m=40,context='Terrain at the selected site',frame='MOON_ME_DE421'),
                        preview=dict(kind='hourly',label=self.config['label'],start_utc=stamp(self.start),end_utc=stamp(self.end),
                                     step_hours=1,observer_height_m=2,conditions=conditions))
            sites.append(site)
        return dict(sites=sites,ready_count=50,preview_available=True,published_collection=self.manifest['identity'],
                    kind='hourly',notice='50 sites · hourly sunlight and Earth visibility · 2026–2028')

    def slip(self,start,days,span):
        """Every site's conditions if the same stay starts 0..span days later."""
        if not 1<=days<=30:raise ValueError('Choose 1–30 days')
        if not 0<=span<=90:raise ValueError('Choose a delay range of 0–90 days')
        self.offsets(start,start+timedelta(days=days))
        sites=[]
        for candidate in self.sites:
            _,_,values=self.site(candidate['site_id'])
            cells=[]
            for delay in range(span+1):
                begin=start+timedelta(days=delay);end=begin+timedelta(days=days)
                if end>self.end:cells.append(None);continue
                sun,earth=self.measures(values,begin,end)
                cells.append(dict(sun=round(sun['mean_visible_fraction'],4),earth=round(earth['mean_visible_fraction'],4),
                                  joint_hours=sun['simultaneous_positive_visibility_hours_lower'],
                                  darkness_hours=sun['longest_blocked_hours']))
            sites.append(dict(site_id=candidate['site_id'],cells=cells))
        return dict(start_utc=stamp(start),days=days,span_days=span,stay_hours=days*24,sites=sites)

    def mission_key(self,site_id,start,days):
        end=start+timedelta(days=days);offset,_=self.offsets(start,end)
        if not 1<=days<=30:raise ValueError('Choose 1–30 days')
        index=next((i for i,s in enumerate(self.sites) if s['site_id']==site_id),None)
        if index is None:raise ValueError('Choose a catalog site')
        return f"{self.manifest['identity'][:54]}{index:02x}{offset:06x}{days:02x}"

    def result(self,key):
        if not re.fullmatch('[a-f0-9]{64}',key) or key[:54]!=self.manifest['identity'][:54]:return None
        index=int(key[54:56],16);offset=int(key[56:62],16);days=int(key[62:],16)
        if index>=len(self.sites):raise ValueError('Invalid hourly site key')
        start=self.start+timedelta(hours=offset);end=start+timedelta(days=days)
        site_id=self.sites[index]['site_id']
        if self.mission_key(site_id,start,days)!=key:raise ValueError('Invalid hourly mission key')
        candidate,record,values=self.site(site_id);a,b=self.offsets(start,end)
        times=[stamp(start+timedelta(hours=i)) for i in range(b-a+1)]
        spec=json.loads((self.repo/'data/manifests/clps/foundation-sources.json').read_text())
        paths={asset['id']:self.root/'assets'/asset['filename'] for asset in spec['assets']}
        # SPICE owns process-global state; isolate concurrent HTTP requests.
        # Imported here because live_estimates imports this module.
        from .live_estimates import find_events
        ring=record['horizon']['elevation_deg'];closed_ring=np.r_[ring,ring[0]]
        def edge_at(azimuth):return float(np.interp(azimuth%360,np.arange(0.,362.,2.),closed_ring))
        with GEOMETRY_LOCK:
            with kernel_session(paths):
                geometry=positions(record['site'],times)
                events=find_events(record['site'],geometry,edge_at,'NONE')
        samples=[]
        for row in geometry:
            i=int((utc(row['utc'])-self.start).total_seconds()/3600);channel=0 if row['body']=='SUN' else 1
            # The archive has hourly cells, not a Jan 2029 boundary sample.
            # Its final value closes the last held hour with zero extra duration.
            code=int(values[min(i,len(values)-1),channel]);fraction=code/255
            edge=float(np.interp(row['azimuth_deg']%360,np.arange(0.,362.,2.),np.r_[record['horizon']['elevation_deg'],record['horizon']['elevation_deg'][0]]))
            samples.append(dict(row,state='FULL' if code==255 else 'BLOCKED' if code==0 else 'PARTIAL',
                                visible_fraction=fraction,visible_fraction_lower=fraction,visible_fraction_upper=fraction,
                                horizon_elevation_deg=edge,visibility_model_id=MODEL,metric_kind='hourly',
                                boundary_basis='last hourly value held to terminal boundary' if i==len(values) else 'hourly archive'))
        summaries=self.measures(values,start,end)
        return dict(kind='hourly',cache_key=key,run_id=f'hourly-{site_id}-{start:%Y%m%dT%H%M%S}-{days}d',
                    request=dict(site_id=site_id,latitude_deg=candidate['latitude_deg'],longitude_deg=candidate['longitude_deg'],
                                 observer_height_m=2,start_utc=stamp(start),end_utc=stamp(end),days=days,step_hours=1,
                                 sample_count_per_body=b-a+1),
                    summaries=summaries,samples=samples,events=events,intervals=compress_intervals(samples,site_id,'SUN')+compress_intervals(samples,site_id,'EARTH'),
                    horizon=[dict(azimuth_deg=i*2,horizon_elevation_deg=v,status='SAMPLED') for i,v in enumerate(record['horizon']['elevation_deg'])],
                    created_utc=stamp(self.start),calculation_seconds=0,collection_id=self.manifest['identity'],
                    methods='Hourly sampled local horizon and disk visibility. Source methods and encoding are recorded in the archive manifest.')


def export_result(result,name):
    if name=='environment-report.json':return json.dumps(result,allow_nan=False).encode(),'application/json'
    field={'environment-timeseries.csv':'samples','environment-intervals.csv':'intervals','environment-summaries.csv':'summaries'}[name]
    rows=result[field];stream=io.StringIO(newline='');writer=csv.DictWriter(stream,fieldnames=list(rows[0]))
    writer.writeheader();writer.writerows(rows)
    return stream.getvalue().encode(),'text/csv; charset=utf-8'
