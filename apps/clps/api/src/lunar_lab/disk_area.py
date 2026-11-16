"""Conservative projected-area subdivision of a uniform apparent disk."""
from __future__ import annotations

import heapq
import math

from .bounded_math import Interval, PI, dot, sin_cos_degrees
from .circle_area import clipped_area_lower,STRIPS_PER_TILE,STRIP_BUDGET

INTEGRATOR_ID = 'lml-projected-disk-bounds-v8'
TILE_BUDGET = 16384
CLASSIFICATION_BUDGET = 4096
REUSE_BUDGET = 4096
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


def integrate_disk(row,prover,*,tile_budget=TILE_BUDGET,max_depth=MAX_DEPTH,tolerance=TOLERANCE,classification_budget=CLASSIFICATION_BUDGET,reuse_budget=REUSE_BUDGET,_resume=None,_reuse_first=False):
    """One bounded pass; the private seed is used only by disk_refinement.

    Continuation requires the same live prover. Arbitrary persisted checkpoints
    are not an input interface: their provenance/terrain would need validation.
    """
    if not isinstance(tile_budget,int) or tile_budget < 0 or not isinstance(max_depth,int) or not 0 <= max_depth <= 16:
        raise ValueError('Invalid disk subdivision work limits')
    if not math.isfinite(tolerance) or not 0 < tolerance < 1:
        raise ValueError('Invalid disk fraction tolerance')
    if not isinstance(classification_budget,int) or classification_budget<0:
        raise ValueError('Invalid region classification budget')
    if not isinstance(reuse_budget,int) or reuse_budget<0:
        raise ValueError('Invalid evidence reuse budget')
    frame = disk_basis(row)
    geometry={key:float(row[key]) for key in ('azimuth_deg','center_elevation_deg','angular_radius_deg')}
    if _resume is not None:
        if _resume['disk_geometry']!=geometry or max_depth<_resume['max_depth']:
            raise ValueError('Continuation geometry/depth mismatch')
        preparation=_resume['horizon_preparation']
        terminals=[t for t in _resume['tiles'] if t['state']!='UNKNOWN']
        visible=Interval(_resume['proven_visible_area_lo'])
        blocked=Interval(_resume['proven_blocked_area_lo'])
        region_receipts=dict(_resume['region_receipts'])
        heap=[]
        for tile in _resume['tiles']:
            if tile['state']!='UNKNOWN':continue
            inherited=tile.get('evidence')
            if inherited is not None and inherited.get('state') not in ('FULL','BLOCKED'):inherited=None
            heap.append((-tile['area_square'],tile['tile_id'],tuple(tile['box']),inherited))
        heapq.heapify(heap)
    else:
        preparation=prover.prepare(row) if tile_budget and classification_budget and hasattr(prover,'prepare') else None
        heap = [(-4.,'',(-1.,1.,-1.,1.),None)]
        terminals,visible,blocked = [],Interval(0),Interval(0)
        region_receipts = {}
    visited,termination = 0,'tile-budget'
    classified = 0
    reused = 0
    reuse_tiles=[]
    limits=set()
    whole_state = None
    circle_strips=_resume['circle_area_strips_used'] if _resume is not None else 0
    def reuse(direction,tile_id):
        nonlocal reused
        before=getattr(prover,'remaining',None)
        evidence=prover.classify_reuse(direction,tile_id)
        if before is not None and prover.remaining!=before:
            raise ValueError('Evidence reuse spent terrain work')
        reused+=1;reuse_tiles.append(tile_id)
        return dict(evidence,reuse_only=True)
    def credit(receipt,evidence,inside):
        nonlocal visible,blocked,circle_strips
        if inside:
            amount=Interval(receipt['area_square'])
            receipt.update(criterion='inside-disk-square')
        elif circle_strips+STRIPS_PER_TILE<=STRIP_BUDGET:
            amount=Interval(clipped_area_lower(receipt['box']))
            circle_strips+=STRIPS_PER_TILE
            receipt.update(criterion='disk-clipped-area-lower-bound',
                           clipped_area_lower=str(amount.lo),area_strips=STRIPS_PER_TILE)
        else:
            limits.add('circle-area-strip-budget')
            return False
        if evidence['state']=='FULL':visible=visible+amount
        else:blocked=blocked+amount
        receipt.update(state=evidence['state'],evidence=evidence)
        terminals.append(receipt)
        return True
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
            direction=direction_box(frame,box)
            can_reuse=reused<reuse_budget and hasattr(prover,'classify_reuse')
            if _reuse_first and can_reuse:
                evidence=reuse(direction,tile_id)
                if evidence['state']=='UNKNOWN' and classified<classification_budget:
                    evidence=prover.classify(direction,tile_id);classified+=1
                elif evidence['state']=='UNKNOWN':limits.add('region-classification-budget')
            elif classified>=classification_budget:
                limits.add('region-classification-budget')
                if not can_reuse:
                    if reused>=reuse_budget:limits.add('evidence-reuse-budget')
                    receipt.update(state='UNKNOWN',criterion='region-classification-budget')
                    terminals.append(receipt)
                    continue
                evidence=reuse(direction,tile_id)
            else:
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
        if state in ('FULL','BLOCKED') and credit(receipt,evidence,inside):
            pass
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
            receipt=dict(tile_id=tile_id,box=list(box),area_square=(x1-x0)*(y1-y0))
            radial=Interval(x0,x1).square()+Interval(y0,y1).square()
            if radial.lo>1:
                receipt.update(state='OUTSIDE',criterion='square-outside-unit-disk')
            elif inherited is not None and inherited['state'] in ('FULL','BLOCKED'):
                if credit(receipt,inherited,radial.hi<=1):continue
                receipt.update(state='UNKNOWN',criterion='unprocessed',evidence=inherited)
            else:
                receipt.update(state='UNKNOWN',criterion='unprocessed',evidence=inherited)
            terminals.append(receipt)
        lower,upper = _fraction(visible,blocked)
        state = 'PARTIAL' if visible.lo>0 and blocked.lo>0 else 'UNKNOWN'
        scalar = ''
        if not heap and termination!='fraction-width-target':
            termination = '+'.join(sorted(limits)) or 'subdivision-exhausted'
    previous=_resume or {}
    return dict(state=state,visible_fraction=scalar,visible_fraction_lower=lower,visible_fraction_upper=upper,
                disk_geometry=geometry,pass_kind='refined' if _resume is not None else 'initial',
                adaptive_bearing_refinement=getattr(prover,'adaptive_refinement',None),
                horizon_preparation=preparation,terrain_node_budget=getattr(prover,'initial_budget',None),
                circle_area_policy='concave-strip-lower-v1',circle_area_strips_used=circle_strips,
                circle_area_strip_budget=STRIP_BUDGET,
                reuse_only_regions=reused+previous.get('reuse_only_regions',0),
                reuse_budget=reuse_budget+previous.get('reuse_budget',0),
                reuse_only_tiles=previous.get('reuse_only_tiles',[])+reuse_tiles,
                terrain_visited_nodes=(prover.initial_budget-prover.remaining) if hasattr(prover,'initial_budget') else None,
                fraction_width_upper=0. if upper==lower else math.nextafter(upper-lower,math.inf),integrator_id=INTEGRATOR_ID,
                tile_budget=tile_budget+previous.get('tile_budget',0),max_depth=max_depth,tolerance=tolerance,
                visited_tiles=visited+previous.get('visited_tiles',0),
                termination=termination,limits_reached=sorted(limits),
                classified_regions=classified+previous.get('classified_regions',0),
                classification_budget=classification_budget+previous.get('classification_budget',0),proven_visible_area_lo=str(visible.lo),
                proven_blocked_area_lo=str(blocked.lo),tiles=terminals,region_receipts=region_receipts)


