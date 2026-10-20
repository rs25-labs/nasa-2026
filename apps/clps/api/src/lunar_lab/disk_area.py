"""Conservative projected-area subdivision of a uniform apparent disk."""
from __future__ import annotations

import heapq
import math

from .bounded_math import Interval, PI, dot, sin_cos_degrees

INTEGRATOR_ID = 'lml-projected-disk-bounds-v1'
TILE_BUDGET = 16384
CLASSIFICATION_BUDGET = 4096
MAX_DEPTH = 10
TOLERANCE = 0.01


def disk_basis(row):
    az,elev,rho = (float(row[k]) for k in ('azimuth_deg','center_elevation_deg','angular_radius_deg'))
    if not all(math.isfinite(v) for v in (az,elev,rho)) or not -90 <= elev <= 90 or not 0 < rho < 90:
        raise ValueError('Invalid projected disk geometry')
    sa,ca = sin_cos_degrees(az%360)
    se,ce = sin_cos_degrees(elev)
    c = (ce*sa,ce*ca,se)
    u = (ca,-sa,Interval(0))
    v = (-se*sa,-se*ca,ce)
    return c,u,v,sin_cos_degrees(rho)[0]


def direction_box(frame,box):
    c,u,v,sine = frame
    x0,x1,y0,y1 = box
    x,y = Interval(x0,x1),Interval(y0,y1)
    radial = x.square()+y.square()
    # This box is for the intersection with the unit image disk. Clipping
    # the radial range to <=1 is a known domain constraint, not sampling.
    radial = Interval(radial.lo,min(Interval(1).hi,radial.hi))
    forward = (1-sine.square()*radial).nonnegative().sqrt()
    return tuple(a*forward+sine*(x*b+y*d) for a,b,d in zip(c,u,v))


def _fraction(visible,blocked):
    lower = max(0.,math.nextafter(float((visible/PI).lo),-math.inf))
    upper = min(1.,math.nextafter(float((Interval(1)-blocked/PI).hi),math.inf))
    return lower,upper


def integrate_disk(row,prover,*,tile_budget=TILE_BUDGET,max_depth=MAX_DEPTH,tolerance=TOLERANCE,classification_budget=CLASSIFICATION_BUDGET):
    if not isinstance(tile_budget,int) or tile_budget < 0 or not isinstance(max_depth,int) or not 0 <= max_depth <= 16:
        raise ValueError('Invalid disk subdivision work limits')
    if not math.isfinite(tolerance) or not 0 < tolerance < 1:
        raise ValueError('Invalid disk fraction tolerance')
    if not isinstance(classification_budget,int) or classification_budget<0:
        raise ValueError('Invalid region classification budget')
    frame = disk_basis(row)
    heap = [(-4.,'',(-1.,1.,-1.,1.),None)]
    terminals,visible,blocked = [],Interval(0),Interval(0)
    region_receipts = {}
    visited,termination = 0,'tile-budget'
    classified = 0
    limits=set()
    whole_state = None
    while heap and visited < tile_budget:
        _,tile_id,box,inherited = heapq.heappop(heap)
        visited += 1
        x0,x1,y0,y1 = box
        radial = Interval(x0,x1).square()+Interval(y0,y1).square()
        area = (x1-x0)*(y1-y0)  # Exact binary dyadic at bounded depth.
        receipt = dict(tile_id=tile_id,box=list(box),area_square=area)
        if radial.lo > 1:
            receipt.update(state='OUTSIDE',criterion='square-outside-unit-disk')
            terminals.append(receipt)
            continue
        inside = radial.hi <= 1
        evidence = inherited
        if evidence is None:
            if classified>=classification_budget:
                limits.add('region-classification-budget')
                receipt.update(state='UNKNOWN',criterion='region-classification-budget')
                terminals.append(receipt)
                continue
            direction = direction_box(frame,box)
            evidence = prover.classify(direction,tile_id)
            classified += 1
            if evidence['state'] not in ('FULL','BLOCKED','UNKNOWN'):
                raise ValueError('Invalid tile proof state')
            if evidence['state']!='UNKNOWN':
                region_id='region:'+tile_id
                region_receipts[region_id]=evidence
                evidence=dict(state=evidence['state'],region_id=region_id)
        state = evidence['state']
        if tile_id == '' and state in ('FULL','BLOCKED'):
            whole_state = state
            receipt.update(state=state,criterion='whole-disk-direction-box',evidence=evidence)
            terminals.append(receipt)
            termination = 'whole-disk-region-proof'
            break
        if inside and state in ('FULL','BLOCKED'):
            if state == 'FULL':
                visible = visible+area
            else:
                blocked = blocked+area
            receipt.update(state=state,criterion='inside-disk-square',evidence=evidence)
            terminals.append(receipt)
        elif len(tile_id) >= max_depth:
            limits.add('depth-limit')
            receipt.update(state='UNKNOWN',criterion='depth-limit-or-circle-edge',evidence=evidence)
            terminals.append(receipt)
        else:
            xm,ym = (x0+x1)/2,(y0+y1)/2
            boxes = ((x0,xm,y0,ym),(xm,x1,y0,ym),(x0,xm,ym,y1),(xm,x1,ym,y1))
            for index,child in enumerate(boxes):
                heapq.heappush(heap,(-area/4,tile_id+str(index),child,evidence if state!='UNKNOWN' else None))
        width = Interval(1)-(visible+blocked)/PI
        if width.hi <= Interval(tolerance).lo:
            termination = 'fraction-width-target'
            break
    if whole_state:
        if whole_state=='FULL':
            visible=PI
        else:
            blocked=PI
        lower = upper = 1. if whole_state=='FULL' else 0.
        state,scalar = whole_state,lower
    else:
        for _,tile_id,box,inherited in heap:
            x0,x1,y0,y1 = box
            terminals.append(dict(tile_id=tile_id,box=list(box),area_square=(x1-x0)*(y1-y0),
                                  state='UNKNOWN',criterion='unprocessed',evidence=inherited))
        lower,upper = _fraction(visible,blocked)
        state = 'PARTIAL' if visible.lo>0 and blocked.lo>0 else 'UNKNOWN'
        scalar = ''
        if not heap and termination!='fraction-width-target':
            termination = '+'.join(sorted(limits)) or 'subdivision-exhausted'
    return dict(state=state,visible_fraction=scalar,visible_fraction_lower=lower,visible_fraction_upper=upper,
                fraction_width_upper=0. if upper==lower else math.nextafter(upper-lower,math.inf),integrator_id=INTEGRATOR_ID,
                tile_budget=tile_budget,max_depth=max_depth,tolerance=tolerance,visited_tiles=visited,
                termination=termination,limits_reached=sorted(limits),classified_regions=classified,classification_budget=classification_budget,proven_visible_area_lo=str(visible.lo),
                proven_blocked_area_lo=str(blocked.lo),tiles=terminals,region_receipts=region_receipts)


