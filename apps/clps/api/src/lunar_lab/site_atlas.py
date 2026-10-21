"""Read-only publication of catalog metadata and explicitly pinned previews."""
import csv
import hashlib
import json
import math
from pathlib import Path
import re

from .site_catalog import load_catalog
from .site_archive import key


def _read(path,expected=None):
    content=Path(path).read_bytes()
    if expected is not None and hashlib.sha256(content).hexdigest()!=expected:raise ValueError('Published preview checksum differs')
    return content


def sites_response(root,repo):
    seeds=Path(repo)/'data/manifests/clps/landing-candidates.csv'
    sites=load_catalog(seeds)
    for site in sites:
        label=site['source_site_id'] or 'exploratory '+{'xp':'A','xm':'B','yp':'C'}.get(site['site_id'].rsplit('-',1)[-1],site['site_id'])
        site.update(data_status='collecting',terrain=None,preview=None,
            name=f"{site['region']} · {label}")
    response=dict(sites=sites,notice='Full seasonal collection is in progress. Pilot previews describe only their stated dates.',
                  published_collection=None,ready_count=0)
    try:
        publication=json.loads(_read(Path(repo)/'data/manifests/clps/site-atlas-ui.json'))
        if publication['schema_version']!=1 or not re.fullmatch('[a-f0-9]{64}',publication['collection_id']):
            raise ValueError('Unsupported preview publication')
        base=Path(root)/'site-atlas';folder=base/publication['collection_id']
        if folder.resolve().parent!=base.resolve():raise ValueError('Published collection escapes archive')
        identity=json.loads(_read(folder/'collection.json'))
        if key(identity)!=folder.name or hashlib.sha256(_read(seeds)).hexdigest()!=identity['catalog_sha256']:
            raise ValueError('Published collection/catalog identity differs')
        if any(float(r['observer_height_m'])!=publication['observer_height_m'] or float(r['step_hours'])!=publication['step_hours'] for r in identity['requests']):
            raise ValueError('Preview sampling settings differ from publication')
        receipt=json.loads(_read(folder/'summary/complete.json',publication['summary_receipt_sha256']))
        if receipt['collection_id']!=folder.name:raise ValueError('Published receipt identity differs')
        terrain=list(csv.DictReader(_read(folder/'sites.csv',receipt['site_catalog_sha256']).decode().splitlines()))
        profiles=json.loads(_read(folder/'summary/site-profiles.json',receipt['site_profiles_sha256']))
        if len(terrain)!=50 or len(profiles)!=receipt['sites']:raise ValueError('Incomplete published catalog/profiles')
        canonical={s['site_id']:s for s in sites};by_id={s['site_id']:s for s in terrain}
        if len(by_id)!=50 or set(by_id)!=set(canonical):raise ValueError('Published terrain IDs differ')
        prepared={}
        for site_id,row in by_id.items():
            site=canonical[site_id]
            if any(float(row[k])!=site[k] for k in ('latitude_deg','longitude_deg')):raise ValueError('Published coordinates differ')
            values={}
            for field in ('elevation_m','diagnostic_slope_deg','local_relief_m','terrain_pixel_m'):
                value=None if row[field]=='' else float(row[field])
                if value is not None and not math.isfinite(value):raise ValueError('Invalid terrain metadata')
                values[field]=value
            prepared[site_id]=dict(values,context=row['terrain_context'],frame=row['terrain_frame'],sha256=row['terrain_sha256'])
        previews={}
        for profile in profiles:
            site_id=profile['site_id']
            if site_id not in canonical or site_id in previews:raise ValueError('Unknown/duplicate preview site')
            if any(float(profile[k])!=canonical[site_id][k] for k in ('latitude_deg','longitude_deg')):raise ValueError('Preview coordinates differ')
            conditions=profile['calculated_conditions']
            if len(conditions)!=2 or {c['body'] for c in conditions}!={'SUN','EARTH'}:raise ValueError('Incomplete preview bodies')
            if any(c['start_utc']!=publication['start_utc'] or c['end_utc']!=publication['end_utc'] for c in conditions):
                raise ValueError('Preview dates differ from publication')
            previews[site_id]=dict(label=publication['label'],start_utc=publication['start_utc'],end_utc=publication['end_utc'],
                observer_height_m=publication['observer_height_m'],step_hours=publication['step_hours'],
                conditions=conditions,collection_id=folder.name)
        # Merge only after the complete lightweight publication validates.
        for site in sites:
            site['terrain']=prepared[site['site_id']]
            if site['site_id'] in previews:site.update(data_status='ready',preview=previews[site['site_id']])
        response.update(published_collection=folder.name,ready_count=len(previews))
    except (OSError,ValueError,KeyError,TypeError,AttributeError,UnicodeError):
        response['notice']='Verified pilot preview unavailable. Site selection still works; no calculated conditions are being substituted.'
        response['preview_available']=False
    else:response['preview_available']=True
    return response
