"""Bounded complete-terrain meridian certificates and strict sky inclusion."""
import math
from .bounded_math import Interval,dot,sin_cos_degrees


def wedge_normals(start,end):
    if not (math.isfinite(start) and math.isfinite(end) and 0<end-start<180):
        raise ValueError('Invalid bearing wedge')
    ss,sc=sin_cos_degrees(start%360);es,ec=sin_cos_degrees(end%360)
    sa,ca=sin_cos_degrees(((start+end)/2)%360)
    return ((sc,-ss,Interval(0)),(-ec,es,Interval(0)),(sa,ca,Interval(0)))


def bearing_wedge(direction):
    """Float corner angles propose a sector; interval half spaces decide."""
    east,north,_=direction
    az=math.degrees(math.atan2(east.midpoint_float(),north.midpoint_float()))
    spread=max(abs((math.degrees(math.atan2(float(e),float(n)))-az+180)%360-180)
               for e in (east.lo,east.hi) for n in (north.lo,north.hi))
    half=max(1e-7,spread*1.001+1e-7)
    if half>=89:return None
    start,end=az-half,az+half
    if all(dot(n,direction).lo>0 for n in wedge_normals(start,end)):
        return start,end
    return None


def prepare_horizon(prover,row):
    """Spend only reserved existing work; diagnostic heights propose, never prove."""
    budget=min(8192,max(0,prover.remaining//2))
    result=dict(policy='bearing-preparation-v1',node_budget=budget,visited_nodes=0,attempts=[],bearing_bins=[],certified_bins=[],coverage_complete=False)
    if not budget:return result
    try:seed=float(row.get('horizon_elevation_deg',float('nan')))
    except (TypeError,ValueError):return result
    if not math.isfinite(seed) or not -89<seed<89:return result
    if abs(float(row['center_elevation_deg'])-seed)>=float(row['angular_radius_deg']):return result
    from .disk_area import disk_basis,direction_box
    wedge=bearing_wedge(direction_box(disk_basis(row),(-1.,1.,-1.,1.)))
    if wedge is None:return result
    start,end=wedge
    indices=range(math.floor(start*8),math.floor(end*8)+1)
    result['bearing_bins']=list(indices)
    # Broad/zenith footprints may get only partial preparation. Lookup still
    # requires strict inclusion; uncovered bearings cannot gain clearance.
    indices=sorted(indices,key=lambda i:abs(((i+.5)/8-float(row['azimuth_deg'])+180)%360-180))[:16]
    engine=prover.clearance
    for index in indices:
        low,high=seed-.05,seed+.05
        for attempt in range(4):
            remaining=budget-result['visited_nodes']
            if remaining<=0:break
            theta=high if attempt==0 else (low+high)/2
            proof=engine.prove_wedge(index/8,(index+1)/8,sin_cos_degrees(theta)[0],node_budget=min(512,remaining))
            proof_id=f'horizon-wedge-{len(engine.proofs)}'
            proof.update(proof_id=proof_id,proof_kind='bearing-horizon-wedge',proposed_elevation_deg=theta)
            engine.proofs.append(proof)
            result['attempts'].append(proof_id)
            result['visited_nodes']+=proof['visited_nodes']
            prover.remaining-=proof['visited_nodes']
            if proof['clear']:
                high=theta
                engine.sky_cache.remember(proof)
                if index not in result['certified_bins']:result['certified_bins'].append(index)
            elif attempt==0:
                break
            else:
                low=theta
    result['coverage_complete']=set(result['bearing_bins'])==set(result['certified_bins'])
    return result
