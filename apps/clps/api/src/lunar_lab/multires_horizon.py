"""Terrain skyline from several polar rasters: the finest product near the mast, coarser ones farther out.

Kept apart from hourly_estimates.py, whose source hash is part of the stored archive's identity.
"""
import math

import numpy as np

from .horizon import local_basis, radial_vector

MODEL='lml-sampled-horizon-estimate-v4-multires-lts'
MAX_DISTANCE_M=150000.
NEAR_FIELD_START_M=2.
MIN_STEP_M=1.
NEAR_STEP_FRACTION=.02
FAR_STEP_FRACTION=.004
HANDOFF_ANGLE_DEG=.4
AZIMUTH_STEP_DEG=2


def band_edges(scales):
    """Distances at which each coarser product takes over: its pixel then subtends HANDOFF_ANGLE_DEG."""
    edges=[NEAR_FIELD_START_M]
    for coarser in scales[1:]:
        edges.append(max(edges[-1],coarser/math.tan(math.radians(HANDOFF_ANGLE_DEG))))
    edges.append(MAX_DISTANCE_M)
    return edges


def band_distances(scale,low,high,last):
    """Radial sample distances in [low,high): never wider than the pixel until the far-field angular rule takes over."""
    values=[];distance=low
    while distance<high:
        values.append(distance)
        distance+=max(MIN_STEP_M,min(NEAR_STEP_FRACTION*distance,max(scale,FAR_STEP_FRACTION*distance)))
    if last:values.append(high)
    return np.asarray(values)


def bilinear_heights(terrain,latitude,longitude):
    """Metres above the reference sphere, bilinear between pixel centres; NaN outside the raster or near invalid pixels."""
    x,y=terrain.forward.transform(longitude,latitude)
    fc=terrain.col_offset+x/terrain.scale
    fr=terrain.row_offset-y/terrain.scale
    inside=((latitude>=terrain.min_lat)&(latitude<=terrain.max_lat)&(fc>=0)&(fc<=terrain.cols-1)&(fr>=0)&(fr<=terrain.rows-1))
    c0=np.clip(np.floor(fc).astype(int),0,terrain.cols-2);r0=np.clip(np.floor(fr).astype(int),0,terrain.rows-2)
    tc=fc-c0;tr=fr-r0
    corners=[terrain.raw[r0+dr,c0+dc] for dr in (0,1) for dc in (0,1)]
    for corner in corners:inside&=terrain.valid_dn(corner)
    top=(1-tc)*corners[0]+tc*corners[1];bottom=(1-tc)*corners[2]+tc*corners[3]
    return np.where(inside,((1-tr)*top+tr*bottom)*terrain.factor,np.nan)


def ground_height(products,latitude,longitude):
    """Finest available bilinear ground height at one point, with the product that supplied it."""
    for name,terrain in products:
        value=float(bilinear_heights(terrain,np.asarray([latitude]),np.asarray([longitude]))[0])
        if math.isfinite(value):return value,name
    raise ValueError('No usable terrain at the site')


def multires_horizon(products,site):
    """180 bearings by many radial samples, once per site; same output shape as sampled_horizon.

    products is [(id, PolarTerrain)] finest first. The observer sits at the finest bilinear ground height
    plus the mast, taken from site['observer_radius_m'] - site['surface_radius_m'] for the mast part.
    """
    az=np.deg2rad(np.arange(0.,360.,AZIMUTH_STEP_DEG))[:,None]
    sphere=products[0][1].radius
    mast=site['observer_radius_m']-site['surface_radius_m']
    ground,_=ground_height(products,site['latitude_deg'],site['longitude_deg'])
    east,north,up=local_basis(site['latitude_deg'],site['longitude_deg'])
    observer=radial_vector(site['latitude_deg'],site['longitude_deg'],sphere+ground+mast)
    edges=band_edges([terrain.scale for _,terrain in products])
    maxima=np.full(az.shape[0],-np.inf);counts=np.zeros(az.shape[0],dtype=int);bands=[];total=0
    for index,(name,terrain) in enumerate(products):
        low,high=edges[index],edges[index+1]
        if high<=low:continue
        distances=band_distances(terrain.scale,low,high,index==len(products)-1)
        total+=len(distances);bands.append(dict(product=name,pixel_size_m=terrain.scale,from_m=float(low),to_m=float(high),samples=int(len(distances))))
        delta=distances[None,:]/sphere
        direction=(up[None,None,:]*np.cos(delta)[:,:,None]+
                   (north[None,None,:]*np.cos(az)[:,:,None]+east[None,None,:]*np.sin(az)[:,:,None])*np.sin(delta)[:,:,None])
        lat=np.rad2deg(np.arctan2(direction[:,:,2],np.hypot(direction[:,:,0],direction[:,:,1])))
        lon=np.rad2deg(np.arctan2(direction[:,:,1],direction[:,:,0]))
        height=bilinear_heights(terrain,lat,lon)
        # A sample the band's own raster cannot supply falls back to the next coarser one.
        for _,coarser in products[index+1:]:
            missing=~np.isfinite(height)
            if not missing.any():break
            height[missing]=bilinear_heights(coarser,lat[missing],lon[missing])
        valid=np.isfinite(height)
        vectors=direction*(sphere+np.where(valid,height,0.))[:,:,None]-observer
        elev=np.rad2deg(np.arctan2(vectors@up,np.hypot(vectors@east,vectors@north)))
        maxima=np.maximum(maxima,np.max(np.where(valid,elev,-np.inf),axis=1));counts+=valid.sum(axis=1)
    if np.any(counts==0):raise ValueError('No usable terrain samples along one or more horizon rays')
    if not np.all(np.isfinite(maxima)):raise ValueError('Invalid sampled horizon')
    return dict(elevation_deg=maxima.tolist(),valid_radial_samples=counts.tolist(),
                azimuth_step_deg=AZIMUTH_STEP_DEG,radial_samples=total,max_distance_m=int(MAX_DISTANCE_M),
                observer_ground_height_m=ground,bands=bands,model=MODEL,
                coverage='Multi-resolution LOLA rasters, bilinear: '+'; '.join(
                    f'{band["pixel_size_m"]:g} m from {band["from_m"]:g} to {band["to_m"]:g} m' for band in bands)+
                '. Gaps, between-ray and unsampled terrain omitted, no completeness claim')
