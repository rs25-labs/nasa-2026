"""Refine only unresolved, witness-gated children of complete bearing proofs."""
import math
from .bounded_math import Interval,dot
from .bearing_horizon import bearing_wedge,wedge_normals


def refine_bearing(prover,direction,tile_id,obstruction_floor,witness=None):
    work=prover.adaptive_refinement
    if (not prover.has_horizon_bank or prover.remaining<=0 or len(tile_id)<4
            or len(work['attempts'])>=work['attempt_limit'] or obstruction_floor is None
            or direction[2].lo<=obstruction_floor or not -1<direction[2].lo<1):
        return None
    engine=prover.clearance
    parent=engine.sky_cache.lookup((direction[0],direction[1],Interval(1)))
    if parent is None or parent['minimum']<=direction[2].lo:return None
    original=next(p for p in engine.proofs if p['proof_id']==parent['proof_id'])
    if original.get('proof_kind')!='bearing-horizon-wedge':return None
    sector=bearing_wedge(direction)
    if sector is None:return None
    shift=360*round(((original['wedge_start_deg']+original['wedge_end_deg'])/2-sum(sector)/2)/360)
    sector=(sector[0]+shift,sector[1]+shift)
    start=max(original['wedge_start_deg'],math.floor(sector[0]*128)/128)
    end=min(original['wedge_end_deg'],math.ceil(sector[1]*128)/128)
    # Parent angles may be unwrapped differently around north.
    if not 0<end-start<=original['wedge_end_deg']-original['wedge_start_deg']:return None
    if not all(dot(n,direction).lo>0 for n in wedge_normals(start,end)):return None
    previous=prover.failed_bearing_attempts.get((start,end))
    if (previous is not None and direction[2].lo<=previous['threshold']
            and len(work['skipped'])<work['skip_limit']):
        # This does not prove obstruction. Spend later work elsewhere and leave
        # this tile unresolved; narrower wedges/higher thresholds may still try.
        work['skipped'].append(dict(criterion='same-wedge-lower-threshold-unresolved',
            previous_attempt=previous['proof_id'],after_attempt_count=len(work['attempts']),
            tile_id=tile_id,wedge_start_deg=start,wedge_end_deg=end,
            direction=[[str(d.lo),str(d.hi)] for d in direction]))
        return None
    proof=engine.prove_wedge(start,end,Interval(direction[2].lo),node_budget=min(512,prover.remaining))
    proof_id=f'adaptive-bearing-{len(engine.proofs)}'
    proof.update(proof_id=proof_id,proof_kind='bearing-horizon-wedge',threshold_origin='tile-up-v1',
                 refinement_parent=parent['proof_id'],refinement_tile_id=tile_id,
                 refinement_direction=[[str(d.lo),str(d.hi)] for d in direction],
                 refinement_floor=str(obstruction_floor),obstruction_floor_witness=witness)
    engine.proofs.append(proof)
    work['attempts'].append(proof_id);work['visited_nodes']+=proof['visited_nodes']
    prover.remaining-=proof['visited_nodes']
    if not proof['clear'] and (previous is None or direction[2].lo>previous['threshold']):
        prover.failed_bearing_attempts[(start,end)]=dict(threshold=direction[2].lo,proof_id=proof_id)
    engine.sky_cache.remember(proof)
    return proof
