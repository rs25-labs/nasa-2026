"""Pi check: catalog shape, leap dates, chunk seams, gaps and UNKNOWN duration."""
from datetime import timedelta
from pathlib import Path
from lunar_lab.site_catalog import load_catalog
from lunar_lab.site_archive import chunks,utc
from lunar_lab.site_archive_summary import join_chunks,summarize_site


def check():
    repo=Path(__file__).resolve().parents[3]
    sites=load_catalog(repo/'data/manifests/clps/landing-candidates.csv')
    assert len(sites)==50 and sum(s['kind']=='published-candidate' for s in sites)==20
    full=list(chunks(utc('2026-01-01T00:00Z'),utc('2029-01-01T00:00Z'),30))
    assert len(full)==37 and sum((b-a).days for a,b in full)==1096
    start=utc('2028-02-28T00:00Z');end=start+timedelta(days=2)
    parts=[]
    for index,(a,b) in enumerate(chunks(start,end,1)):
        request=dict(site_id='check',start_utc=a.isoformat(),days=1)
        rows=[]
        for hour in range(25):
            for body in ('SUN','EARTH'):
                unknown=body=='SUN'
                rows.append(dict(site_id='check',utc=(a+timedelta(hours=hour)).isoformat(),body=body,
                    azimuth_deg='0',center_elevation_deg='0',angular_radius_deg='1',
                    state='UNKNOWN' if unknown else 'FULL',visible_fraction='' if unknown else '1',
                    visible_fraction_lower=0 if unknown else 1,visible_fraction_upper=1))
        parts.append((request,rows,f'run-{index}',f'key-{index}'))
    rows,seams=join_chunks(parts)
    assert len(rows)==98 and len(seams)==2,'terminal sample must not duplicate boundary or duration'
    seasonal,windows=summarize_site(rows)
    sun=next(r for r in seasonal if r['scope']=='collection' and r['body']=='SUN')
    assert sun['total_hours']==48 and sun['unknown_hours']==48
    assert sun['mean_visible_fraction_lower']==0 and sun['mean_visible_fraction_upper']==1
    assert sun['longest_blocked_hours']=='','all UNKNOWN must not imply zero darkness'
    assert sun['simultaneous_positive_visibility_hours_lower']==0 and sun['simultaneous_positive_visibility_hours_upper']==48
    assert len(windows)==4,'two daily starts, two bodies, no incomplete seven-day windows'
    broken=list(parts);broken[1]=(parts[1][0],parts[1][1][1:],parts[1][2],parts[1][3])
    try:join_chunks(broken)
    except ValueError:pass
    else:raise AssertionError('missing boundary row accepted')
    conflicting=list(parts);changed=[dict(r) for r in parts[1][1]];changed[1]['center_elevation_deg']='1'
    conflicting[1]=(parts[1][0],changed,parts[1][2],parts[1][3])
    try:join_chunks(conflicting)
    except ValueError:pass
    else:raise AssertionError('conflicting boundary geometry accepted')
    print('PASS: 50 mixed candidates, leap-day chunking, shared endpoints, gaps, conflicts and unknown-duration semantics')


if __name__=='__main__':check()
