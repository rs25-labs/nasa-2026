"""Focused analytic checks for the bounded disk-area method."""
from lunar_lab.disk_area import integrate_disk


class HalfPlane:
    def classify(self, direction, tile_id):
        up = direction[2]
        state = 'FULL' if up.lo > 0 else 'BLOCKED' if up.hi < 0 else 'UNKNOWN'
        return dict(state=state, evidence_id='analytic-equatorial-half-plane')


class Missing:
    def classify(self, direction, tile_id):
        return dict(state='UNKNOWN', evidence_id='no-data')


def check():
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
        assert max(x0*x0,x1*x1)+max(y0*y0,y1*y1)<=1
        assert y0>0 if t['state']=='FULL' else y1<0
        rid=t['evidence']['region_id']
        assert t['tile_id'].startswith(rid.removeprefix('region:'))
        assert rid in fine['region_receipts']
    default=integrate_disk(row,HalfPlane())
    assert default['fraction_width_upper']<=.01 and default['termination']=='fraction-width-target'
    print('PASS: analytic half disk, non-collapsed scalar, nested bounds, missing data, zero budget and root partition')


if __name__ == '__main__':
    check()
