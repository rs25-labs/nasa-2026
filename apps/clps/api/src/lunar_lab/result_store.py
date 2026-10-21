"""Small CSV/JSON result registry. Writers hold the existing environment lock."""
from datetime import datetime,timezone
import hashlib
from importlib.metadata import version
import json
from pathlib import Path
import platform

from .assets import validate_bytes,write_json

TABLES=('environment-timeseries.csv','environment-intervals.csv','environment-summaries.csv')


def _sha(path):
    digest=hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda:stream.read(1024*1024),b''):digest.update(block)
    return digest.hexdigest()


def canonical_request(request):
    numeric=('latitude_deg','longitude_deg','observer_height_m','days','step_hours','az_step_deg','max_distance_m')
    result={key:float(request[key]) for key in numeric}
    steps=int(request['distance_steps'])
    if float(request['distance_steps'])!=steps:raise ValueError('distance_steps must be an integer')
    result.update(site_id=str(request['site_id']),distance_steps=steps)
    start=datetime.fromisoformat(request['start_utc'].replace('Z','+00:00'))
    if start.tzinfo is None:raise ValueError('Start must include a timezone')
    result['start_utc']=start.astimezone(timezone.utc).isoformat()
    return result


def make_identity(request,manifests,sources,engine):
    return dict(format='lml-file-results-v1',request=canonical_request(request),
                manifests=manifests,sources=sources,engine=engine)


def result_key(identity):
    return hashlib.sha256(json.dumps(identity,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()


def engine_identity():
    package=Path(__file__).parent
    code={p.name:_sha(p) for p in sorted(package.glob('*.py'))}
    return dict(package_sha256=result_key(code),python=platform.python_version(),platform=platform.platform(),
                dependencies={name:version(name) for name in ('numpy','pyproj','spiceypy','matplotlib')})


def source_snapshot(root,specs):
    """Verify selected cached bytes, rather than trusting the receipt ledger."""
    ledger=json.loads((root/'asset-receipts.json').read_text())
    sources={}
    for spec in specs:
        for asset in spec['assets']:
            receipt=ledger[asset['id']]
            if receipt['filename']!=asset['filename'] or receipt['source_url']!=asset['url']:
                raise ValueError('Source receipt does not match manifest')
            hashes=validate_bytes(_file(root/'assets',asset['filename']),asset)
            if hashes['sha256']!=receipt['sha256']:raise ValueError('Cached source bytes changed')
            sources[asset['id']]=receipt['sha256']
    return sources


def _file(run,name):
    if not isinstance(name,str) or Path(name).name!=name or name in ('','.','..') or '\\' in name:
        raise ValueError('Invalid saved artifact name')
    path=run/name
    if path.resolve().parent!=run.resolve():raise ValueError('Artifact escapes saved result')
    return path


def _run(root,run_id):
    if not isinstance(run_id,str) or not run_id or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_' for c in run_id):
        raise ValueError('Invalid saved run ID')
    folder=root/'env-runs'
    run=folder/run_id
    if run.resolve().parent!=folder.resolve():raise ValueError('Run escapes results directory')
    return run


def _report(run):
    if (run/'SUPERSEDED.txt').exists():raise ValueError('Superseded result')
    report=json.loads(_file(run,'environment-report.json').read_text())
    if report['status']!='complete' or report['run_id']!=run.name:raise ValueError('Result is not complete')
    if not set(TABLES).issubset(report['artifacts']):raise ValueError('Missing result tables')
    if len(set(report['artifacts']))!=len(report['artifacts']):raise ValueError('Duplicate artifacts')
    return report


def _validate(root,run_id,key=None):
    run=_run(root,run_id)
    record=json.loads(_file(run,'result-record.json').read_text())
    if record['schema_version']!=1 or record['cache_key']!=result_key(record['identity']):raise ValueError('Invalid result record')
    if key is not None and record['cache_key']!=key:raise ValueError('Result identity mismatch')
    report=_report(run)
    if set(record['artifacts'])!=set(report['artifacts']):raise ValueError('Artifact inventory mismatch')
    for name,receipt in record['artifacts'].items():
        path=_file(run,name)
        if path.stat().st_size!=receipt['bytes'] or receipt['bytes']<=0 or _sha(path)!=receipt['sha256']:
            raise ValueError('Saved artifact changed')
    return record,report


_INVALID=(OSError,ValueError,KeyError,TypeError)


def _indexed(root):
    try:
        index=json.loads((root/'results-index.json').read_text())
        if index['schema_version']==1 and isinstance(index['results'],dict):return index['results']
    except _INVALID:pass
    return {}


def load_result(root,key):
    """Read a saved result by key; readers never acquire a writer lock or write."""
    root=Path(root).resolve()
    if not isinstance(key,str) or len(key)!=64 or any(c not in '0123456789abcdef' for c in key):return None
    indexed=_indexed(root).get(key)
    def candidates():
        if indexed is not None:yield indexed
        # Recovery only: a healthy indexed hit returns before any folder scan.
        for path in sorted((root/'env-runs').glob('*/result-record.json'),reverse=True):
            if path.parent.name!=indexed:yield path.parent.name
    for run_id in candidates():
        try:
            record,report=_validate(root,run_id,key)
            run=_run(root,run_id)
            return dict(status='complete',cache_hit=True,cache_key=key,run_id=run_id,
                        report=str(run/'environment-report.json'),artifacts_directory=str(run),
                        summaries=report['summaries'],
                        tables={name:str(run/name) for name in TABLES})
        except _INVALID:continue
    return None


def lookup(root,identity):
    return load_result(root,result_key(identity))


def rebuild_index(root):
    root=Path(root).resolve();results={};newest={}
    for path in sorted((root/'env-runs').glob('*/result-record.json')):
        try:
            record,report=_validate(root,path.parent.name)
            key=record['cache_key'];order=(report.get('created_utc',''),path.parent.name)
            if key not in newest or order>newest[key]:
                newest[key]=order;results[key]=path.parent.name
        except _INVALID:continue
    write_json(root/'results-index.json',dict(schema_version=1,results=results))
    return len(results)


def publish(root,run,identity):
    root=Path(root).resolve();run=Path(run).resolve()
    if _run(root,run.name)!=run:raise ValueError('Result is outside work directory')
    report=_report(run);inventory={}
    for name in report['artifacts']:
        path=_file(run,name);size=path.stat().st_size
        if size<=0:raise ValueError('Empty result artifact')
        inventory[name]=dict(bytes=size,sha256=_sha(path))
    key=result_key(identity)
    record=dict(schema_version=1,cache_key=key,identity=identity,artifacts=inventory)
    record_path=_file(run,'result-record.json')
    if record_path.exists() and json.loads(record_path.read_text())!=record:
        raise ValueError('Saved result record is immutable')
    write_json(record_path,record)
    rebuild_index(root)
    return key
