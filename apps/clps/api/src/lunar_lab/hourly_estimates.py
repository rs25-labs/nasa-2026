"""Compact hourly numerical estimates; no certificates or proof-based states."""
import argparse
import base64
import csv
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import time

import numpy as np

from .ephemeris import kernel_session, positions
from .horizon import local_basis, radial_vector
from .site_catalog import load_catalog
from .terrain import PolarTerrain

MODEL='lml-sampled-horizon-estimate-v1'
REPO=Path(__file__).resolve().parents[5]
MAX_BYTES=5_000_000


def utc(text):
    value=datetime.fromisoformat(text.replace('Z','+00:00'))
    if value.tzinfo is None:raise ValueError('UTC offset required')
    value=value.astimezone(timezone.utc)
    if value.minute or value.second or value.microsecond:raise ValueError('Whole hours required')
    return value


def stamp(value):return value.isoformat(timespec='seconds').replace('+00:00','Z')


def canonical(value):return json.dumps(value,separators=(',',':'),sort_keys=True,allow_nan=False).encode()


def write(path,value):
    content=canonical(value)
    if len(content)>MAX_BYTES:raise ValueError('Compact JSON exceeds 5 MB')
    temp=path.with_suffix('.tmp')
    try:
        temp.write_bytes(content);temp.replace(path)
    finally:temp.unlink(missing_ok=True)


def pack_fractions(values):
    values=np.asarray(values,dtype=float)
    if not np.all(np.isfinite(values)) or np.any((values<0)|(values>1)):
        raise ValueError('Invalid estimated fraction; no missing-value substitution')
    # Keep exact model endpoints distinct from rounded interior fractions.
    codes=np.clip(np.floor(values*255+.5),1,254).astype(np.uint8)
    codes[values==0]=0;codes[values==1]=255
    return codes.tobytes()


def unpack_payload(record):
    raw=base64.b64decode(record['sun_earth_u8_base64'],validate=True)
    if len(raw)!=record['samples']*2:raise ValueError('Hourly array length differs')
    return raw


def sampled_horizon(terrain,site):
    """Vectorized 180 bearings × 256 radial samples, once per site.

    Uses available local raster points, not completeness/clearance certificates.
    Coverage counts describe the approximation; absent rays fail explicitly.
    """
    az=np.deg2rad(np.arange(0.,360.,2.))[:,None]
    distances=np.geomspace(max(20.,terrain.scale),150000.,256)
    delta=distances[None,:]/terrain.radius
    east,north,up=local_basis(site['latitude_deg'],site['longitude_deg'])
    direction=(up[None,None,:]*np.cos(delta)[:,:,None]+
               (north[None,None,:]*np.cos(az)[:,:,None]+
                east[None,None,:]*np.sin(az)[:,:,None])*np.sin(delta)[:,:,None])
    lat=np.rad2deg(np.arctan2(direction[:,:,2],np.hypot(direction[:,:,0],direction[:,:,1])))
    lon=np.rad2deg(np.arctan2(direction[:,:,1],direction[:,:,0]))
    x,y=terrain.forward.transform(lon,lat)
    rows=np.floor(terrain.row_offset-y/terrain.scale+.5).astype(int)
    cols=np.floor(terrain.col_offset+x/terrain.scale+.5).astype(int)
    valid=((lat>=terrain.min_lat)&(lat<=terrain.max_lat)&
           (rows>=0)&(rows<terrain.rows)&(cols>=0)&(cols<terrain.cols))
    dn=terrain.raw[np.clip(rows,0,terrain.rows-1),np.clip(cols,0,terrain.cols-1)]
    valid &= terrain.valid_dn(dn)
    counts=valid.sum(axis=1)
    if np.any(counts==0):raise ValueError('No usable terrain samples along one or more horizon rays')
    radius=terrain.radius+dn.astype(float)*terrain.factor
    vectors=direction*radius[:,:,None]-radial_vector(site['latitude_deg'],site['longitude_deg'],site['observer_radius_m'])
    elev=np.rad2deg(np.arctan2(vectors@up,np.hypot(vectors@east,vectors@north)))
    maxima=np.max(np.where(valid,elev,-np.inf),axis=1)
    if not np.all(np.isfinite(maxima)):raise ValueError('Invalid sampled horizon')
    return dict(elevation_deg=maxima.tolist(),valid_radial_samples=counts.tolist(),
                azimuth_step_deg=2,radial_samples=256,max_distance_m=150000,
                coverage='Available local raster samples only; gaps/between-ray/far terrain omitted, no completeness claim')


