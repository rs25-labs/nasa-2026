"""Focused file-store behavior checks using small temporary CSV/JSON results."""
from copy import deepcopy
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from lunar_lab.result_store import canonical_request,make_identity,result_key,publish,lookup,rebuild_index,source_snapshot


def check():
    request=dict(site_id='sample-a',latitude_deg=-89.54,longitude_deg=0,observer_height_m=2,
        start_utc='2026-11-14T09:00:00Z',days=1,step_hours=6,az_step_deg=2,max_distance_m=150000,distance_steps=256)
    identity=make_identity(request,{'foundation':'manifest-a'},{'terrain':'asset-a'},{'code':'version-a'})
    same=dict(request,start_utc='2026-11-14T01:00:00-08:00',longitude_deg=0.0)
    assert result_key(identity)==result_key(make_identity(same,identity['manifests'],identity['sources'],identity['engine']))
    for part,key,value in [('request','observer_height_m',3),('sources','terrain','asset-b'),('engine','code','version-b'),('manifests','foundation','manifest-b')]:
        changed=deepcopy(identity);changed[part][key]=value
        assert result_key(changed)!=result_key(identity)
    assert canonical_request(dict(request,start_utc='2026-11-14T09:00:00.123Z'))!=canonical_request(request)
    with TemporaryDirectory() as temp:
        root=Path(temp)
        (root/'assets').mkdir();asset=root/'assets'/'sample.img';asset.write_bytes(b'abcd')
        import hashlib
        digest=hashlib.sha256(b'abcd').hexdigest()
        (root/'asset-receipts.json').write_text(json.dumps({'terrain':dict(filename=asset.name,source_url='https://example.test/data',sha256=digest)}))
        spec={'assets':[dict(id='terrain',filename=asset.name,url='https://example.test/data',max_bytes=16)]}
        assert source_snapshot(root,[spec])=={'terrain':digest}
        asset.write_bytes(b'changed')
        try:source_snapshot(root,[spec])
        except ValueError:pass
        else:raise AssertionError('changed source bytes accepted')
        root=Path(temp);run=root/'env-runs'/'sample-run';run.mkdir(parents=True)
        files=['environment-report.json','environment-timeseries.csv','environment-intervals.csv','environment-summaries.csv']
        report=dict(status='complete',run_id=run.name,artifacts=files,summaries=[{'body':'SUN'}])
        for name in files[1:]:(run/name).write_text('body,value\nSUN,0\n')
        (run/files[0]).write_text(json.dumps(report))
        key=publish(root,run,identity)
        found=lookup(root,identity);assert found['cache_key']==key and found['run_id']==run.name
        assert lookup(root,make_identity(dict(request,days=2),identity['manifests'],identity['sources'],identity['engine'])) is None
        index=root/'results-index.json';index.write_text('{broken')
        assert lookup(root,identity)['run_id']==run.name
        assert rebuild_index(root)==1
        (run/'environment-timeseries.csv').write_text('changed')
        assert lookup(root,identity) is None and rebuild_index(root)==0
        (run/'environment-timeseries.csv').write_text('body,value\nSUN,0\n')
        (run/'SUPERSEDED.txt').write_text('obsolete')
        assert lookup(root,identity) is None
        (run/'SUPERSEDED.txt').unlink()
        report['status']='running';(run/files[0]).write_text(json.dumps(report))
        try:publish(root,run,identity)
        except ValueError:pass
        else:raise AssertionError('unfinished result published')
    with TemporaryDirectory() as temp:
        root=Path(temp)
        for name,created in [('z-old','2026-10-20T00:00:00Z'),('a-new','2026-10-20T00:00:01Z')]:
            run=root/'env-runs'/name;run.mkdir(parents=True)
            for artifact in files[1:]:(run/artifact).write_text('body,value\nSUN,0\n')
            (run/files[0]).write_text(json.dumps(dict(status='complete',run_id=name,created_utc=created,artifacts=files,summaries=[])))
            publish(root,run,identity)
        assert lookup(root,identity)['run_id']=='a-new', 'refresh must win by timestamp, not folder spelling'
        assert rebuild_index(root)==1 and lookup(root,identity)['run_id']=='a-new'
    print('PASS: file identity, intact reuse, invalidation, rebuild, corruption/superseded/incomplete rejection')


if __name__=='__main__':check()
