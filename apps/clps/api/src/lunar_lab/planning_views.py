"""Compact, read-only planning views derived from published summary CSVs."""
import csv
from datetime import datetime,timedelta,timezone
import hashlib
import json
import math
from pathlib import Path
import re

from .assets import write_json
from .site_archive import key
from .site_catalog import load_catalog

POLICY='lml-planning-views-v1'
NUMBERS=('mean_visible_fraction_lower','mean_visible_fraction_upper','unknown_hours',
         'longest_blocked_hours','total_hours','simultaneous_positive_visibility_hours_lower',
         'simultaneous_positive_visibility_hours_upper')


def utc(value):
    stamp=datetime.fromisoformat(value)
    if stamp.tzinfo is None:raise ValueError('Planning dates must include a timezone')
    return stamp.astimezone(timezone.utc)


def sha(path):
    digest=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def publication(root,repo):
    config=json.loads((Path(repo)/'data/manifests/clps/site-atlas-ui.json').read_text())
    if config['schema_version']!=1 or not re.fullmatch('[a-f0-9]{64}',config['collection_id']):raise ValueError('Invalid publication ID')
    if config['observer_height_m']!=2 or config['step_hours']!=1:raise ValueError('Planning requires 2 m hourly publication')
    base=Path(root)/'site-atlas';folder=base/config['collection_id']
    if folder.resolve().parent!=base.resolve():raise ValueError('Publication escapes archive')
    path=folder/'summary/complete.json'
    if sha(path)!=config['summary_receipt_sha256']:raise ValueError('Published summary receipt differs')
    receipt=json.loads(path.read_text());identity=json.loads((folder/'collection.json').read_text())
    if receipt['collection_id']!=folder.name or key(identity)!=folder.name:raise ValueError('Collection identity differs')
    seeds=Path(repo)/'data/manifests/clps/landing-candidates.csv'
    if sha(seeds)!=identity['catalog_sha256']:raise ValueError('Published catalog changed')
    if any(float(r['observer_height_m'])!=config['observer_height_m'] or float(r['step_hours'])!=config['step_hours'] for r in identity['requests']):
        raise ValueError('Published source settings differ')
    return config,folder,receipt,{s['site_id'] for s in load_catalog(seeds)}


def compact(row):
    result={name:row[name] for name in ('body','longest_basis')}
    result.update({name:utc(row[name]).isoformat() for name in ('start_utc','end_utc')})
    if row['body'] not in ('SUN','EARTH'):raise ValueError('Unexpected body')
    result['period_complete']=row['period_complete']=='True'
    if row['period_complete'] not in ('True','False'):raise ValueError('Invalid coverage flag')
    for name in NUMBERS:
        value=None if row[name]=='' else float(row[name])
        if value is not None and not math.isfinite(value):raise ValueError('Nonfinite planning metric')
        result[name]=value
    lo,hi=(result[k] for k in ('mean_visible_fraction_lower','mean_visible_fraction_upper'))
    if lo is None or hi is None or not 0<=lo<=hi<=1:raise ValueError('Invalid mean fraction bounds')
    duration=(utc(row['end_utc'])-utc(row['start_utc'])).total_seconds()/3600
    if duration<=0 or duration!=result['total_hours']:raise ValueError('Planning duration differs')
    if not 0<=result['unknown_hours']<=duration:raise ValueError('Invalid unknown duration')
    lower,upper=(result[k] for k in ('simultaneous_positive_visibility_hours_lower','simultaneous_positive_visibility_hours_upper'))
    if not 0<=lower<=upper<=duration:raise ValueError('Invalid joint visibility duration')
    if result['longest_blocked_hours'] is not None and not 0<=result['longest_blocked_hours']<=duration:
        raise ValueError('Invalid obstruction duration')
    return result


