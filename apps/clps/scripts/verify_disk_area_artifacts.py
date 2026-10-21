"""Verify a local environment run's fraction evidence and replay clear proofs.

Usage: PYTHONPATH=apps/clps/api/src .venv/bin/python .../verify_disk_area_artifacts.py RUN
This verifies model/numerical evidence, not physical terrain accuracy.
"""
import csv
import json
import math
from pathlib import Path
import sys

from lunar_lab.assets import digests
from lunar_lab.bounded_math import Interval,PI,basis,dot,sin_cos_degrees
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.disk_area import disk_basis,direction_box
from lunar_lab.global_terrain import GlobalTerrain
from lunar_lab.terrain import PolarTerrain


def restore_terrain_cache(engine,rows,expected_count):
    """Recompute the final geometry inventory, including unpublished misses.

    Failed region traversals populate this cache without publishing a clear
    certificate. Replaying only certificates loses that resource history.
    Preloading the final inventory preserves every original successful node
    lookup and, when full, the original rejected allocations. Enclosures are
    recomputed from source terrain, never trusted from the saved CSV.
    """
    assert not engine.cache
    assert len(rows)==expected_count<=engine.cache_budget
    seen=set();root=engine.root
    for row in rows:
        text=row['node_id'];parts=text.split(':')
        assert len(parts)==4 and text not in seen,'invalid/duplicate terrain node ID'
        box=tuple(float(p) if '.' in p else int(p) for p in parts)
        assert all(math.isfinite(v) for v in box)
        assert root[0]<=box[0]<box[1]<=root[1] and root[2]<=box[2]<box[3]<=root[3]
        node=engine._node(box)
        assert node is not None and node.id==text,'terrain inventory reconstruction failed'
        seen.add(text)
    for actual,saved in zip(engine.node_evidence(),rows):
        assert set(actual)==set(saved),'terrain node schema differs'
        assert all(str(value)==saved[name] for name,value in actual.items()),f"terrain enclosure differs: {saved['node_id']}"
    assert len(engine.cache)==expected_count