class TerrainTileProver:
    """Bounded witnesses plus complete composite clearance for a tile box."""
    def __init__(self,cell_evidence,clearance,*,terrain_node_budget=32768,prepared=None):
        import numpy as np
        self.clearance = clearance
        self.remaining = terrain_node_budget
        self.initial_budget = terrain_node_budget
        self.witnesses = []
        if prepared is not None:
            self.witnesses,self.approx = prepared.witnesses,prepared.approx
            return
        from .terrain_bounds import MODEL_ID
        for row in cell_evidence:
            if (row['model_id']!=MODEL_ID or not row['inner_circle_within_nominal_cap']
                    or row['inner_cap_elevation_lower_deg']<=-90):
                continue
            v = tuple(Interval(row[f'inner_{k}_lo'],row[f'inner_{k}_hi']) for k in ('vx','vy','vz'))
            k = Interval(row['inner_k_lo'],row['inner_k_hi'])
            A,E,N = (dot(v,b) for b in (clearance.up,clearance.east,clearance.north))
            self.witnesses.append((row['cell_id'],row['inner_cap_elevation_lower_deg'],v,k,A,E,N))
        # Float arrays propose opportunities only. Every accepted witness
        # is independently checked with outward intervals below.
        self.approx = np.array([[w[1],w[4].midpoint_float(),w[5].midpoint_float(),
                                 w[6].midpoint_float(),w[3].midpoint_float()] for w in self.witnesses])

    def classify(self,direction,tile_id):
        import numpy as np
        from .terrain_bounds import trig
        east,north,up = direction
        horizontal = (east.square()+north.square()).sqrt()
        if self.witnesses and horizontal.lo > 0:
            az = math.atan2(east.midpoint_float(),north.midpoint_float())
            low,A,E,N,k = self.approx.T
            B = E*math.sin(az)+N*math.cos(az)
            candidates = np.flatnonzero((A>0)&(B>0)&(A*A+B*B>k*k))
            candidates = sorted(candidates,key=lambda i:self.witnesses[i][1],reverse=True)[:16]
            for index in candidates:
                cell,lower,_,threshold,a,e,n = self.witnesses[index]
                # Up is sin(elevation) for every unit direction in the box.
                if trig(lower)[0].lo <= up.hi:
                    continue
                b = (e*east+n*north)/horizontal
                if a.lo>0 and b.lo>0 and (a.square()+b.square()).lo>threshold.square().hi:
                    return dict(state='BLOCKED',evidence_id='polar-inner-cap:'+cell,witness_cell_id=cell,
                                elevation_lower_deg=lower,direction=[[str(d.lo),str(d.hi)] for d in direction])
        if self.remaining <= 0:
            return dict(state='UNKNOWN',evidence_id='terrain-node-budget')
        proof = self.clearance.prove_region(direction,node_budget=min(512,self.remaining))
        self.remaining -= proof['visited_nodes']
        if proof['clear']:
            proof_id = f'region-clearance-{len(self.clearance.proofs)}'
            proof.update(proof_id=proof_id,tile_id=tile_id,proof_kind='projected-disk-region')
            self.clearance.proofs.append(proof)
            return dict(state='FULL',evidence_id=proof_id,clearance_proof_id=proof_id)
        return dict(state='UNKNOWN',evidence_id=proof['termination'])
