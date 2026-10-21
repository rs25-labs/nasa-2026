"""Focused checks for evidence reuse after full classification work is spent."""
from lunar_lab.disk_area import integrate_disk,TerrainTileProver,disk_basis
from lunar_lab.bounded_math import Interval


def check():
    class ReuseOnly:
        def classify(self,direction,tile_id):
            raise AssertionError('full classification budget is zero')
        def classify_reuse(self,direction,tile_id):
            up=direction[2]
            return dict(state='FULL' if up.lo>0 else 'BLOCKED' if up.hi<0 else 'UNKNOWN')
    row=dict(azimuth_deg=45,center_elevation_deg=0,angular_radius_deg=1)
    area=integrate_disk(row,ReuseOnly(),classification_budget=0,reuse_budget=4096)
    assert area['classified_regions']==0 and 0<area['reuse_only_regions']<=4096
    assert area['visible_fraction_lower']<=.5<=area['visible_fraction_upper']
    assert area['fraction_width_upper']<=.01 and area['state']=='PARTIAL'
    zero=integrate_disk(row,ReuseOnly(),classification_budget=0,reuse_budget=0)
    assert zero['reuse_only_regions']==0 and zero['state']=='UNKNOWN'
    assert zero['visible_fraction_lower']==0 and zero['visible_fraction_upper']==1
    limited=integrate_disk(row,ReuseOnly(),classification_budget=0,reuse_budget=1)
    assert limited['reuse_only_regions']==1 and limited['state']=='UNKNOWN'

    # Real interval-certified cached circle; any new proposal/traversal fails.
    from types import SimpleNamespace
    import numpy as np
    from lunar_lab.composite_bounds import CompositeClearance
    from lunar_lab.adaptive_witness import circle_geometry
    terrain=SimpleNamespace(rows=4,cols=4,row_offset=1.5,col_offset=1.5,scale=40,
        radius=1737400,factor=.5,max_lat=-89.998,raw=np.zeros((4,4),dtype=np.int16),
        valid_dn=lambda a:(a>-32768)&(a<32767))
    engine=CompositeClearance(terrain,SimpleNamespace(max_radius_m=1737400,complete=True),
        dict(latitude_deg=-90,longitude_deg=0,observer_radius_m=1737402))
    geometry=circle_geometry(engine,1,2,20,20,.25)
    assert geometry is not None
    prover=TerrainTileProver([],engine,terrain_node_budget=0)
    prover.adaptive_cache['existing']=geometry
    def no_traversal(*args,**kwargs):raise AssertionError('reuse attempted new terrain work')
    engine.prove_wedge=no_traversal
    engine.prove_region=no_traversal
    blocked=disk_basis(dict(azimuth_deg=45,center_elevation_deg=-60,angular_radius_deg=.1))[0]
    import lunar_lab.adaptive_witness as witness
    saved_geometry,saved_proposal=witness.circle_geometry,witness.propose_witness
    try:
        witness.circle_geometry=witness.propose_witness=no_traversal
        result=prover.classify_reuse(blocked,'0000')
        assert result['state']=='BLOCKED' and result['witness_kind']=='adaptive-cell-circle'
        opposite=disk_basis(dict(azimuth_deg=225,center_elevation_deg=-60,angular_radius_deg=.1))[0]
        assert prover.classify_reuse(opposite,'0001')['state']=='UNKNOWN'
        high=disk_basis(dict(azimuth_deg=45,center_elevation_deg=60,angular_radius_deg=.1))[0]
        assert prover.classify_reuse(high,'0002')['state']=='UNKNOWN'
    finally:
        witness.circle_geometry,witness.propose_witness=saved_geometry,saved_proposal
    assert prover.remaining==0 and prover.adaptive_refinement['attempts']==[]
    assert len(prover.adaptive_cache)==1 and engine.proofs==[]
    print('PASS: reuse-only limits, half disk, cached circle, wrong bearing/elevation and no traversal')


if __name__=='__main__':check()
