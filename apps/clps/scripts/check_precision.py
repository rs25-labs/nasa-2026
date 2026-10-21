"""Focused sky-certificate and subpixel coverage checks."""
from lunar_lab.bounded_math import Interval
from lunar_lab.clearance_cache import SkyCertificateCache
from lunar_lab.composite_bounds import Node
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.adaptive_witness import certify_circle
from lunar_lab.disk_area import disk_basis
from types import SimpleNamespace
import numpy as np


def check():
    cache=SkyCertificateCache()
    proof=dict(clear=True,proof_id='root-proof',minimum_disk_up_lo='0.1',
               sky_wedge=[['1','1','0','0'],['0','0','1','1']])
    cache.remember(proof)
    assert cache.lookup((Interval('.3','.4'),Interval('.3','.4'),Interval('.2','.3')))['proof_id']=='root-proof'
    assert cache.lookup((Interval('-.1','.2'),Interval('.3','.4'),Interval('.2','.3'))) is None
    assert cache.lookup((Interval('.3','.4'),Interval('.3','.4'),Interval('0','.05'))) is None
    children=Node((2,3,4,5),False).children(minimum_span=1/256)
    assert len(children)==4
    assert sum((b-a)*(d-c) for a,b,c,d in children)==1
    assert len(Node((2,3,4,5),False).children())==1
    cache.remember(dict(proof,proof_id='alias',reuse_of='root-proof'))
    assert len(cache.entries)==1
    terrain=SimpleNamespace(rows=4,cols=4,row_offset=1.5,col_offset=1.5,scale=40,
        radius=1737400,factor=.5,max_lat=-89.998,raw=np.zeros((4,4),dtype=np.int16),
        valid_dn=lambda a:(a>-32768)&(a<32767))
    engine=CompositeClearance(terrain,SimpleNamespace(max_radius_m=1737400,complete=True),
        dict(latitude_deg=-90,longitude_deg=0,observer_radius_m=1737402))
    direction=disk_basis(dict(azimuth_deg=45,center_elevation_deg=-60,angular_radius_deg=1))[0]
    witness=certify_circle(engine,direction,1,2,20,20,.25)
    assert witness['state']=='BLOCKED'
    assert certify_circle(engine,direction,1,2,witness['circle_x_m'],witness['circle_y_m'],witness['circle_radius_m'])==witness
    assert certify_circle(engine,direction,1,2,20,20,25) is None
    terrain.raw[1,2]=-32768
    assert certify_circle(engine,direction,1,2,20,20,.25) is None
    print('PASS: certificate wedge/height inclusion and rejection; subpixel partition preserves source pixel area; legacy split policy retained; adaptive circle receipt replay and invalid geometry rejection')


if __name__=='__main__':check()