def build_views(root,repo):
    root=Path(root);config,folder,receipt,ids=publication(root,repo)
    target=root/'planning-views'/config['summary_receipt_sha256']
    if target.exists():
        manifest=json.loads((target/'manifest.json').read_text())
        if manifest['policy']!=POLICY or manifest['collection_id']!=folder.name or manifest['source_receipt_sha256']!=config['summary_receipt_sha256'] or manifest['source_csv_sha256']!={n:receipt['artifacts'][n] for n in ('seasonal.csv','mission-windows.csv')} or len(manifest['files'])!=receipt['sites']:
            raise ValueError('Existing planning view identity differs; preserve and report')
        for site_id,expected in manifest['files'].items():
            if site_id not in ids or sha(target/(site_id+'.json'))!=expected:raise ValueError('Existing planning view changed')
        return target
    grouped={}
    for name,kind in [('seasonal.csv','seasonal'),('mission-windows.csv','windows')]:
        path=folder/'summary'/name
        if sha(path)!=receipt['artifacts'][name]:raise ValueError('Source summary CSV differs: '+name)
        with path.open(newline='') as stream:
            for row in csv.DictReader(stream):
                site_id=row['site_id']
                if site_id not in ids:raise ValueError('Unknown summary site')
                data=grouped.setdefault(site_id,dict(seasonal=[],windows=[]))
                value=compact(row)
                if kind=='seasonal':
                    if row['scope'] not in ('collection','month','year'):raise ValueError('Unexpected seasonal scope')
                    value['scope']=row['scope']
                else:
                    days=int(row['mission_days']);first=utc(row['start_utc'])
                    if days not in (1,7,14,30) or not value['period_complete'] or first.hour or first.minute or first.second or first.microsecond:
                        raise ValueError('Invalid daily mission window')
                    if utc(row['end_utc'])!=first+timedelta(days=days):raise ValueError('Window duration differs')
                    value['mission_days']=days
                if not utc(config['start_utc'])<=utc(value['start_utc'])<utc(value['end_utc'])<=utc(config['end_utc']):
                    raise ValueError('Summary outside published dates')
                data[kind].append(value)
    if len(grouped)!=receipt['sites']:raise ValueError('Planning view site count differs')
    temporary=target.with_name(target.name+'.preparing');temporary.mkdir(parents=True,exist_ok=False)
    manifest=dict(policy=POLICY,collection_id=folder.name,source_receipt_sha256=config['summary_receipt_sha256'],
        source_csv_sha256={n:receipt['artifacts'][n] for n in ('seasonal.csv','mission-windows.csv')},files={})
    for site_id,data in grouped.items():
        for kind in ('seasonal','windows'):
            seen=set();pairs={}
            for value in data[kind]:
                pair=(value['start_utc'],value['end_utc'],value.get('scope'),value.get('mission_days'))
                token=(*pair,value['body'])
                if token in seen:raise ValueError('Duplicate planning row')
                seen.add(token);pairs.setdefault(pair,set()).add(value['body'])
            if any(bodies!={'SUN','EARTH'} for bodies in pairs.values()):raise ValueError('Incomplete body pair')
        payload=dict(policy=POLICY,site_id=site_id,collection_id=folder.name,label=config['label'],
            start_utc=config['start_utc'],end_utc=config['end_utc'],observer_height_m=config['observer_height_m'],step_hours=config['step_hours'],**data)
        path=temporary/(site_id+'.json');write_json(path,payload);manifest['files'][site_id]=sha(path)
    write_json(temporary/'manifest.json',manifest);temporary.rename(target)
    return target


def planning_response(root,repo,site_id):
    canonical={s['site_id'] for s in load_catalog(Path(repo)/'data/manifests/clps/landing-candidates.csv')}
    if site_id not in canonical:raise ValueError('Choose a catalog site')
    unavailable=dict(available=False,site_id=site_id,seasonal=[],windows=[],notice='No published planning data for this site/date range yet.')
    try:
        config,folder,receipt,ids=publication(root,repo)
        target=Path(root)/'planning-views'/config['summary_receipt_sha256']
        manifest=json.loads((target/'manifest.json').read_text())
        if manifest['policy']!=POLICY or manifest['collection_id']!=folder.name or manifest['source_receipt_sha256']!=config['summary_receipt_sha256']:
            raise ValueError('Planning publication identity differs')
        if manifest['source_csv_sha256']!={n:receipt['artifacts'][n] for n in ('seasonal.csv','mission-windows.csv')}:
            raise ValueError('Planning source hashes differ')
        expected=manifest['files'].get(site_id)
        if expected is None:return unavailable
        path=target/(site_id+'.json')
        if sha(path)!=expected:raise ValueError('Planning view checksum differs')
        value=json.loads(path.read_text())
        if value['site_id']!=site_id or value['collection_id']!=folder.name or value['policy']!=POLICY:
            raise ValueError('Planning site identity differs')
        return dict(value,available=True,notice='Hourly sampled surface conditions; no launch or trajectory window is implied.')
    except (OSError,ValueError,KeyError,TypeError,AttributeError):
        return dict(unavailable,notice='Verified planning views are unavailable. Site selection and existing results remain usable.')
