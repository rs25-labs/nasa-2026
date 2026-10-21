"""Small analytic continuation checks; no NASA data or downloads."""
from lunar_lab.disk_refinement import integrate_refined_disk


class Quadrants:
    def __init__(self):
        self.initial_budget=self.remaining=10
        self.calls=[]
        self.adaptive_refinement=dict(attempts=[])
        self.reuse_witnesses=None
    def prepare(self,row):
        self.preparations=getattr(self,'preparations',0)+1
        return None
    def classify(self,direction,tile_id):
        self.calls.append(tile_id);self.remaining-=1
        self.adaptive_refinement['attempts'].append(tile_id)
        state='UNKNOWN' if not tile_id else ('FULL' if tile_id[0] in '23' else 'BLOCKED')
        return dict(state=state,evidence_id='analytic:'+tile_id)
    def classify_reuse(self,direction,tile_id):
        return dict(state='UNKNOWN')


def check():
    row=dict(azimuth_deg=45,center_elevation_deg=0,angular_radius_deg=1)
    prover=Quadrants()
    area=integrate_refined_disk(row,prover,_initial_options=dict(tile_budget=2,classification_budget=2,reuse_budget=0))
    first=area['initial_pass']
    assert first['fraction_width_upper']>.01 and area['fraction_width_upper']<=.01
    assert area['visible_fraction_lower']>=first['visible_fraction_lower']
    assert area['visible_fraction_upper']<=first['visible_fraction_upper']
    retained=next(t for t in first['tiles'] if t['tile_id']=='0')
    assert next(t for t in area['tiles'] if t['tile_id']=='0')==retained
    assert area['region_receipts']['region:0']['evidence_id']=='analytic:0'
    assert prover.calls.count('')==1 and prover.calls.count('0')==1
    assert prover.preparations==1 and first['terrain_node_budget']==10
    assert first['adaptive_bearing_refinement']['attempts']==['','0']
    assert area['adaptive_bearing_refinement']['attempts']==prover.calls
    assert len(area['refinement_stages'])==2
    for key in ('visited_tiles','classified_regions','reuse_only_regions','terrain_visited_nodes'):
        assert sum(stage[key] for stage in area['refinement_stages'])==area[key]
    assert sum(t['area_square'] for t in area['tiles'])==4
    assert all(stage['visited_tiles']<=stage['tile_budget'] for stage in area['refinement_stages'])
    assert first['region_receipt_ids']==['region:0']
    assert prover.initial_budget==8202 and area['terrain_visited_nodes']==len(prover.calls)
    early=Quadrants()
    early.classify=lambda direction,tile_id:dict(state='FULL',evidence_id='analytic-whole')
    complete=integrate_refined_disk(row,early)
    assert complete['state']=='FULL' and 'initial_pass' not in complete
    assert len(complete['refinement_stages'])==1 and early.initial_budget==10
    print('PASS: unresolved-only continuation, retained proof/area, nested bounds, exact work and early success')


if __name__=='__main__':check()
