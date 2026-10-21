"""Verify a local environment run's fraction evidence and replay clear proofs.

Usage: PYTHONPATH=apps/clps/api/src .venv/bin/python .../verify_disk_area_artifacts.py RUN
This verifies model/numerical evidence, not physical terrain accuracy.
"""
import csv
import json
from pathlib import Path
import sys

from lunar_lab.assets import digests
from lunar_lab.bounded_math import Interval,PI,basis,dot,sin_cos_degrees
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.disk_area import disk_basis,direction_box
from lunar_lab.global_terrain import GlobalTerrain
from lunar_lab.terrain import PolarTerrain


def verify(run):
    def table(name):
        with (run/name).open() as f:
            return list(csv.DictReader(f))
    report=json.loads((run/'environment-report.json').read_text())
    assert report['status']=='complete'
    assert all((run/name).stat().st_size>0 for name in report['artifacts'])
    root=run.parent.parent
    for receipt in report['sources'].values():
        path=root/'assets'/receipt['filename']
        assert path.stat().st_size==receipt['bytes']
        assert digests(path)['sha256']==receipt['sha256']
    for key in ('source_manifest','composite_source_manifest'):
        assert digests(Path(report[key]['path']))['sha256']==report[key]['sha256']
    terrain=PolarTerrain(root/'assets/ldem_85s_40m.lbl',root/'assets/ldem_85s_40m.img')
    global_dem=GlobalTerrain(root/'assets/ldem_16.lbl',root/'assets/ldem_16.img')
    engine=CompositeClearance(terrain,global_dem,report['site_sample'])
    proofs=json.loads((run/'composite-clearance-proofs.json').read_text())
    proof_by_id={p['proof_id']:p for p in proofs}
    assert len(proof_by_id)==len(proofs)
    published=set()
    for proof in proofs:
        if proof.get('proof_kind')=='projected-disk-region':
            d=tuple(Interval(a,b) for a,b in proof['region_direction'])
            replay=engine.prove_region(d,node_budget=proof['node_budget'],minimum_span=proof.get('minimum_polar_span',1),
                                      use_cache='cache_policy' in proof,legacy_wedge=proof.get('region_wedge_policy','legacy-v1')=='legacy-v1')
            if proof.get('reuse_of'):
                assert proof['reuse_of'] in published and proof_by_id[proof['reuse_of']]['clear']
                assert replay.get('reuse_of')==proof['reuse_of']
            if 'cache_policy' in proof:
                assert replay.get('sky_wedge')==proof.get('sky_wedge')
                assert replay['minimum_disk_up_lo']==proof['minimum_disk_up_lo']
                engine.sky_cache.remember(dict(replay,proof_id=proof['proof_id']))
        else:
            replay=engine.prove(proof,node_budget=proof['node_budget'],minimum_span=proof.get('minimum_polar_span',1))
        assert replay['clear']==proof['clear'] and replay['termination']==proof['termination']
        assert replay['terminal_nodes']==proof['terminal_nodes']
        published.add(proof['proof_id'])
    cells={r['cell_id']:r for r in table('terrain-cell-enclosures.csv')}
    witnesses={}
    east,north,up=basis(report['site_sample']['latitude_deg'],report['site_sample']['longitude_deg'])
    areas=json.loads((run/'projected-disk-area-proofs.json').read_text())
    for area in areas:
        leaves={t['tile_id']:t for t in area['tiles']}
        assert len(leaves)==len(area['tiles'])
        def partition(prefix,box):
            if prefix in leaves:
                assert leaves[prefix]['box']==list(box)
                return
            assert len(prefix)<area['max_depth'],'uncovered projected area'
            x0,x1,y0,y1=box;xm,ym=(x0+x1)/2,(y0+y1)/2
            for i,b in enumerate(((x0,xm,y0,ym),(xm,x1,y0,ym),(x0,xm,ym,y1),(xm,x1,ym,y1))):
                partition(prefix+str(i),b)
        partition('',(-1.,1.,-1.,1.))
        assert sum(t['area_square'] for t in area['tiles'])==4
        frame=disk_basis(area)
        for rid,receipt in area['region_receipts'].items():
            prefix=rid.removeprefix('region:');box=(-1.,1.,-1.,1.)
            for digit in prefix:
                x0,x1,y0,y1=box;xm,ym=(x0+x1)/2,(y0+y1)/2
                box=((x0,xm,y0,ym),(xm,x1,y0,ym),(x0,xm,ym,y1),(xm,x1,ym,y1))[int(digit)]
            d=direction_box(frame,box)
            if receipt['state']=='FULL':
                p=proof_by_id[receipt['clearance_proof_id']]
                assert p['clear'] and p['region_direction']==[[str(a.lo),str(a.hi)] for a in d]
            elif receipt.get('witness_kind')=='adaptive-cell-circle':
                from lunar_lab.adaptive_witness import certify_circle
                checked=certify_circle(engine,d,receipt['row'],receipt['col'],
                    receipt['circle_x_m'],receipt['circle_y_m'],receipt['circle_radius_m'])
                assert checked==receipt
            else:
                cell=receipt['witness_cell_id'];r=cells[cell]
                assert r['inner_circle_within_nominal_cap']=='True'
                assert terrain.raw[int(r['row']),int(r['col'])]==int(r['raw_dn'])
                if cell not in witnesses:
                    v=tuple(Interval(r[f'inner_{k}_lo'],r[f'inner_{k}_hi']) for k in ('vx','vy','vz'))
                    k=Interval(r['inner_k_lo'],r['inner_k_hi'])
                    witnesses[cell]=(k,dot(v,up),dot(v,east),dot(v,north))
                k,A,E,N=witnesses[cell]
                assert receipt['elevation_lower_deg']==float(r['inner_cap_elevation_lower_deg'])
                assert sin_cos_degrees(receipt['elevation_lower_deg'])[0].lo>d[2].hi
                h=(d[0].square()+d[1].square()).sqrt()
                B=(E*d[0]+N*d[1])/h
                assert A.lo>0 and B.lo>0 and (A.square()+B.square()).lo>k.square().hi
        visible,blocked=Interval(0),Interval(0)
        for t in area['tiles']:
            x0,x1,y0,y1=t['box']
            radial=Interval(x0,x1).square()+Interval(y0,y1).square()
            assert t['area_square']==(x1-x0)*(y1-y0)
            if t['state']=='OUTSIDE':
                assert radial.lo>1
            elif t['state'] in ('FULL','BLOCKED'):
                rid=t['evidence']['region_id']
                assert t['tile_id'].startswith(rid.removeprefix('region:'))
                assert area['region_receipts'][rid]['state']==t['state']
                if area['termination']!='whole-disk-region-proof':
                    assert radial.hi<=1
                    if t['state']=='FULL':visible=visible+t['area_square']
                    else:blocked=blocked+t['area_square']
        if area['termination']=='whole-disk-region-proof':
            assert len(area['tiles'])==1 and area['state'] in ('FULL','BLOCKED')
        else:
            assert visible.lo==Interval(area['proven_visible_area_lo']).lo
            assert blocked.lo==Interval(area['proven_blocked_area_lo']).lo
            assert Interval(area['visible_fraction_lower']).lo<=(visible/PI).lo
            assert Interval(area['visible_fraction_upper']).hi>=(1-blocked/PI).hi
            assert (area['state']=='PARTIAL')==(visible.lo>0 and blocked.lo>0)
            assert area['visible_fraction']==''
    series=table('environment-timeseries.csv')
    by_area={a['proof_id']:a for a in areas}
    for row in series:
        lo,hi=float(row['visible_fraction_lower']),float(row['visible_fraction_upper'])
        assert 0<=lo<=hi<=1
        if row['disk_area_proof_id']:
            a=by_area[row['disk_area_proof_id']]
            assert row['state']==a['state'] and lo==a['visible_fraction_lower'] and hi==a['visible_fraction_upper']
        if row['state']=='PARTIAL':assert row['visible_fraction']=='' and 0<lo<hi<1
        if row['state']=='FULL':assert lo==hi==1 and float(row['visible_fraction'])==1
        if row['state']=='BLOCKED':assert lo==hi==0 and float(row['visible_fraction'])==0
    for s in report['summaries']:
        assert s['known_hours']+s['unknown_hours']==s['total_hours']
        assert s['exact_fraction_hours']<=s['known_hours']
        assert sum(float(i['duration_hours']) for i in table('environment-intervals.csv') if i['body']==s['body'])==s['total_hours']
    assert not (root/'.environment.lock').exists() and not (root/'.foundation.lock').exists()
    print(f"PASS: {run.name}: {len(proofs)} clearance replays, {len(areas)} complete disk partitions, area witnesses/fractions, source hashes, durations and released locks")


if __name__=='__main__':
    verify(Path(sys.argv[1]).resolve())
