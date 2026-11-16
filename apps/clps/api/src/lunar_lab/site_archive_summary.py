"""Join verified hourly chunks and derive reusable seasonal/mission summaries."""
import argparse
import csv
from datetime import timedelta
import json
import math
from pathlib import Path

from .assets import write_json
from .environment import compress_intervals,summarize
from .site_archive import utc,key,digest,validated_receipt,write_table,collection_lock


def bounds(row):
    state=row['state']
    if state not in {'FULL','PARTIAL','BLOCKED','UNKNOWN'}:raise ValueError('Unknown sample state')
    default={'FULL':(1,1),'BLOCKED':(0,0),'UNKNOWN':(0,1)}.get(state)
    lo=row.get('visible_fraction_lower','');hi=row.get('visible_fraction_upper','')
    if lo=='' or hi=='':
        if default is None:raise ValueError('Partial sample has no fraction bounds')
        lo,hi=default
    lo=float(lo);hi=float(hi)
    if not all(math.isfinite(v) for v in (lo,hi)) or not 0<=lo<=hi<=1:raise ValueError('Invalid sample bounds')
    if state=='FULL' and (lo,hi)!=(1,1):raise ValueError('FULL bounds mismatch')
    if state=='BLOCKED' and (lo,hi)!=(0,0):raise ValueError('BLOCKED bounds mismatch')
    return lo,hi


def join_chunks(parts):
    """Next chunk owns a shared endpoint; prior terminal has zero duration."""
    joined={};seams=[];last_end=None
    for request,rows,run_id,cache_key in parts:
        start=utc(request['start_utc']);end=start+timedelta(days=request['days'])
        if last_end is not None and start!=last_end:raise ValueError('Gap or overlap between chunks')
        slots=round((end-start).total_seconds()/3600);seen=set()
        for original in rows:
            row=dict(original);time=utc(row['utc']);body=row['body'];slot=(time,body)
            if row['site_id']!=request['site_id'] or body not in ('SUN','EARTH'):raise ValueError('Unexpected site/body in chunk')
            if not start<=time<=end or (time-start).total_seconds()%3600:raise ValueError('Unexpected sample timestamp')
            if slot in seen:raise ValueError('Duplicate sample within a chunk')
            seen.add(slot);lo,hi=bounds(row)
            row.update(visible_fraction_lower=lo,visible_fraction_upper=hi,archive_run_id=run_id,archive_cache_key=cache_key)
            if slot in joined:
                if time!=start or start!=last_end:raise ValueError('Unexpected duplicate between chunks')
                old=joined[slot]
                for field in ('azimuth_deg','center_elevation_deg','angular_radius_deg'):
                    if float(old[field])!=float(row[field]):raise ValueError('Chunk boundary geometry differs')
                old_lo,old_hi=bounds(old)
                if max(lo,old_lo)>min(hi,old_hi):raise ValueError('Chunk boundary bounds are disjoint')
                seams.append(dict(site_id=row['site_id'],utc=row['utc'],body=body,
                    previous_run_id=old['archive_run_id'],next_run_id=run_id,
                    previous_lower=old_lo,previous_upper=old_hi,next_lower=lo,next_upper=hi,
                    policy='next chunk start owns duration; compatible previous terminal discarded'))
            joined[slot]=row
        expected={(start+timedelta(hours=i),body) for i in range(slots+1) for body in ('SUN','EARTH')}
        if seen!=expected:raise ValueError('Missing hourly samples in chunk')
        last_end=end
    if not joined:raise ValueError('No complete chunks to join')
    return [joined[k] for k in sorted(joined)],seams


def metrics(rows,scope,first,last):
    site=rows[0]['site_id'];result=[]
    complete=True
    if scope=='month':
        beginning=first.replace(day=1,hour=0)
        following=(beginning.replace(day=28)+timedelta(days=4)).replace(day=1)
        complete=first==beginning and last==following
    if scope=='year':
        beginning=first.replace(month=1,day=1,hour=0)
        complete=first==beginning and last==beginning.replace(year=beginning.year+1)
    for body in ('SUN','EARTH'):
        intervals=compress_intervals(rows,site,body)
        values=summarize(rows,intervals,site,body)
        # Scalar is absent for bounded partial samples; never substitute midpoint.
        result.append(dict(scope=scope,start_utc=first.isoformat(),end_utc=last.isoformat(),period_complete=complete,**values))
    sun={utc(r['utc']):r for r in rows if r['body']=='SUN'}
    earth={utc(r['utc']):r for r in rows if r['body']=='EARTH'}
    times=sorted(sun);known=possible=0.0
    for a,b in zip(times,times[1:]):
        hours=(b-a).total_seconds()/3600;sl,su=bounds(sun[a]);el,eu=bounds(earth[a])
        if sl>0 and el>0:known+=hours
        if su>0 and eu>0:possible+=hours
    for row in result:
        row.update(simultaneous_positive_visibility_hours_lower=known,
                   simultaneous_positive_visibility_hours_upper=possible,
                   simultaneous_basis='both disks have positive visible area; hourly left-held estimate, not electrical power or radio availability')
    return result