def estimate_rows(rows,horizon):
    if len(rows)%2:raise ValueError('Unpaired geometry rows')
    for sun,earth in zip(rows[::2],rows[1::2]):
        if sun['body']!='SUN' or earth['body']!='EARTH' or sun['utc']!=earth['utc']:
            raise ValueError('Geometry is not paired Sun/Earth')
    az=np.asarray([r['azimuth_deg'] for r in rows],dtype=float)
    center=np.asarray([r['center_elevation_deg'] for r in rows],dtype=float)
    radius=np.asarray([r['angular_radius_deg'] for r in rows],dtype=float)
    ring=np.asarray(horizon['elevation_deg'],dtype=float)
    if ring.shape!=(180,) or not np.all(np.isfinite(ring)):raise ValueError('Invalid horizon ring')
    if not np.all(np.isfinite(az)) or not np.all(np.isfinite(center)) or not np.all(np.isfinite(radius)) or np.any(radius<=0):
        raise ValueError('Invalid ephemeris geometry')
    edge=np.interp(az%360,np.arange(0.,362.,2.),np.r_[ring,ring[0]])
    u=np.clip((center-edge)/radius,-1,1)
    fractions=.5+(u*np.sqrt(np.maximum(0,1-u*u))+np.arcsin(u))/math.pi
    fractions[u<=-1]=0;fractions[u>=1]=1
    return pack_fractions(fractions)


def export_csv(folder,site_id,destination,start=None,end=None):
    manifest=json.loads((folder/'manifest.json').read_text())
    entry=next((s for s in manifest['sites'] if s['site_id']==site_id),None)
    if entry is None:raise ValueError('Site not in collection')
    record=json.loads((folder/(site_id+'.json')).read_text())
    if record['identity']!=manifest['identity']:raise ValueError('Different collection identity')
    raw=unpack_payload(record);first=utc(manifest['start_utc'])
    with destination.open('w',newline='') as stream:
        writer=csv.writer(stream)
        writer.writerow(['site_id','utc','sun_visible_fraction_estimate','earth_visible_fraction_estimate','method'])
        for i in range(record['samples']):
            moment=first+timedelta(hours=i)
            if start is not None and moment<start:continue
            if end is not None and moment>=end:continue
            writer.writerow([site_id,stamp(moment),raw[2*i]/255,raw[2*i+1]/255,MODEL])


