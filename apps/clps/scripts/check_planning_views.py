"""Pi-only bounded pilot publication check; no solvers, workers or real archive writes."""
import argparse
import json
from pathlib import Path
import shutil
from tempfile import TemporaryDirectory
from lunar_lab.planning_views import build_views,planning_response,sha


def check(root):
    repo=Path(__file__).resolve().parents[3]
    metadata=repo/'data/manifests/clps';config=json.loads((metadata/'site-atlas-ui.json').read_text())
    source=root/'site-atlas'/config['collection_id']
    names=('collection.json','summary/complete.json','summary/seasonal.csv','summary/mission-windows.csv')
    before={n:sha(source/n) for n in names}
    with TemporaryDirectory() as temp:
        base=Path(temp);fixture_repo=base/'repo';fixture_root=base/'root'
        destination=fixture_repo/'data/manifests/clps';destination.mkdir(parents=True)
        for name in ('landing-candidates.csv','site-atlas-ui.json'):shutil.copy2(metadata/name,destination/name)
        folder=fixture_root/'site-atlas'/config['collection_id'];(folder/'summary').mkdir(parents=True)
        for name in names:shutil.copy2(source/name,folder/name)
        target=build_views(fixture_root,fixture_repo)
        saved={p.name:sha(p) for p in target.iterdir()}
        assert build_views(fixture_root,fixture_repo)==target
        assert saved=={p.name:sha(p) for p in target.iterdir()}
        for site in ('pub-cr01','pub-mmo01','exp-cr-xp'):
            value=planning_response(fixture_root,fixture_repo,site)
            assert value['available'] and value['observer_height_m']==2 and value['step_hours']==1
            windows=value['windows'];assert len(windows)==4 and {r['mission_days'] for r in windows}=={1}
            assert {r['start_utc'][:10] for r in windows}=={'2026-11-19','2026-11-20'}
            assert all(not r['period_complete'] for r in value['seasonal'] if r['scope'] in ('month','year'))
        assert not planning_response(fixture_root,fixture_repo,'pub-cr02')['available']
        # Corruption fails closed, without falling back to another site's data.
        view=target/'pub-cr01.json';view.write_bytes(view.read_bytes()+b' ')
        assert not planning_response(fixture_root,fixture_repo,'pub-cr01')['available']
        assert planning_response(fixture_root,fixture_repo,'pub-mmo01')['available']
        try:planning_response(fixture_root,fixture_repo,'../escape')
        except ValueError:pass
        else:raise AssertionError('Unknown site was accepted')
        # A modified CSV is rejected before any new derived publication is prepared.
        shutil.rmtree(target);csv_path=folder/'summary/seasonal.csv';csv_path.write_bytes(csv_path.read_bytes()+b' ')
        try:build_views(fixture_root,fixture_repo)
        except ValueError:pass
        else:raise AssertionError('Altered CSV was accepted')
        assert not target.exists()
    assert before=={n:sha(source/n) for n in names}
    print('PASS: pilot dates/pairs, partial months/years, missing site, idempotence, corruption rejection; source bytes unchanged')


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--work-dir',type=Path,required=True)
    check(parser.parse_args().work_dir)