def continuation_partitions(area):
    """Validate continuation lineage and return initial/final replay inputs."""
    if area['integrator_id']!='lml-projected-disk-bounds-v8':return [area]
    assert area['refinement_policy']=='unresolved-second-pass-v1'
    assert area['disk_geometry']=={key:float(area[key]) for key in ('azimuth_deg','center_elevation_deg','angular_radius_deg')}
    stages=area['refinement_stages']
    assert 1<=len(stages)<=2
    keys=('visited_tiles','tile_budget','classified_regions','classification_budget',
          'reuse_only_regions','reuse_budget','terrain_visited_nodes','terrain_node_budget','circle_area_strips_used')
    for key in keys:assert sum(s[key] for s in stages)==area[key]
    assert [t for s in stages for t in s['reuse_only_tiles']]==area['reuse_only_tiles']
    for index,stage in enumerate(stages):
        assert stage['pass_kind']==('initial' if index==0 else 'refined')
        limits=(16384,4096,4096,32768,10) if index==0 else (8192,2048,2048,8192,12)
        for actual,budget,limit in zip(('visited_tiles','classified_regions','reuse_only_regions','terrain_visited_nodes'),
                                      ('tile_budget','classification_budget','reuse_budget','terrain_node_budget'),limits):
            assert 0<=stage[actual]<=stage[budget]<=limit
        assert stage['max_depth']<=limits[-1]
        assert 0<=stage['circle_area_strips_used']<=65536
        assert len(set(stage['reuse_only_tiles']))==len(stage['reuse_only_tiles'])==stage['reuse_only_regions']
        assert max(stage['classified_regions'],stage['reuse_only_regions'])<=stage['visited_tiles']
        assert stage['classified_regions']+stage['reuse_only_regions']<=(index+1)*stage['visited_tiles']
    assert stages[-1]['fraction_width_upper']==area['fraction_width_upper']
    if len(stages)==1:
        assert area['pass_kind']=='initial' and 'initial_pass' not in area
        assert area['fraction_width_upper']<=area['tolerance']
        return [area]
    assert area['pass_kind']=='refined'
    first=dict(area['initial_pass'])
    assert first['pass_kind']=='initial' and first['refinement_stages']==stages[:1]
    assert first['disk_geometry']==area['disk_geometry']
    assert first['fraction_width_upper']>first['tolerance']==area['tolerance']
    assert first['visible_fraction_lower']<=area['visible_fraction_lower']
    assert first['visible_fraction_upper']>=area['visible_fraction_upper']
    assert first['horizon_preparation']==area['horizon_preparation']
    assert first['adaptive_bearing_refinement']['attempts']==area['adaptive_bearing_refinement']['attempts'][:len(first['adaptive_bearing_refinement']['attempts'])]
    final_leaves={t['tile_id']:t for t in area['tiles']}
    for leaf in first['tiles']:
        if leaf['state']!='UNKNOWN':assert final_leaves[leaf['tile_id']]==leaf
    first['region_receipts']={key:area['region_receipts'][key] for key in first['region_receipt_ids']}
    for key in ('azimuth_deg','center_elevation_deg','angular_radius_deg'):first[key]=area[key]
    return [first,area]


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
    metadata=report['composite_clearance']
    engine=CompositeClearance(terrain,global_dem,report['site_sample'],cache_budget=metadata['cache_budget'])
    restore_terrain_cache(engine,table('composite-terrain-nodes.csv'),metadata['cached_nodes'])
    proofs=json.loads((run/'composite-clearance-proofs.json').read_text())
    proof_by_id={p['proof_id']:p for p in proofs}
    assert len(proof_by_id)==len(proofs)
    published=set()
    for proof in proofs:
        assert proof['cache_budget']==engine.cache_budget,'proof cache capacity differs from run metadata'
        if proof.get('proof_kind')=='bearing-horizon-wedge':
            replay=engine.prove_wedge(proof['wedge_start_deg'],proof['wedge_end_deg'],
                                      Interval(proof['minimum_disk_up_lo']),node_budget=proof['node_budget'])
            assert replay['sky_wedge']==proof['sky_wedge']
            assert replay['minimum_disk_up_lo']==proof['minimum_disk_up_lo']
            if proof.get('threshold_origin')=='tile-up-v1':
                d=tuple(Interval(a,b) for a,b in proof['refinement_direction'])
                parent_id=proof['refinement_parent']
                assert parent_id in published
                parent=proof_by_id[parent_id]
                assert parent['clear'] and parent['proof_kind']=='bearing-horizon-wedge'
                assert parent['wedge_start_deg']<=proof['wedge_start_deg']<proof['wedge_end_deg']<=parent['wedge_end_deg']
                assert Interval(proof['minimum_disk_up_lo']).lo==d[2].lo<Interval(parent['minimum_disk_up_lo']).lo
                assert all(float(proof[k]*128).is_integer() for k in ('wedge_start_deg','wedge_end_deg'))
                from lunar_lab.bearing_horizon import wedge_normals
                assert all(dot(n,d).lo>0 for n in wedge_normals(proof['wedge_start_deg'],proof['wedge_end_deg']))
                from lunar_lab.adaptive_witness import certify_circle
                w=proof['obstruction_floor_witness']
                checked=certify_circle(engine,(d[0],d[1],Interval(-1)),w['row'],w['col'],w['circle_x_m'],w['circle_y_m'],w['circle_radius_m'])
                assert checked==w and Interval(w['elevation_sine_lower_lo']).lo==Interval(proof['refinement_floor']).lo<d[2].lo
            else:
                assert sin_cos_degrees(proof['proposed_elevation_deg'])[0].lo==Interval(proof['minimum_disk_up_lo']).lo
            engine.sky_cache.remember(dict(replay,proof_id=proof['proof_id']))
        elif proof.get('proof_kind')=='projected-disk-region':
            d=tuple(Interval(a,b) for a,b in proof['region_direction'])
            replay=engine.prove_region(d,node_budget=proof['node_budget'],minimum_span=proof.get('minimum_polar_span',1),
                                      use_cache='cache_policy' in proof,use_union=proof.get('cache_policy')=='sky-certificate-v2',legacy_wedge=proof.get('region_wedge_policy','legacy-v1')=='legacy-v1')
            if proof.get('reuse_of'):
                assert proof['reuse_of'] in published and proof_by_id[proof['reuse_of']]['clear']
                assert replay.get('reuse_of')==proof['reuse_of']
            if proof.get('reuse_of_all'):
                assert len(proof['reuse_of_all'])>=2
                assert all(p in published and proof_by_id[p]['clear'] for p in proof['reuse_of_all'])
                assert replay.get('reuse_of_all')==proof['reuse_of_all']
            if 'cache_policy' in proof:
                assert replay.get('sky_wedge')==proof.get('sky_wedge')
                assert replay['minimum_disk_up_lo']==proof['minimum_disk_up_lo']
                engine.sky_cache.remember(dict(replay,proof_id=proof['proof_id']))
        else:
            replay=engine.prove(proof,node_budget=proof['node_budget'],minimum_span=proof.get('minimum_polar_span',1))
        context=f"{proof['proof_id']}: stored {proof['clear']}/{proof['termination']}, replay {replay['clear']}/{replay['termination']}"
        assert replay['clear']==proof['clear'] and replay['termination']==proof['termination'],context
        assert replay['terminal_nodes']==proof['terminal_nodes'],context+'; terminal nodes differ'
        assert replay['visited_nodes']==proof['visited_nodes'],context+'; visited nodes differ'
        assert len(engine.cache)==metadata['cached_nodes'],context+'; replay allocated a node absent from saved inventory'
        published.add(proof['proof_id'])
    cells={r['cell_id']:r for r in table('terrain-cell-enclosures.csv')}
    witnesses={}
    east,north,up=basis(report['site_sample']['latitude_deg'],report['site_sample']['longitude_deg'])
    areas=json.loads((run/'projected-disk-area-proofs.json').read_text())
    def tile_box(prefix):
        box=(-1.,1.,-1.,1.)
        for digit in prefix:
            assert digit in '0123'
            x0,x1,y0,y1=box;xm,ym=(x0+x1)/2,(y0+y1)/2
            box=((x0,xm,y0,ym),(xm,x1,y0,ym),(x0,xm,ym,y1),(xm,x1,ym,y1))[int(digit)]
        return box
    partitions=[part for area in areas for part in continuation_partitions(area)]
    for area in partitions:
        v8=area['integrator_id']=='lml-projected-disk-bounds-v8'
        refined=v8 and area.get('pass_kind')=='refined'
        frame=disk_basis(area)
        adaptive=area.get('adaptive_bearing_refinement')
        adaptive_visits=0
        if adaptive:
            attempts=[proof_by_id[p] for p in adaptive['attempts']]
            assert len(set(adaptive['attempts']))==len(attempts)<=adaptive['attempt_limit']<=128
            skips=adaptive.get('skipped',[])
            if adaptive.get('policy')=='witness-gated-dyadic-v2':
                assert area['integrator_id']=='lml-projected-disk-bounds-v5'
                assert len(skips)<=adaptive['skip_limit']<=4096
            else:
                assert not skips
            for skipped in skips:
                assert skipped['criterion']=='same-wedge-lower-threshold-unresolved'
                count=skipped['after_attempt_count']
                assert isinstance(count,int) and 0<count<=len(attempts)
                assert skipped['previous_attempt'] in adaptive['attempts'][:count]
                previous=proof_by_id[skipped['previous_attempt']]
                assert not previous['clear'] and previous['threshold_origin']=='tile-up-v1'
                assert (previous['wedge_start_deg'],previous['wedge_end_deg'])==(
                    skipped['wedge_start_deg'],skipped['wedge_end_deg'])
                assert 4<=len(skipped['tile_id'])<=area['max_depth']
                direction=direction_box(frame,tile_box(skipped['tile_id']))
                assert skipped['direction']==[[str(d.lo),str(d.hi)] for d in direction]
                assert direction[2].lo<=Interval(previous['minimum_disk_up_lo']).lo
                from lunar_lab.bearing_horizon import wedge_normals
                assert all(dot(n,direction).lo>0 for n in wedge_normals(
                    skipped['wedge_start_deg'],skipped['wedge_end_deg']))
            assert all(p['threshold_origin']=='tile-up-v1' and p['node_budget']<=512 for p in attempts)
            adaptive_visits=sum(p['visited_nodes'] for p in attempts)
            assert adaptive_visits==adaptive['visited_nodes']
            for proof in attempts:
                d=direction_box(frame,tile_box(proof['refinement_tile_id']))
                assert proof['refinement_direction']==[[str(a.lo),str(a.hi)] for a in d]
        prep=area.get('horizon_preparation')
        if prep:
            assert prep['visited_nodes']<=area['terrain_visited_nodes']<=area['terrain_node_budget']<=(40960 if refined else 32768)
            assert prep['node_budget']<=min(8192,area['terrain_node_budget']//2)
            attempts=[proof_by_id[p] for p in prep['attempts']]
            assert len(attempts)<=64 and len(set(prep['attempts']))==len(attempts)
            assert all(p['proof_kind']=='bearing-horizon-wedge' and p['node_budget']<=512 for p in attempts)
            assert sum(p['visited_nodes'] for p in attempts)==prep['visited_nodes']<=prep['node_budget']<=8192
            if 'bearing_bins' in prep:
                certified={int(round(p['wedge_start_deg']*8)) for p in attempts if p['clear']}
                assert certified==set(prep['certified_bins'])
                assert prep['coverage_complete']==(bool(prep['bearing_bins']) and set(prep['bearing_bins'])==certified)
            if prep['fallback_policy']=='certificates-only':
                if 'bearing_bins' in prep:assert prep['coverage_complete']
                assert any(p['clear'] for p in attempts)
                assert area['terrain_visited_nodes']==prep['visited_nodes']
            elif prep['fallback_policy']=='adaptive-bearing-refinement':
                assert prep['coverage_complete'] and adaptive is not None
                assert area['terrain_visited_nodes']==prep['visited_nodes']+adaptive_visits
            else:
                assert prep['fallback_policy']=='bounded-region-traversal' and adaptive_visits==0
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
        reuse_tiles=set(area.get('reuse_only_tiles',[]))
        if area['integrator_id']=='lml-projected-disk-bounds-v7' or v8:
            assert len(area['reuse_only_tiles'])==area['reuse_only_regions']<=area['reuse_budget']<=(6144 if refined else 4096)
            if not refined:assert len(reuse_tiles)==len(area['reuse_only_tiles'])
            assert area['classified_regions']<=area['classification_budget']<=(6144 if refined else 4096)
            assert max(area['classified_regions'],area['reuse_only_regions'])<=area['visited_tiles']<=area['tile_budget']<=(24576 if refined else 16384)
            if not refined:assert area['classified_regions']+area['reuse_only_regions']<=area['visited_tiles']
            prefixes={tile[:depth] for tile in leaves for depth in range(len(tile)+1)}
            assert reuse_tiles<=prefixes
        frame=disk_basis(area)
        for rid,receipt in area['region_receipts'].items():
            prefix=rid.removeprefix('region:');box=(-1.,1.,-1.,1.)
            for digit in prefix:
                x0,x1,y0,y1=box;xm,ym=(x0+x1)/2,(y0+y1)/2
                box=((x0,xm,y0,ym),(xm,x1,y0,ym),(x0,xm,ym,y1),(xm,x1,ym,y1))[int(digit)]
            d=direction_box(frame,box)
            if receipt.get('reuse_only'):
                assert area['integrator_id'] in ('lml-projected-disk-bounds-v7','lml-projected-disk-bounds-v8') and prefix in reuse_tiles
            if receipt['state']=='FULL':
                p=proof_by_id[receipt['clearance_proof_id']]
                assert p['clear'] and p['region_direction']==[[str(a.lo),str(a.hi)] for a in d]
                if receipt.get('reuse_only'):
                    assert p['visited_nodes']==0 and (p.get('reuse_of') or p.get('reuse_of_all'))
            elif receipt.get('witness_kind')=='adaptive-cell-circle':
                from lunar_lab.adaptive_witness import certify_circle
                checked=certify_circle(engine,d,receipt['row'],receipt['col'],
                    receipt['circle_x_m'],receipt['circle_y_m'],receipt['circle_radius_m'])
                assert checked=={key:value for key,value in receipt.items() if key!='reuse_only'}
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
        circle_strips=0
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
                    if t['criterion']=='disk-clipped-area-lower-bound':
                        from lunar_lab.circle_area import clipped_area_lower,STRIPS_PER_TILE
                        assert area['integrator_id'] in ('lml-projected-disk-bounds-v6','lml-projected-disk-bounds-v7','lml-projected-disk-bounds-v8')
                        assert area['circle_area_policy']=='concave-strip-lower-v1'
                        assert radial.lo<=1<radial.hi
                        assert t['area_strips']==STRIPS_PER_TILE
                        circle_strips+=t['area_strips']
                        lower=clipped_area_lower(t['box'],strips=t['area_strips'])
                        assert lower==Interval(t['clipped_area_lower']).lo
                        assert 0<=lower<=t['area_square']
                        amount=Interval(lower)
                    else:
                        assert t['criterion']=='inside-disk-square' and radial.hi<=1
                        amount=Interval(t['area_square'])
                    if t['state']=='FULL':visible=visible+amount
                    else:blocked=blocked+amount
        if area['integrator_id'] in ('lml-projected-disk-bounds-v6','lml-projected-disk-bounds-v7','lml-projected-disk-bounds-v8'):
            assert area['circle_area_policy']=='concave-strip-lower-v1'
            assert circle_strips==area['circle_area_strips_used']<=area['circle_area_strip_budget']==65536
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
    print(f"PASS: {run.name}: {len(proofs)} clearance replays, {len(partitions)} complete disk partitions, area witnesses/fractions, source hashes, durations and released locks")


if __name__=='__main__':
    verify(Path(sys.argv[1]).resolve())