def collect(args):
    start,end=utc(args.start),utc(args.end)
    spec_path=REPO/'data/manifests/clps/foundation-sources.json'
    spec=json.loads(spec_path.read_text())
    if not utc(spec['dates']['start_inclusive'])<=start<end<=utc(spec['dates']['end_exclusive']):
        raise ValueError('Requested dates outside available source coverage')
    hours=int((end-start).total_seconds()/3600)
    sites=load_catalog(REPO/'data/manifests/clps/landing-candidates.csv')
    if args.sites:
        wanted=args.sites.split(',')
        if len(set(wanted))!=len(wanted) or set(wanted)-{s['site_id'] for s in sites}:raise ValueError('Unknown/duplicate site')
        sites=[s for s in sites if s['site_id'] in wanted]
    payload_bytes=2*hours*len(sites)
    if args.plan:
        print(json.dumps(dict(sites=len(sites),hours_per_site=hours,decoded_bytes=payload_bytes,
                              base64_bytes=4*((2*hours+2)//3)*len(sites),proofs=False)));return
    # Reuse local assets without acquisition, receipt writes, or large proof validation.
    paths={a['id']:args.assets_root/'assets'/a['filename'] for a in spec['assets']}
    for path in paths.values():
        if not path.is_file():raise FileNotFoundError(path)
    receipts=json.loads((args.assets_root/'asset-receipts.json').read_text())
    identity_data=dict(model=MODEL,start=stamp(start),end=stamp(end),sites=sites,
                       sources={k:receipts[k]['sha256'] for k in paths},
                       code={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in
                             [Path(__file__),Path(__file__).with_name('ephemeris.py'),Path(__file__).with_name('terrain.py'),Path(__file__).with_name('horizon.py'),Path(__file__).with_name('site_catalog.py')]})
    identity=hashlib.sha256(canonical(identity_data)).hexdigest()
    folder=args.output/identity[:16];folder.mkdir(parents=True,exist_ok=True)
    print(f'Collection: {folder}',flush=True)
    lock=folder/'.collection.lock'
    with lock.open('x') as stream:stream.write('Single compact collector; do not run a second writer')
    try:
        manifest=dict(schema_version=1,model=MODEL,identity=identity,start_utc=stamp(start),end_exclusive=stamp(end),
                      cadence_hours=1,hours_per_site=hours,observer_height_m=2,complete=False,
                      encoding='base64 interleaved uint8 SUN,EARTH; fraction=code/255; timestamps=start+i hours',
                      quantization='Exact model 0/1 retained; interior rounded to codes 1..254. Encoding resolution is not physical accuracy.',
                      assumptions='Sampled local horizon; periodic linear azimuth interpolation; uniform disk behind a horizontal straight edge. Numerical estimates, not certified bounds. Earth disk is not a radio link.',
                      sites=[dict(site_id=s['site_id'],latitude_deg=s['latitude_deg'],longitude_deg=s['longitude_deg'],kind=s['kind']) for s in sites],
                      provenance=identity_data,completed_sites=[])
        write(folder/'manifest.json',manifest)
        terrain=PolarTerrain(paths['terrain_label'],paths['terrain_image'])
        with kernel_session(paths):
            for candidate in sites:
                site_id=candidate['site_id'];path=folder/(site_id+'.json');began=time.perf_counter()
                if path.exists():
                    record=json.loads(path.read_text())
                    if record['identity']!=identity or record['site_id']!=site_id:raise ValueError('Site identity mismatch')
                    raw=bytearray(unpack_payload(record))
                    if record['samples']>hours:raise ValueError('Site extends beyond requested interval')
                else:
                    site=dict(id=site_id,**terrain.sample(candidate['latitude_deg'],candidate['longitude_deg'],2))
                    record=dict(schema_version=1,identity=identity,site_id=site_id,site=site,
                                horizon=sampled_horizon(terrain,site),samples=0,sun_earth_u8_base64='',elapsed_seconds=0)
                    raw=bytearray()
                while record['samples']<hours:
                    offset=record['samples'];count=min(24*30,hours-offset)
                    timestamps=[stamp(start+timedelta(hours=i)) for i in range(offset,offset+count)]
                    raw.extend(estimate_rows(positions(record['site'],timestamps),record['horizon']))
                    record.update(samples=offset+count,sun_earth_u8_base64=base64.b64encode(raw).decode())
                    record['elapsed_seconds']+=time.perf_counter()-began;began=time.perf_counter()
                    write(path,record)
                    print(f'{site_id}: {record["samples"]}/{hours} hourly pairs; {len(raw)} bytes; {record["elapsed_seconds"]:.1f}s',flush=True)
                manifest['completed_sites'].append(site_id);write(folder/'manifest.json',manifest)
        size=sum(p.stat().st_size for p in folder.glob('*.json'))
        if size>MAX_BYTES:raise ValueError(f'Dataset exceeds 5 MB: {size}')
        manifest.update(complete=True)
        final_size=size-(folder/'manifest.json').stat().st_size+len(canonical(manifest))
        if final_size>MAX_BYTES:raise ValueError(f'Dataset exceeds 5 MB: {final_size}')
        write(folder/'manifest.json',manifest)
        print(json.dumps(dict(folder=str(folder),complete=True,bytes=sum(p.stat().st_size for p in folder.glob('*.json')))),flush=True)
    finally:lock.unlink(missing_ok=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    sub=parser.add_subparsers(dest='command',required=True)
    run=sub.add_parser('collect')
    run.add_argument('--start',default='2026-01-01T00:00:00Z');run.add_argument('--end',default='2029-01-01T00:00:00Z')
    run.add_argument('--sites');run.add_argument('--plan',action='store_true')
    run.add_argument('--assets-root',type=Path,default=REPO/'data/local/lml')
    run.add_argument('--output',type=Path,default=REPO/'data/local/lml/hourly-estimates')
    export=sub.add_parser('export-csv')
    export.add_argument('folder',type=Path);export.add_argument('--site',required=True)
    export.add_argument('--output',type=Path,required=True)
    export.add_argument('--start');export.add_argument('--end')
    args=parser.parse_args()
    if args.command=='collect':collect(args)
    else:export_csv(args.folder,args.site,args.output,utc(args.start) if args.start else None,utc(args.end) if args.end else None)


if __name__=='__main__':main()
