"""Focused analytic checks for the bounded disk-area method."""
from lunar_lab.disk_area import integrate_disk
from lunar_lab.bounded_math import Interval,PI


class HalfPlane:
    def classify(self, direction, tile_id):
        up = direction[2]
        state = 'FULL' if up.lo > 0 else 'BLOCKED' if up.hi < 0 else 'UNKNOWN'
        return dict(state=state, evidence_id='analytic-equatorial-half-plane')


class Missing:
    def classify(self, direction, tile_id):
        return dict(state='UNKNOWN', evidence_id='no-data')


def check():
    from lunar_lab.circle_area import clipped_area_lower
    quarter=clipped_area_lower((0.,1.,0.,1.))
    assert PI.lo/4-Interval('.0001').lo<quarter<=PI.hi/4
    assert clipped_area_lower((.875,1.,.875,1.))==0
    assert clipped_area_lower((-.25,.25,-.25,.25))==Interval('.25').lo
    assert abs(quarter-clipped_area_lower((-1.,0.,0.,1.)))<Interval('1e-45').lo
    assert abs(quarter-clipped_area_lower((0.,1.,-1.,0.)))<Interval('1e-45').lo
    assert quarter>=clipped_area_lower((0.,1.,0.,1.),strips=128)
    for box,strips in [((0.,1.,0.,1.),3),((0.,1.,0.,1.),512),
                       ((0.,2.,0.,1.),256),((0.,.1,0.,1.),256)]:
        try:clipped_area_lower(box,strips=strips)
        except ValueError:pass
        else:raise AssertionError('invalid clipped-area grid accepted')
    row = dict(azimuth_deg=359.9, center_elevation_deg=0, angular_radius_deg=1)
    coarse = integrate_disk(row, HalfPlane(), tile_budget=256)
    fine = integrate_disk(row, HalfPlane(), tile_budget=4096)
    assert fine['state'] == 'PARTIAL'
    assert fine['visible_fraction'] == ''
    assert fine['visible_fraction_lower'] <= .5 <= fine['visible_fraction_upper']
    assert fine['visible_fraction_upper']-fine['visible_fraction_lower'] < .08
    assert coarse['visible_fraction_lower'] <= fine['visible_fraction_lower']
    assert fine['visible_fraction_upper'] <= coarse['visible_fraction_upper']
    unknown = integrate_disk(row, Missing(), tile_budget=32)
    zero = integrate_disk(row, HalfPlane(), tile_budget=0)
    for p in (unknown, zero):
        assert p['state'] == 'UNKNOWN'
        assert p['visible_fraction_lower'] == 0 and p['visible_fraction_upper'] == 1
    assert sum(t['area_square'] for t in fine['tiles']) == 4
    for t in fine['tiles']:
        if t['state'] not in ('FULL','BLOCKED'):
            continue
        x0,x1,y0,y1=t['box']
        if t['criterion']=='disk-clipped-area-lower-bound':
            assert Interval(t['clipped_area_lower']).lo==clipped_area_lower(t['box'],strips=t['area_strips'])
        else:
            assert max(x0*x0,x1*x1)+max(y0*y0,y1*y1)<=1
        assert y0>0 if t['state']=='FULL' else y1<0
        rid=t['evidence']['region_id']
        assert t['tile_id'].startswith(rid.removeprefix('region:'))
        assert rid in fine['region_receipts']
    default=integrate_disk(row,HalfPlane())
    assert default['fraction_width_upper']<=.01 and default['termination']=='fraction-width-target'
    assert default['circle_area_strips_used']<=default['circle_area_strip_budget']
    # A proof on a quadrant crossing the circle must contribute immediately,
    # without spending tiles subdividing an already classified region.
    class Quadrants:
        def classify(self,direction,tile_id):
            return dict(state='UNKNOWN' if not tile_id else ('FULL' if tile_id in ('2','3') else 'BLOCKED'))
    limited=integrate_disk(row,Quadrants(),tile_budget=2)
    assert Interval(limited['proven_blocked_area_lo']).lo>0
    assert any(t['criterion']=='disk-clipped-area-lower-bound' for t in limited['tiles'])
    import lunar_lab.disk_area as disk_area
    saved_budget=disk_area.STRIP_BUDGET
    try:
        disk_area.STRIP_BUDGET=0
        queued=integrate_disk(row,Quadrants(),tile_budget=3)
        assert queued['visited_tiles']==3 and queued['classified_regions']==3
        assert queued['circle_area_strips_used']==0
        assert Interval(queued['proven_blocked_area_lo']).lo>0, 'queued inherited interior proofs must retain area'
        assert 'circle-area-strip-budget' in queued['limits_reached']
    finally:
        disk_area.STRIP_BUDGET=saved_budget
    print('PASS: analytic half disk, non-collapsed scalar, nested bounds, missing data, zero budget and root partition')


if __name__ == '__main__':
    check()
