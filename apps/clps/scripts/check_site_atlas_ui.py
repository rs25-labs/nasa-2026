"""Pi-only lightweight publication check; no workers or scientific asset loads."""
import hashlib
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from lunar_lab.site_atlas import sites_response


def check():
    repo=Path(__file__).resolve().parents[3]
    config=repo/'data/manifests/clps/site-atlas-ui.json';publication=json.loads(config.read_text())
    original=repo/'data/local/lml/site-atlas'/publication['collection_id']
    names=('collection.json','sites.csv','summary/complete.json','summary/site-profiles.json')
    before={name:hashlib.sha256((original/name).read_bytes()).hexdigest() for name in names}
    with TemporaryDirectory() as temp:
        base=Path(temp);metadata=base/'repo/data/manifests/clps';metadata.mkdir(parents=True)
        for name in ('landing-candidates.csv','site-atlas-ui.json'):shutil.copy2(config.parent/name,metadata/name)
        folder=base/'root/site-atlas'/publication['collection_id'];(folder/'summary').mkdir(parents=True)
        for name in names:shutil.copy2(original/name,folder/name)
        result=sites_response(base/'root',base/'repo')
        assert len(result['sites'])==50 and result['ready_count']==3 and result['preview_available']
        assert sum(s['kind']=='published-candidate' for s in result['sites'])==20
        ready={s['site_id'] for s in result['sites'] if s['data_status']=='ready'}
        assert ready=={'pub-cr01','pub-mmo01','exp-cr-xp'}
        assert all(s['terrain'] is not None for s in result['sites'])
        assert all(s['preview'] is None for s in result['sites'] if s['site_id'] not in ready)
        profile=folder/'summary/site-profiles.json';content=profile.read_bytes();profile.write_bytes(content+b' ')
        failed=sites_response(base/'root',base/'repo')
        assert not failed['preview_available'] and failed['ready_count']==0
        assert all(s['preview'] is None and s['terrain'] is None for s in failed['sites'])
        profile.write_bytes(content);(folder/'summary/complete.json').unlink()
        missing=sites_response(base/'root',base/'repo')
        assert len(missing['sites'])==50 and missing['ready_count']==0 and not missing['preview_available']
    assert before=={name:hashlib.sha256((original/name).read_bytes()).hexdigest() for name in names}
    print('PASS: 50 catalog entries, exactly three dated pilot previews, corruption/missing-publication fallback, source files unchanged')


if __name__=='__main__':check()
