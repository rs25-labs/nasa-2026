"""Focused map projection/real-raster checks for Pi; no downloads."""
from pathlib import Path
from lunar_lab.terrain_view import TerrainView,polar_xy,polar_lonlat


def check():
    repo=Path(__file__).resolve().parents[3]
    view=TerrainView(repo/'data/local/lml',repo/'data/manifests/clps/foundation-sources.json')
    for lat in (-90,-89.54,-85):
        for lon in (-180,-90,0,90,179.9):
            x,y=polar_xy(lat,lon);actual_lat,actual_lon=polar_lonlat(x,y)
            assert abs(actual_lat-lat)<1e-10
            if lat!=-90:assert abs((actual_lon-lon+180)%360-180)<1e-10
    assert polar_xy(-89,90)[0]>0 and abs(polar_xy(-89,90)[1])<1e-8
    assert polar_xy(-89,0)[1]>0 and polar_xy(-89,-90)[0]<0
    grid=view.viewport(0,0,320000)
    assert len(grid['elevations'])==192 and len(grid['elevations'][0])==192
    assert grid['elevations'][0][0] is None
    assert 0<sum(v is not None for row in grid['elevations'] for v in row)<192*192
    row,col=min(((r,c) for r in range(192) for c in range(192) if grid['elevations'][r][c] is not None),
                key=lambda p:(p[0]-95.5)**2+(p[1]-95.5)**2)
    lat,lon=polar_lonlat((col+.5-96)*grid['display_spacing_m'],(96-row-.5)*grid['display_spacing_m'])
    site=view.site(lat,lon)
    assert grid['elevations'][row][col]==site['elevation_above_reference_sphere_m']
    terrain=view.terrain()
    for lat,lon in [(-89.54,0),(-89,90),(-89,-90),(-89,180)]:
        x,y=polar_xy(lat,lon);px,py=terrain.forward.transform(lon,lat)
        assert abs(x-px)<1e-6 and abs(y-py)<1e-6
    assert view.viewport(0,0,7680)['display_spacing_m']==40
    for args in [(0,0,1),(float('nan'),0,320000),(200001,0,320000)]:
        try:view.viewport(*args)
        except ValueError:pass
        else:raise AssertionError('invalid viewport accepted')
    print('PASS: polar axes/roundtrips, PyProj agreement, masked raster, native pixel match and viewport limits')


if __name__=='__main__':check()
