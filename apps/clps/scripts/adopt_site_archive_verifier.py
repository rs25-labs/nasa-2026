"""Pi only: copy an unchanged solver archive into a new verifier identity.

No solver/verification execution. Original receipts, logs and runs stay intact.
The new queue has no completed job receipts: every adopted result is reverified.
"""
import argparse
import json
from pathlib import Path
import shutil

from lunar_lab.assets import write_json
from lunar_lab.result_store import engine_identity,source_snapshot,make_identity,lookup
from lunar_lab.site_archive import key,digest,collection_lock,FOUNDATION,GLOBAL,VERIFIER,REPO


def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('collection',type=Path)
    args=parser.parse_args();source=args.collection.resolve()
    previous=json.loads((source/'collection.json').read_text())
    if source.name!=key(previous):raise ValueError('Original collection identity differs')
    if len(previous['requests'])!=6:raise ValueError('This bounded adoption is for the six-job pilot only')
    if previous['engine']!=engine_identity():raise ValueError('Solver/runtime changed; verifier-only adoption is not permitted')
    manifests={'foundation':digest(FOUNDATION),'global':digest(GLOBAL)}
    if previous['manifests']!=manifests:raise ValueError('Scientific manifest changed')
    if previous['catalog_sha256']!=digest(REPO/'data/manifests/clps/landing-candidates.csv'):
        raise ValueError('Catalog changed')
    work=source/'work'
    specs=[json.loads(p.read_text()) for p in (FOUNDATION,GLOBAL)]
    if source_snapshot(work,specs)!=previous['sources']:raise ValueError('Cached scientific assets changed')
    updated=dict(previous,verifier_sha256=digest(VERIFIER))
    if updated==previous:raise ValueError('Verifier identity is unchanged; no adoption needed')
    destination=source.parent/key(updated)
    with collection_lock(source):
        if any((work/name).exists() for name in ('.environment.lock','.foundation.lock')):
            raise ValueError('Original work directory is locked; do not copy a live worker')
        cached=[]
        for index,request in enumerate(previous['requests']):
            result=lookup(work,make_identity(request,updated['manifests'],updated['sources'],updated['engine']))
            if index<5 and result is None:raise ValueError('An expected adopted cache entry is missing or invalid; no recalculation permitted')
            if result is not None:cached.append(dict(site_id=request['site_id'],start_utc=request['start_utc'],run_id=result['run_id']))
        if destination.exists():
            receipt=destination/'verifier-adoption.json'
            if not receipt.exists() or json.loads(receipt.read_text())['source_collection']!=str(source):
                raise ValueError('Destination exists without matching adoption receipt; preserve it and report')
            if json.loads((destination/'collection.json').read_text())!=updated:
                raise ValueError('Existing destination identity differs')
            print(f'Already adopted: {destination}');return
        temporary=destination.with_name(destination.name+'.adopting')
        if temporary.exists():raise ValueError('Partial adoption exists; preserve it and report')
        temporary.mkdir()
        # Copy rather than share a writable index or mutable receipts. This may
        # take space/time; old artifacts stay byte-for-byte in their old folder.
        shutil.copytree(work,temporary/'work',symlinks=True)
        shutil.copy2(source/'sites.csv',temporary/'sites.csv')
        write_json(temporary/'collection.json',updated)
        write_json(temporary/'verifier-adoption.json',dict(source_collection=str(source),
            previous_verifier_sha256=previous['verifier_sha256'],verifier_sha256=updated['verifier_sha256'],
            validated_cached_runs=cached,
            policy='solver/catalog/assets/settings identical; copy cached runs, reverify all jobs; no receipts promoted'))
        temporary.rename(destination)
    print(f'Adopted collection: {destination}')


if __name__=='__main__':main()
