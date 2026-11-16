"""Offline, serial, resumable collection; app calculations keep their own index."""
import argparse
from contextlib import contextmanager
import csv
from datetime import datetime,timedelta,timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import time

from .assets import write_json
from .planner_jobs import spawn_worker
from .planner_worker import install_cancellation_handlers
from .result_store import engine_identity,source_snapshot,load_result,canonical_request
from .site_catalog import load_catalog,assess_catalog,POLICY

REPO=Path(__file__).resolve().parents[5]
FOUNDATION=REPO/'data/manifests/clps/foundation-sources.json'
GLOBAL=REPO/'data/manifests/clps/composite-global-sources.json'
VERIFIER=REPO/'apps/clps/scripts/verify_disk_area_artifacts.py'


def digest(path):
    value=hashlib.sha256()
    with Path(path).open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):value.update(block)
    return value.hexdigest()


def key(value):return hashlib.sha256(json.dumps(value,sort_keys=True,allow_nan=False).encode()).hexdigest()


def utc(value):
    date=datetime.fromisoformat(value.replace('Z','+00:00'))
    if date.tzinfo is None:raise ValueError('Dates must include a UTC offset')
    date=date.astimezone(timezone.utc)
    if date.minute or date.second or date.microsecond:raise ValueError('Archive dates must fall on an hour')
    return date


def chunks(start,end,days):
    if not 1<=days<=30:raise ValueError('Chunk days must be 1–30')
    if not utc('2026-01-01T00:00Z')<=start<end<=utc('2029-01-01T00:00Z'):
        raise ValueError('Archive range must fit 2026–2028')
    if (end-start).total_seconds()%86400:raise ValueError('Archive range must contain whole days')
    cursor=start
    while cursor<end:
        stop=min(end,cursor+timedelta(days=days))
        yield cursor,stop
        cursor=stop


def requests(sites,start,end,days):
    for site in sites:
        for first,last in chunks(start,end,days):
            yield dict(site_id=site['site_id'],latitude_deg=site['latitude_deg'],longitude_deg=site['longitude_deg'],
                start_utc=first.isoformat(),days=(last-first).total_seconds()/86400,
                observer_height_m=2.0,step_hours=1.0,az_step_deg=2.0,max_distance_m=150000.0,distance_steps=256)


@contextmanager
def collection_lock(folder):
    path=folder/'.collection.lock'
    fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        with os.fdopen(fd,'w') as stream:stream.write(str(os.getpid()))
        yield
    finally:path.unlink(missing_ok=True)


def write_table(path,rows):
    rows=list(rows)
    if not rows:raise ValueError('Cannot publish an empty archive table')
    path=Path(path);temporary=path.with_suffix(path.suffix+'.partial')
    with temporary.open('w',newline='') as stream:
        writer=csv.DictWriter(stream,fieldnames=list(rows[0]));writer.writeheader();writer.writerows(rows)
    temporary.replace(path)


def child(command,work,log_path):
    env=dict(os.environ);env['PYTHONPATH']=str(REPO/'apps/clps/api/src')
    with log_path.open('w') as log:
        process=spawn_worker(command,REPO,env,log)
        try:code=process.wait()
        except KeyboardInterrupt:
            if process.poll() is None:process.send_signal(signal.SIGTERM)
            # Preserve the worker's cleanup and evidence; never force-delete locks.
            process.wait();raise
    if code:raise ValueError(f'Child exit {code}; see {log_path}')


def response(log_path):
    # The worker prints diagnostics followed by a JSON response at end of log.
    import re
    text=log_path.read_text();result=None
    for match in re.finditer(r'(?m)^\{',text):
        try:
            value,_=json.JSONDecoder().raw_decode(text[match.start():])
            if value.get('status')=='complete' and value.get('cache_key'):result=value
        except (ValueError,AttributeError):continue
    if result is None:raise ValueError(f'No completed worker response; see {log_path}')
    return result


def validated_receipt(folder,request,identity=None):
    path=folder/'jobs'/(key(request)+'.json')
    if not path.exists():return None
    receipt=json.loads(path.read_text())
    if receipt['request']!=request:raise ValueError('Job receipt request mismatch')
    if receipt['state']!='complete':return None
    result=load_result(folder/'work',receipt['cache_key'])
    if result is None or result['run_id']!=receipt['run_id']:raise ValueError('Completed archive artifacts changed or are missing')
    original=json.loads((Path(result['artifacts_directory'])/'result-record.json').read_text())['identity']
    if original['request']!=canonical_request(request):raise ValueError('Completed receipt refers to different inputs')
    identity=identity or json.loads((folder/'collection.json').read_text())
    for name in ('engine','sources','manifests'):
        if original[name]!=identity[name]:raise ValueError('Completed provenance mismatch: '+name)
    verification=Path(receipt['verification_log'])
    if not verification.is_file() or digest(verification)!=receipt['verification_log_sha256']:
        raise ValueError('Completed verification receipt changed')
    return receipt


