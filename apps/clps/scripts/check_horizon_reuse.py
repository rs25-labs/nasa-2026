"""Focused analytic checks for complete bearing certificates."""
from types import SimpleNamespace
import numpy as np
from lunar_lab.bounded_math import Interval
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.disk_area import disk_basis,direction_box,TerrainTileProver
from lunar_lab.adaptive_witness import certify_circle
from lunar_lab.environment import build_timeseries
from lunar_lab.bearing_horizon import prepare_horizon,bearing_wedge


def check():
    t=SimpleNamespace(rows=4,cols=4,row_offset=1.5,col_offset=1.5,scale=40,
        radius=1737400,factor=.5,max_lat=-89.998,raw=np.zeros((4,4),dtype=np.int16),
        valid_dn=lambda a:(a>-32768)&(a<32767))
    engine=CompositeClearance(t,SimpleNamespace(max_radius_m=1737400,complete=True),
        dict(latitude_deg=-90,longitude_deg=0,observer_radius_m=1737402))
    # Analytic exterior premise isolates the polar geometry in this tiny fixture.
    engine.band_envelope=[];engine.band_sine_upper=Interval('-.5').hi
    box=direction_box(disk_basis(dict(azimuth_deg=45,center_elevation_deg=-60,angular_radius_deg=.1)),(-1.,1.,-1.,1.))
    receipt=certify_circle(engine,box,1,2,20,20,.25)
    assert receipt is not None and 'bearing_sector_deg' in receipt
    opposite=tuple(-a if i<2 else a for i,a in enumerate(box))
    assert certify_circle(engine,opposite,1,2,20,20,.25) is None
    proof=engine.prove_wedge(44,46,Interval('.1'),node_budget=512)
    assert proof['clear']
    engine.sky_cache.remember(dict(proof,proof_id='analytic-wedge'))
    d=disk_basis(dict(azimuth_deg=45,center_elevation_deg=30,angular_radius_deg=1))[0]
    assert engine.sky_cache.lookup(d)['proof_id']=='analytic-wedge'
    assert bearing_wedge(d) is not None
    wrong=disk_basis(dict(azimuth_deg=90,center_elevation_deg=30,angular_radius_deg=1))[0]
    assert engine.sky_cache.lookup(wrong) is None
    assert not engine.prove_wedge(44,46,Interval('.1'),node_budget=0)['clear']
    row=dict(site_id='analytic',utc='2026-11-24T03:00:00Z',body='SUN',
             azimuth_deg=45,center_elevation_deg=-60,angular_radius_deg=.1)
    # Geometry rows have no diagnostic seed: the environment join must supply it.
    build_timeseries([row],[dict(azimuth_deg=45,horizon_elevation_deg=-60,status='INDETERMINATE')],
                     clearance=engine,cell_evidence=[])
    assert engine.area_proofs[-1]['horizon_preparation']['attempts'], 'environment omitted diagnostic proposal seed'
    far=TerrainTileProver([],engine)
    assert not far.prepare(dict(azimuth_deg=45,center_elevation_deg=30,
        angular_radius_deg=1,horizon_elevation_deg=0))['attempts'], 'skip work far from the proposed transition'
    partial=TerrainTileProver([],engine,terrain_node_budget=512)
    partial.prepare(dict(azimuth_deg=45,center_elevation_deg=0,angular_radius_deg=2,horizon_elevation_deg=0))
    assert not partial.has_horizon_bank, 'partial bearing coverage must retain traversal fallback'
    t.raw[:]=-32768
    missing=CompositeClearance(t,engine.global_terrain,engine.site)
    missing.band_envelope=[];missing.band_sine_upper=Interval('-.5').hi
    assert not missing.prove_wedge(44,46,Interval('.1'),node_budget=512)['clear']
    holder=SimpleNamespace(clearance=engine,remaining=0)
    assert prepare_horizon(holder,dict(azimuth_deg=45,horizon_elevation_deg=0))['visited_nodes']==0
    print('PASS: complete wedge reuse/inclusion, zero work and missing terrain rejection')


if __name__=='__main__':check()
