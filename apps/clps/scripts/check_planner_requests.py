"""Focused planner input checks; Pi executes this script."""
from lunar_lab.planner_server import validate_request


def check():
    request=dict(site_id='my-site',latitude_deg=-89.54,longitude_deg=0,observer_height_m=2,
                 start='2026-11-23T21:00:00Z',days=1)
    assert validate_request(request)['start']=='2026-11-23T21:00:00+00:00'
    for key,value in [('latitude_deg',0),('latitude_deg',float('nan')),('days',31),('days',1.5),
                      ('observer_height_m',21),('longitude_deg',181),('days',True),
                      ('start','2026-11-23T21:00'),('start','2029-01-01T00:00Z'),
                      ('site_id','../escape'),('command','anything')]:
        try:validate_request(dict(request,**{key:value}))
        except ValueError:pass
        else:raise AssertionError(f'invalid {key} accepted')
    assert validate_request(dict(request,start='2026-11-23T13:00:00-08:00'))==validate_request(request)
    print('PASS: UTC normalization, supported ranges/dates, finite numbers and rejected unknown inputs')


if __name__=='__main__':check()
