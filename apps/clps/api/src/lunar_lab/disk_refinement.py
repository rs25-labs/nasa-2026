"""Bounded in-memory continuation of an unresolved projected-disk partition."""
from copy import deepcopy
from .disk_area import integrate_disk

POLICY_ID='unresolved-second-pass-v1'
ADDITIONAL_TERRAIN_NODES=8192
SECOND_PASS=dict(tile_budget=8192,classification_budget=2048,reuse_budget=2048,max_depth=12)


def _stage(area,previous=None):
    previous=previous or {}
    keys=('visited_tiles','tile_budget','classified_regions','classification_budget',
          'reuse_only_regions','reuse_budget','terrain_visited_nodes','terrain_node_budget',
          'circle_area_strips_used')
    result={key:area[key]-previous.get(key,0) for key in keys}
    result.update(pass_kind=area['pass_kind'],max_depth=area['max_depth'],
                  fraction_width_upper=area['fraction_width_upper'],termination=area['termination'])
    result['reuse_only_tiles']=area['reuse_only_tiles'][previous.get('reuse_only_regions',0):]
    return result


def integrate_refined_disk(row,prover,*,_initial_options=None):
    """Retain every proved leaf; spend one additional allowance on UNKNOWN only.

    _initial_options is for bounded analytic checks, not a result-load API.
    """
    initial=integrate_disk(row,prover,**(_initial_options or {}))
    initial['refinement_policy']=POLICY_ID
    initial['refinement_stages']=[_stage(initial)]
    if initial['fraction_width_upper']<=initial['tolerance']:return initial
    snapshot=deepcopy({key:value for key,value in initial.items() if key!='region_receipts'})
    snapshot['region_receipt_ids']=list(initial['region_receipts'])
    prover.initial_budget+=ADDITIONAL_TERRAIN_NODES
    prover.remaining+=ADDITIONAL_TERRAIN_NODES
    # The full second-pass classifier may populate more circle geometry. Freeze
    # a new reuse snapshot when that pass first checks existing witnesses.
    prover.reuse_witnesses=None
    final=integrate_disk(row,prover,_resume=initial,_reuse_first=True,
                         tolerance=initial['tolerance'],**SECOND_PASS)
    final['refinement_policy']=POLICY_ID
    final['refinement_stages']=snapshot['refinement_stages']+[_stage(final,snapshot)]
    final['initial_pass']=snapshot
    if (final['visible_fraction_lower']<initial['visible_fraction_lower']
            or final['visible_fraction_upper']>initial['visible_fraction_upper']):
        raise ValueError('Continuation lost a certified fraction bound')
    return final