def collect(folder,work,items,max_jobs,identity):
    jobs=folder/'jobs';jobs.mkdir(exist_ok=True)
    logs=folder/'logs';logs.mkdir(exist_ok=True)
    completed=0;skipped=0
    for request in items:
        if validated_receipt(folder,request,identity):skipped+=1;continue
        if completed>=max_jobs:break
        job_id=key(request);stamp=str(time.time_ns());receipt_path=jobs/(job_id+'.json')
        log_path=logs/(job_id+'-'+stamp+'.log');verify_path=logs/(job_id+'-'+stamp+'-verify.log')
        record=dict(request=request,state='running',started_utc=datetime.now(timezone.utc).isoformat(),log=str(log_path))
        write_json(receipt_path,record)
        try:
            if engine_identity()!=identity['engine']:raise ValueError('Source/runtime changed during collection; restart with a new identity')
            command=[sys.executable,'-u','-m','lunar_lab.planner_worker','--work-dir',str(work),
                '--sources',str(FOUNDATION),'--global-sources',str(GLOBAL),'--offline']
            for name,value in request.items():
                option='start' if name=='start_utc' else name.replace('_','-')
                command.extend(['--'+option,str(value)])
            child(command,work,log_path);result=response(log_path)
            saved=load_result(work,result['cache_key'])
            if saved is None:raise ValueError('Worker result failed saved-artifact integrity validation')
            original=json.loads((Path(saved['artifacts_directory'])/'result-record.json').read_text())
            if original['identity']['request']!=canonical_request(request):raise ValueError('Worker returned different inputs')
            for name in ('engine','sources','manifests'):
                if original['identity'][name]!=identity[name]:raise ValueError('Worker provenance differs from collection: '+name)
            child([sys.executable,'-u',str(VERIFIER),saved['artifacts_directory']],work,verify_path)
            record.update(state='complete',cache_key=saved['cache_key'],run_id=saved['run_id'],
                verification_log=str(verify_path),verification_log_sha256=digest(verify_path),
                finished_utc=datetime.now(timezone.utc).isoformat())
            write_json(receipt_path,record);completed+=1
            print(json.dumps(dict(site=request['site_id'],start=request['start_utc'],state='complete',run_id=saved['run_id'])),flush=True)
        except (Exception,KeyboardInterrupt) as exc:
            record.update(state='interrupted' if isinstance(exc,KeyboardInterrupt) else 'failed',error=str(exc))
            write_json(receipt_path,record);raise
    all_done=all(validated_receipt(folder,r,identity) is not None for r in items)
    status=dict(collection=str(folder),new_jobs=completed,resumed_jobs=skipped,total_jobs=len(items),complete=all_done)
    write_json(folder/'progress.json',status);print(json.dumps(status,indent=2))


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--catalog',type=Path,default=REPO/'data/manifests/clps/landing-candidates.csv')
    parser.add_argument('--assets-root',type=Path,default=REPO/'data/local/lml')
    parser.add_argument('--output',type=Path,default=REPO/'data/local/lml/site-atlas')
    parser.add_argument('--sites',help='Comma-separated exact IDs; default all 50')
    parser.add_argument('--start',default='2026-01-01T00:00:00Z')
    parser.add_argument('--end',default='2029-01-01T00:00:00Z')
    parser.add_argument('--chunk-days',type=int,default=30)
    parser.add_argument('--max-jobs',type=int,default=1,help='Maximum new jobs this invocation; validated completed jobs are skipped')
    parser.add_argument('--plan',action='store_true',help='Print workload only; no writes or calculations')
    parser.add_argument('--preflight',action='store_true',help='Assess all 50 terrain points, write catalog, do not run calculations')
    args=parser.parse_args(argv)
    sites=load_catalog(args.catalog);selected=sites
    if args.sites:
        names=args.sites.split(',')
        if len(names)!=len(set(names)) or set(names)-{s['site_id'] for s in sites}:raise ValueError('Unknown or duplicate site IDs')
        selected=[s for s in sites if s['site_id'] in names]
    items=list(requests(selected,utc(args.start),utc(args.end),args.chunk_days))
    if args.max_jobs<1:raise ValueError('max-jobs must be positive')
    if args.plan:
        print(json.dumps(dict(sites=len(selected),published=sum(s['kind']=='published-candidate' for s in selected),
            exploratory=sum(s['kind']=='exploratory-point' for s in selected),jobs=len(items),
            body_rows_including_chunk_boundaries=sum(2*(round(r['days']*24)+1) for r in items),
            observer_height_m=2,step_hours=1,site_ids=[s['site_id'] for s in selected]),indent=2));return 0
    install_cancellation_handlers()
    assets=args.assets_root.resolve()
    specs=[json.loads(p.read_text()) for p in (FOUNDATION,GLOBAL)]
    identity=dict(policy=POLICY,catalog_sha256=digest(args.catalog),catalog=sites,requests=items,engine=engine_identity(),
        manifests={'foundation':digest(FOUNDATION),'global':digest(GLOBAL)},sources=source_snapshot(assets,specs),verifier_sha256=digest(VERIFIER))
    folder=args.output.resolve()/key(identity);folder.mkdir(parents=True,exist_ok=True)
    with collection_lock(folder):
        manifest=folder/'collection.json'
        if manifest.exists() and json.loads(manifest.read_text())!=identity:raise ValueError('Collection identity changed')
        write_json(manifest,identity)
        print(f'Collection: {folder}',flush=True)
        # Assess all 50 before creating work or running any selected jobs.
        catalog=assess_catalog(sites,assets,FOUNDATION);write_table(folder/'sites.csv',catalog)
        if args.preflight:return 0
        work=folder/'work';work.mkdir(exist_ok=True)
        link=work/'assets'
        if not link.exists():link.symlink_to(assets/'assets',target_is_directory=True)
        if link.resolve()!=(assets/'assets').resolve():raise ValueError('Private work directory references different assets')
        ledger=work/'asset-receipts.json'
        if not ledger.exists():shutil.copy2(assets/'asset-receipts.json',ledger)
        collect(folder,work,items,args.max_jobs,identity)
    return 0


if __name__=='__main__':
    try:raise SystemExit(main())
    except KeyboardInterrupt:raise SystemExit(130)