class TerrainTileProver:
    """Bounded witnesses plus complete composite clearance for a tile box."""
    def __init__(self,cell_evidence,clearance,*,terrain_node_budget=32768,prepared=None):
        import numpy as np
        self.clearance = clearance
        self.remaining = terrain_node_budget
        self.initial_budget = terrain_node_budget
        self.has_horizon_bank=False
        self.reuse_witnesses=None
        self.adaptive_refinement=dict(policy='witness-gated-dyadic-v1',attempt_limit=128,attempts=[],visited_nodes=0)
        self.witnesses = []
        if prepared is not None:
            self.witnesses,self.approx = prepared.witnesses,prepared.approx
            self.outer_candidates,self.adaptive_cache=prepared.outer_candidates,prepared.adaptive_cache
            self.outer_array=prepared.outer_array
            return
        self.outer_candidates=[]
        self.adaptive_cache={}
        from .terrain_bounds import MODEL_ID
        for row in cell_evidence:
            if (row['model_id']!=MODEL_ID or not row['inner_circle_within_nominal_cap']
                    or row['inner_cap_elevation_lower_deg']<=-90):
                continue
            v = tuple(Interval(row[f'inner_{k}_lo'],row[f'inner_{k}_hi']) for k in ('vx','vy','vz'))
            k = Interval(row['inner_k_lo'],row['inner_k_hi'])
            A,E,N = (dot(v,b) for b in (clearance.up,clearance.east,clearance.north))
            self.witnesses.append((row['cell_id'],row['inner_cap_elevation_lower_deg'],v,k,A,E,N))
            ov=tuple(Interval(row[f'outer_{name}_lo'],row[f'outer_{name}_hi']) for name in ('vx','vy','vz'))
            ok=Interval(row['outer_k_lo'],row['outer_k_hi'])
            oa,oe,on=(dot(ov,b).midpoint_float() for b in (clearance.up,clearance.east,clearance.north))
            self.outer_candidates.append((row['inner_cap_elevation_lower_deg'],oa,oe,on,ok.midpoint_float(),row['cell_id']))
        # Float arrays propose opportunities only. Every accepted witness
        # is independently checked with outward intervals below.
        self.approx = np.array([[w[1],w[4].midpoint_float(),w[5].midpoint_float(),
                                 w[6].midpoint_float(),w[3].midpoint_float()] for w in self.witnesses])
        self.outer_array=np.array([w[:5] for w in self.outer_candidates])

    def prepare(self,row):
        from .bearing_horizon import prepare_horizon
        preparation=prepare_horizon(self,row)
        self.has_horizon_bank=preparation['coverage_complete']
        preparation['fallback_policy']='adaptive-bearing-refinement' if self.has_horizon_bank else 'bounded-region-traversal'
        return preparation

    def _clear_receipt(self,proof,tile_id):
        proof_id=f'region-clearance-{len(self.clearance.proofs)}'
        proof.update(proof_id=proof_id,tile_id=tile_id,proof_kind='projected-disk-region')
        self.clearance.proofs.append(proof)
        self.clearance.sky_cache.remember(proof)
        return dict(state='FULL',evidence_id=proof_id,clearance_proof_id=proof_id)

    def classify(self,direction,tile_id):
        return self._classify(direction,tile_id,reuse_only=False)

    def classify_reuse(self,direction,tile_id):
        """Check published sky proofs / preconstructed circles, with no traversal."""
        return self._classify(direction,tile_id,reuse_only=True)

    def _classify(self,direction,tile_id,*,reuse_only):
        import numpy as np
        from .terrain_bounds import trig
        if self.clearance.sky_cache.lookup(direction) is not None or self.clearance.sky_cache.lookup_union(direction) is not None:
            return self._clear_receipt(self.clearance.prove_region(direction,node_budget=0),tile_id)
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
        if reuse_only:
            from .adaptive_witness import certify_geometry
            if self.reuse_witnesses is None:
                self.reuse_witnesses=tuple(g for g in self.adaptive_cache.values() if g is not None)
                self.reuse_approx=np.array([[float(g['lower']),g['A'].midpoint_float(),
                    g['E'].midpoint_float(),g['N'].midpoint_float(),g['k'].midpoint_float()]
                    for g in self.reuse_witnesses])
            if self.reuse_witnesses and horizontal.lo>0:
                az=math.atan2(east.midpoint_float(),north.midpoint_float())
                lower,A,E,N,k=self.reuse_approx.T
                B=E*math.sin(az)+N*math.cos(az)
                candidates=np.flatnonzero((lower>float(up.hi))&(A>0)&(B>0)&(A*A+B*B>k*k))
                candidates=sorted(candidates,key=lambda i:self.reuse_witnesses[i]['lower'],reverse=True)[:16]
                for index in candidates:
                    blocked=certify_geometry(self.reuse_witnesses[index],direction)
                    if blocked is not None:return blocked
            return dict(state='UNKNOWN',evidence_id='existing-evidence-unresolved')
        from .adaptive_witness import propose_witness,certify_circle
        floor_witness=None
        floor=None
        if self.outer_candidates and horizontal.lo>0:
            az=math.atan2(east.midpoint_float(),north.midpoint_float())
            low,A,E,N,k=self.outer_array.T
            B=E*math.sin(az)+N*math.cos(az)
            candidates=np.flatnonzero((A>0)&(B>0)&(A*A+B*B>k*k))
            candidates=sorted(candidates,key=lambda i:self.outer_candidates[i][0],reverse=True)[:8]
            for index in candidates:
                row,col=map(int,self.outer_candidates[index][5].split(':'))
                probe=(east,north,Interval(-1)) if self.has_horizon_bank else direction
                blocked=propose_witness(self.clearance,probe,f'{row}:{row+1}:{col}:{col+1}',self.adaptive_cache)
                if blocked is not None:
                    lower=Interval(blocked['elevation_sine_lower_lo']).lo
                    if lower>up.hi:
                        return certify_circle(self.clearance,direction,row,col,blocked['circle_x_m'],blocked['circle_y_m'],blocked['circle_radius_m'])
                    if self.has_horizon_bank and (floor is None or lower>floor):
                        floor,floor_witness=lower,blocked
        if self.has_horizon_bank:
            from .bearing_refinement import refine_bearing
            proof=refine_bearing(self,direction,tile_id,floor,floor_witness)
            if proof is not None and proof['clear']:
                # Record the exact tile direction via the usual cache receipt.
                if self.clearance.sky_cache.lookup(direction) is not None or self.clearance.sky_cache.lookup_union(direction) is not None:
                    return self._clear_receipt(self.clearance.prove_region(direction,node_budget=0),tile_id)
            return dict(state='UNKNOWN',evidence_id='adaptive-bearing-unresolved')
        proof = self.clearance.prove_region(direction,node_budget=min(512,max(0,self.remaining)))
        self.remaining -= proof['visited_nodes']
        if proof['clear']:
            return self._clear_receipt(proof,tile_id)
        blocked=propose_witness(self.clearance,direction,proof.get('unresolved_node'),self.adaptive_cache)
        if blocked is not None:return blocked
        return dict(state='UNKNOWN',evidence_id=proof['termination'])