def periods(first,last):
    yield 'collection',first,last
    cursor=first.replace(day=1,hour=0)
    while cursor<last:
        following=(cursor.replace(day=28)+timedelta(days=4)).replace(day=1)
        yield 'month',max(first,cursor),min(last,following)
        cursor=following
    for year in range(first.year,last.year+1):
        cursor=first.replace(year=year,month=1,day=1,hour=0)
        following=cursor.replace(year=year+1)
        if max(first,cursor)<min(last,following):yield 'year',max(first,cursor),min(last,following)


def summarize_site(rows):
    times=sorted({utc(r['utc']) for r in rows});first,last=times[0],times[-1]
    by_time={t:[] for t in times}
    for row in rows:by_time[utc(row['utc'])].append(row)
    def subset(a,b):
        return [r for i in range(round((b-a).total_seconds()/3600)+1) for r in by_time[a+timedelta(hours=i)]]
    seasonal=[];windows=[]
    for scope,a,b in periods(first,last):seasonal.extend(metrics(subset(a,b),scope,a,b))
    cursor=first.replace(hour=0)
    if cursor<first:cursor+=timedelta(days=1)
    while cursor<last:
        for days in (1,7,14,30):
            end=cursor+timedelta(days=days)
            if end<=last:
                for row in metrics(subset(cursor,end),'mission-window',cursor,end):
                    windows.append(dict(mission_days=days,**row))
        cursor+=timedelta(days=1)
    return seasonal,windows


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('collection',type=Path)
    args=parser.parse_args(argv);folder=args.collection.resolve()
    identity=json.loads((folder/'collection.json').read_text())
    if folder.name!=key(identity):raise ValueError('Collection manifest/identity mismatch')
    with collection_lock(folder):
        output=folder/'summary';output.mkdir(exist_ok=True)
        # Completion marker is written only after every receipt/chunk validates.
        (output/'complete.json').unlink(missing_ok=True)
        groups={}
        for request in identity['requests']:groups.setdefault(request['site_id'],[]).append(request)
        all_seasonal=[];all_windows=[];all_seams=[];lineage=[];profiles=[]
        with (folder/'sites.csv').open(newline='') as stream:catalog={r['site_id']:r for r in csv.DictReader(stream)}
        for site,items in groups.items():
            parts=[]
            for request in sorted(items,key=lambda r:utc(r['start_utc'])):
                receipt=validated_receipt(folder,request,identity)
                if receipt is None:raise ValueError('Incomplete collection; no finished summaries published')
                run=folder/'work/env-runs'/receipt['run_id']
                with (run/'environment-timeseries.csv').open(newline='') as stream:rows=list(csv.DictReader(stream))
                parts.append((request,rows,receipt['run_id'],receipt['cache_key']))
                lineage.append(dict(site_id=site,start_utc=request['start_utc'],run_id=receipt['run_id'],cache_key=receipt['cache_key']))
            rows,seams=join_chunks(parts);seasonal,windows=summarize_site(rows)
            write_table(output/(site+'-timeseries.csv'),rows)
            all_seasonal.extend(seasonal);all_windows.extend(windows);all_seams.extend(seams)
            profile=dict(catalog[site]);profile['calculated_conditions']=[]
            for metric in seasonal:
                if metric['scope']!='collection':continue
                blocked=metric['longest_blocked_hours']
                profile['calculated_conditions'].append(dict(body=metric['body'],start_utc=metric['start_utc'],end_utc=metric['end_utc'],
                    explanation=f"Mean visible-disk area: {100*metric['mean_visible_fraction_lower']:.1f}–{100*metric['mean_visible_fraction_upper']:.1f}%. "
                        f"Longest known sampled obstruction: {str(blocked)+' h' if blocked!='' else 'unresolved'}. "
                        f"Unknown sampled duration: {metric['unknown_hours']} h.",
                    longest_obstruction_basis=metric['longest_basis']))
            profile['assessment']='Use dated power/visibility tradeoffs; no overall landing-safety score'
            profiles.append(profile)
        write_table(output/'seasonal.csv',all_seasonal)
        if all_windows:write_table(output/'mission-windows.csv',all_windows)
        if all_seams:write_table(output/'seams.csv',all_seams)
        write_table(output/'lineage.csv',lineage)
        write_json(output/'site-profiles.json',profiles)
        write_json(output/'complete.json',dict(collection_id=folder.name,sites=len(groups),
            summary_policy='hourly-left-held-next-chunk-endpoint-v1',summary_source_sha256=digest(Path(__file__)),
            site_catalog_sha256=digest(folder/'sites.csv'),
            artifacts={p.name:digest(p) for p in sorted(output.glob('*.csv'))},
            site_profiles_sha256=digest(output/'site-profiles.json'),
            interpretation='sampled estimates for the stated date range; month/year scopes may cover only part of that period; no event-time or physical safety certification'))
        print(json.dumps(dict(status='complete',output=str(output),sites=len(groups),seasonal_rows=len(all_seasonal),window_rows=len(all_windows)),indent=2))
    return 0


if __name__=='__main__':raise SystemExit(main())
