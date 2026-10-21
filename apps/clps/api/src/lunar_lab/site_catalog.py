"""Small sourced candidate catalog, with explicitly exploratory neighbors."""
import csv
import math
from pathlib import Path
import re

from .terrain_view import polar_xy,polar_lonlat

SOURCE='https://doi.org/10.1029/2025JE009434'
POLICY='mixed-20-published-30-offset-v1'


def load_catalog(path):
    with Path(path).open(newline='') as stream:seeds=list(csv.DictReader(stream))
    if len(seeds)!=20:raise ValueError('Expected the reviewed 20 published coordinate seeds')
    sites=[];groups={};ids=set();coordinates=set()
    for row in seeds:
        site_id=row['site_id'];lat=float(row['latitude_deg']);lon=float(row['longitude_deg'])
        if not re.fullmatch('[a-z0-9-]{1,48}',site_id) or site_id in ids:raise ValueError('Invalid/duplicate site ID')
        if not all(math.isfinite(v) for v in (lat,lon)) or not -90<=lat<=-85 or not -180<=lon<=180:
            raise ValueError('Catalog coordinate outside supported domain')
        point=(lat,lon)
        if point in coordinates:raise ValueError('Duplicate published coordinate')
        ids.add(site_id);coordinates.add(point)
        site=dict(row,latitude_deg=lat,longitude_deg=lon,kind='published-candidate',source_url=SOURCE,
                  source_locator='Table A1: '+row['source_site_id'],parent_site_id='',offset_x_m=0,offset_y_m=0,
                  why_included='Published research candidate; compare its calculated operating conditions with other regions.',
                  assessment='Operating conditions pending; landing safety not assessed')
        sites.append(site);groups.setdefault(row['region_id'],[]).append(site)
    if len(groups)!=10 or any(len(v)!=2 for v in groups.values()):raise ValueError('Expected two seeds in each of ten groups')
    for region,members in groups.items():
        parent=members[0];x,y=polar_xy(parent['latitude_deg'],parent['longitude_deg'])
        for suffix,dx,dy in [('xp',500,0),('xm',-500,0),('yp',0,500)]:
            lat,lon=polar_lonlat(x+dx,y+dy)
            if not -90<=lat<=-85:raise ValueError('Exploratory neighbor outside terrain cap')
            sites.append(dict(parent,site_id=f'exp-{region}-{suffix}',source_site_id='',kind='exploratory-point',
                latitude_deg=lat,longitude_deg=lon,parent_site_id=parent['site_id'],offset_x_m=dx,offset_y_m=dy,
                source_locator='App-generated offset from '+parent['source_site_id'],
                why_included='Explore local variation near a published candidate; this offset is not a published landing site.'))
    if len(sites)!=50 or len({s['site_id'] for s in sites})!=50:raise ValueError('Expected 50 unique catalog IDs')
    if len({polar_xy(s['latitude_deg'],s['longitude_deg']) for s in sites})!=50:raise ValueError('Duplicate catalog positions')
    return sites


def assess_catalog(sites,root,manifest):
    """Nearest-cell elevations and a 5×5 diagnostic; no landing-footprint claim."""
    import numpy as np
    from .terrain_view import TerrainView
    view=TerrainView(root,manifest);terrain=view.terrain();assessed=[]
    for site in sites:
        try:sample=terrain.sample(site['latitude_deg'],site['longitude_deg'])
        except ValueError as exc:raise ValueError(f"Unusable candidate {site['site_id']}: {exc}") from exc
        x,y=polar_xy(site['latitude_deg'],site['longitude_deg'])
        col=round(terrain.col_offset+x/terrain.scale);row=round(terrain.row_offset-y/terrain.scale)
        patch=np.asarray(terrain.raw[max(0,row-2):row+3,max(0,col-2):col+3])
        full=patch.shape==(5,5) and bool(np.all(terrain.valid_dn(patch)))
        # Samples at +/-80 m, 160 m baseline; descriptive slope only.
        slope='';relief=''
        if full:
            heights=patch.astype(float)*terrain.factor
            dx=(heights[2,4]-heights[2,0])/(4*terrain.scale)
            dy=(heights[4,2]-heights[0,2])/(4*terrain.scale)
            slope=math.degrees(math.atan(math.hypot(dx,dy)));relief=float(heights.max()-heights.min())
        assessed.append(dict(site,elevation_m=sample['elevation_above_reference_sphere_m'],
            diagnostic_slope_deg=slope,local_relief_m=relief,neighborhood_complete=full,
            terrain_pixel_m=terrain.scale,terrain_frame='MOON_ME_DE421',
            terrain_sha256=view.hashes['terrain_image'],
            terrain_context='5x5 source-cell neighborhood; slope uses a 160 m projected baseline; small hazards unresolved'))
    return assessed
