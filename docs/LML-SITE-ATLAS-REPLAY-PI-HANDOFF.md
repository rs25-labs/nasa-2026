# Pi handoff — terrain-cache replay correction and pilot continuation

Use `codex/lunar-map-sky` at the commit supplied by Codex. No source edits,
installs, downloads, budget/precision changes or long collection. Codex has
read artifacts/source but has not run tests, verifier or data preparation.
Stop at the first genuine failure and return exact output plus one next action.

Original collection:
`data/local/lml/site-atlas/37782bb8f8af88b6148cf386802012b59a2202f35ebc7713b6901aff56fc3f13`

The original four verified jobs and fifth calculated result must remain intact.
Run 5: `20261021T173244Z-83a3dc5f`. Its saved inventory contains all 16,384 cache
nodes. The last three whole-disk proofs (`clearance-2830`–`2832`) terminate at
cache capacity. Failed tile traversals can allocate nodes without publishing a
clear certificate, so the old verifier's certificate-only replay did not
reconstruct the full allocation history. This is a source/artifact diagnosis;
the corrected replay below must confirm it.

The verifier now recomputes every saved cache node from the source terrain,
checks all saved node-enclosure fields, then replays against that final cache.
All clear/termination/terminal/visited-node comparisons remain exact. It does
not grant new clearance or change stored fractions. The package/solver source
is unchanged; only scripts/docs change so existing cached calculations can be
retained. Verifier bytes are separately included in the collection identity.

## 1. Focused regression and exact failing replay

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_clearance_replay_cache.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/site-atlas/37782bb8f8af88b6148cf386802012b59a2202f35ebc7713b6901aff56fc3f13/work/env-runs/20261021T173244Z-83a3dc5f
```

Require both exit zero. The synthetic check demonstrates that unpublished node
allocations change cold replay, that source-recomputed cache restoration
reproduces the saved result, and that tampered enclosure evidence is rejected.
The exact real run must pass all original evidence checks, including the three
cache-limit proofs, with no source-artifact changes. If it fails, return the
new proof-ID-specific message; no recalculation, adoption or workaround.

## 2. Adopt cached runs under the new verifier identity

Only after §1 passes, confirm no collector/worker is active and no live locks.
Do not delete lock files. Run:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/adopt_site_archive_verifier.py data/local/lml/site-atlas/37782bb8f8af88b6148cf386802012b59a2202f35ebc7713b6901aff56fc3f13
```

Record the printed new folder. The script requires exactly the old solver,
runtime, catalog and scientific assets; it copies the ~1.1 GB work cache into a
new collection with the updated verifier hash. It does not copy successful job
receipts or promote the failed job. Original evidence remains unchanged. If a
partial copy/mismatch is reported, stop and preserve it.

## 3. Finish the original six-job pilot and resume check

Use a persistent terminal/background session that survives tool timeouts, with
stdout/stderr saved to an ignored log. The earlier 1,200-second tool timeout
killed the collector while its separate-session worker continued; avoid that
execution pattern. Do not change source while this batch runs.

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/collect_site_archive.py --sites pub-cr01,pub-mmo01,exp-cr-xp --start 2026-11-19T00:00:00Z --end 2026-11-21T00:00:00Z --chunk-days 1 --max-jobs 6
```

Require the printed folder matches the adopted collection. First five worker
responses must be **cache hits with the original run IDs**; reverify them with
the corrected verifier. Only job 6 (`exp-cr-xp`, November 20) should perform a
new calculation. If an adopted job misses cache, stop rather than silently
redoing the expensive earlier runs. Queue `new_jobs` counts newly verified
receipts, not necessarily new calculations; inspect worker response cache_hit.

Require final six complete receipts and `complete: true`. Repeat the same
command once: `new_jobs: 0`, `resumed_jobs: 6`, no new workers/runs/verifier logs.
The app's saved results must remain unchanged. Retain UNKNOWN and true bounds;
there is no one-point acceptance target.

## 4. Summarize and return

Run `summarize_site_archive.py NEW_COLLECTION_FOLDER` using the same PYTHONPATH
and `.venv/bin/python`. Complete original
[atlas handoff §4](LML-SITE-ATLAS-PI-HANDOFF.md): three 98-row joined series,
18 seasonal rows, 12 mission-window rows, six seam records, six lineage rows,
dated site explanations, and zero-duration shared endpoints. Repeat summary
once without new calculations. Do not start the full 1,850-job archive.

Return commit, focused/exact verifier output, original/new folder IDs, adopted
cache-hit run IDs, job 6 timing/memory, all verifier outputs, zero-work resume,
summary checks, storage and unchanged app saved count. One next action: Codex
reviews the completed pilot for the long-collection handoff in a frozen checkout.
