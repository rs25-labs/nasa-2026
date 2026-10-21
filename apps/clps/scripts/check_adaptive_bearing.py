"""Focused analytic checks for targeted bearing work and stronger witnesses."""
from types import SimpleNamespace
import numpy as np
from lunar_lab.bounded_math import Interval
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.disk_area import disk_basis,TerrainTileProver
from lunar_lab.adaptive_witness import certify_circle,propose_witness


def check():
    t=SimpleNamespace(rows=4,cols=4,row_offset=1.5,col_offset=1.5,scale=40,
        radius=1737400,factor=.5,max_lat=-89.998,raw=np.zeros((4,4),dtype=np.int16),
        valid_dn=lambda a:(a>-32768)&(a<32767))
    engine=CompositeClearance(t,SimpleNamespace(max_radius_m=1737400,complete=True),
        dict(latitude_deg=-90,longitude_deg=0,observer_radius_m=1737402))
    engine.band_envelope=[];engine.band_sine_upper=Interval('-.5').hi
    d=disk_basis(dict(azimuth_deg=45,center_elevation_deg=-60,angular_radius_deg=.1))[0]
    center=certify_circle(engine,d,1,2,20,20,.25)
    edge=propose_witness(engine,d,'1:2:2:3',{})
    assert Interval(edge['elevation_sine_lower_lo']).lo>Interval(center['elevation_sine_lower_lo']).lo, 'refine the source pixel along its bearing'
    saturated={f'old-{i}':None for i in range(4096)}
    assert propose_witness(engine,d,'1:2:2:3',saturated) is not None
    assert len(saturated)==4096 and 'old-0' not in saturated, 'a full cache must accept current geometry'
    from lunar_lab.bearing_refinement import refine_bearing
    parent=engine.prove_wedge(44,46,Interval('.2'),node_budget=512)
    parent.update(proof_id='analytic-parent',proof_kind='bearing-horizon-wedge')
    engine.proofs.append(parent);engine.sky_cache.remember(parent)
    prover=TerrainTileProver([],engine,terrain_node_budget=2048);prover.has_horizon_bank=True
    d=disk_basis(dict(azimuth_deg=45.04,center_elevation_deg=5,angular_radius_deg=.1))[0]
    proof=refine_bearing(prover,d,'0000',Interval(0).lo)
    assert proof['clear'] and proof['refinement_parent']=='analytic-parent'
    assert prover.remaining==2048-proof['visited_nodes']
    assert engine.sky_cache.lookup(d)['proof_id']==proof['proof_id']
    lower=disk_basis(dict(azimuth_deg=45.04,center_elevation_deg=4,angular_radius_deg=.1))[0]
    tighter=refine_bearing(prover,lower,'0010',Interval(0).lo)
    assert tighter is not None and tighter['clear'] and tighter['refinement_parent']==proof['proof_id']
    wrap=engine.prove_wedge(359,361,Interval('.2'),node_budget=512)
    wrap.update(proof_id='wrapped-parent',proof_kind='bearing-horizon-wedge')
    engine.proofs.append(wrap);engine.sky_cache.remember(wrap)
    north=disk_basis(dict(azimuth_deg=.04,center_elevation_deg=5,angular_radius_deg=.1))[0]
    assert refine_bearing(prover,north,'0011',Interval(0).lo)['clear']
    # Adjacent closed certificates jointly cover a tile crossing their seam.
    from lunar_lab.clearance_cache import SkyCertificateCache
    bank=SkyCertificateCache()
    for i,(start,end) in enumerate(((44,45),(45,46))):
        p=engine.prove_wedge(start,end,Interval('.01'),node_budget=512)
        bank.remember(dict(p,proof_id=f'seam-{i}'))
    seam=disk_basis(dict(azimuth_deg=45,center_elevation_deg=5,angular_radius_deg=.1))[0]
    assert bank.lookup(seam) is None
    assert bank.lookup_union(seam)['reuse_of_all']==['seam-0','seam-1']
    low=disk_basis(dict(azimuth_deg=45,center_elevation_deg=-5,angular_radius_deg=.1))[0]
    assert bank.lookup_union(low) is None
    bank=SkyCertificateCache()
    for i,(start,end) in enumerate(((44,44.875),(45.125,46))):
        p=engine.prove_wedge(start,end,Interval('.01'),node_budget=512)
        bank.remember(dict(p,proof_id=f'gap-{i}'))
    assert bank.lookup_union(seam) is None
    used=prover.remaining
    assert refine_bearing(prover,d,'0001',Interval('.9').lo) is None
    assert prover.remaining==used
    prover.remaining=0
    assert refine_bearing(prover,d,'0002',Interval(0).lo) is None
    # Failed traversal is scheduling information only, never obstruction.
    def failed_wedge(start,end,minimum,node_budget):
        return dict(clear=False,visited_nodes=17,wedge_start_deg=start,wedge_end_deg=end,
                    minimum_disk_up_lo=str(minimum.lo))
    failed_engine=SimpleNamespace(proofs=[dict(proof_id='parent',proof_kind='bearing-horizon-wedge',
        wedge_start_deg=44,wedge_end_deg=46)],
        sky_cache=SimpleNamespace(lookup=lambda direction:dict(minimum=Interval('.2').lo,proof_id='parent'),
                                 remember=lambda proof:None),prove_wedge=failed_wedge)
    scheduled=TerrainTileProver([],failed_engine,terrain_node_budget=2048)
    scheduled.has_horizon_bank=True
    first=refine_bearing(scheduled,d,'0000',Interval(0).lo)
    remaining=scheduled.remaining
    assert first is not None and not first['clear']
    assert refine_bearing(scheduled,lower,'0001',Interval(0).lo) is None
    assert scheduled.remaining==remaining and len(scheduled.adaptive_refinement['attempts'])==1
    skipped=scheduled.adaptive_refinement['skipped'][0]
    assert skipped['previous_attempt']==first['proof_id'] and skipped['after_attempt_count']==1
    assert skipped['criterion']=='same-wedge-lower-threshold-unresolved'
    assert refine_bearing(scheduled,d,'0002',Interval(0).lo) is None
    higher=disk_basis(dict(azimuth_deg=45.04,center_elevation_deg=6,angular_radius_deg=.1))[0]
    assert refine_bearing(scheduled,higher,'0003',Interval(0).lo) is not None
    assert scheduled.remaining==remaining-17
    changed=disk_basis(dict(azimuth_deg=45.08,center_elevation_deg=4,angular_radius_deg=.1))[0]
    assert refine_bearing(scheduled,changed,'0010',Interval(0).lo) is not None
    fresh=TerrainTileProver([],failed_engine,terrain_node_budget=2048,prepared=scheduled);fresh.has_horizon_bank=True
    assert refine_bearing(fresh,lower,'0004',Interval(0).lo) is not None
    print('PASS: stronger witness, parent/reuse, shared work, zero-work rejection, failed-attempt scheduling and sample isolation')


if __name__=='__main__':check()
