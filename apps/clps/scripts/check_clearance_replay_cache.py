"""Pi regression: unpublished terrain work must not change proof replay."""
from pathlib import Path
import runpy
from types import SimpleNamespace
import numpy as np
from lunar_lab.composite_bounds import CompositeClearance


def check():
    restore=runpy.run_path(str(Path(__file__).with_name('verify_disk_area_artifacts.py')))['restore_terrain_cache']
    radius=1737400
    terrain=SimpleNamespace(rows=4,cols=4,row_offset=1.5,col_offset=1.5,scale=40,
        radius=radius,factor=.5,max_lat=-89.998,raw=np.zeros((4,4),dtype=np.int16),
        valid_dn=lambda a:(a>-32768)&(a<32767))
    global_dem=SimpleNamespace(max_radius_m=radius,complete=True)
    site=dict(latitude_deg=-90,longitude_deg=0,observer_radius_m=radius+2)
    def engine():return CompositeClearance(terrain,global_dem,site,cache_budget=2)
    original=engine()
    # Two unpublished probes fill capacity before a whole-disk proof requests
    # the root. The numerical terrain is unchanged; only allocation state differs.
    original._node(original.root)
    children=original.cache[original.root].children()
    original.cache.clear()
    for box in children[:2]:assert original._node(box) is not None
    disk=dict(azimuth_deg=0,center_elevation_deg=10,angular_radius_deg=1)
    stored=original.prove(disk,node_budget=16)
    assert stored['termination']=='cache-budget' and stored['visited_nodes']==0
    cold=engine().prove(disk,node_budget=16)
    assert (cold['termination'],cold['visited_nodes'])!=(stored['termination'],stored['visited_nodes'])
    inventory=[{k:str(v) for k,v in row.items()} for row in original.node_evidence()]
    warmed=engine();restore(warmed,inventory,2)
    replay=warmed.prove(disk,node_budget=16)
    for name in ('clear','termination','visited_nodes','terminal_nodes'):assert replay[name]==stored[name]
    corrupt=[dict(row) for row in inventory];corrupt[0]['outside_cap']='tampered'
    try:restore(engine(),corrupt,2)
    except AssertionError:pass
    else:raise AssertionError('corrupted enclosure accepted')
    print('PASS: cold replay differs; source-recomputed inventory restores exact cache-limit replay; corrupt evidence rejected')


if __name__=='__main__':check()
