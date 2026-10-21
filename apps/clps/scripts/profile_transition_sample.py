"""Replay the fixed measured Sun transition without rebuilding diagnostics.

No asset downloads, parameter search or synthetic terrain. Full pipeline
verification remains a separate final one-day run.
"""
import csv
import json
from pathlib import Path
import time

from lunar_lab.terrain import PolarTerrain
from lunar_lab.global_terrain import GlobalTerrain
from lunar_lab.composite_bounds import CompositeClearance
from lunar_lab.disk_area import TerrainTileProver,integrate_disk


def main():
    root=Path('data/local/lml')
    run=root/'env-runs/20261020T195032Z-7764e707'
    report=json.loads((run/'environment-report.json').read_text())
    terrain=PolarTerrain(root/'assets/ldem_85s_40m.lbl',root/'assets/ldem_85s_40m.img')
    engine=CompositeClearance(terrain,GlobalTerrain(root/'assets/ldem_16.lbl',root/'assets/ldem_16.img'),report['site_sample'])
    with (run/'terrain-cell-enclosures.csv').open() as f:cells=list(csv.DictReader(f))
    for cell in cells:
        cell['inner_circle_within_nominal_cap']=cell['inner_circle_within_nominal_cap']=='True'
        cell['inner_cap_elevation_lower_deg']=float(cell['inner_cap_elevation_lower_deg'])
    with (run/'environment-timeseries.csv').open() as f:
        row=next(a for a in csv.DictReader(f) if a['body']=='SUN' and a['utc']=='2026-11-24T03:00:00Z')
    prover=TerrainTileProver(cells,engine)
    began=time.perf_counter();area=integrate_disk(row,prover)
    print(json.dumps({k:v for k,v in area.items() if k not in ('tiles','region_receipts')},indent=2))
    print(json.dumps(dict(seconds=time.perf_counter()-began,terrain_nodes=prover.initial_budget-prover.remaining,
                         sky_hits=engine.sky_cache.hits,sky_entries=len(engine.sky_cache.entries),
                         cached_nodes=len(engine.cache),region_proofs=len(engine.proofs),
                         adaptive_witnesses=sum(r.get('witness_kind')=='adaptive-cell-circle' for r in area['region_receipts'].values())),indent=2))


if __name__=='__main__':main()
