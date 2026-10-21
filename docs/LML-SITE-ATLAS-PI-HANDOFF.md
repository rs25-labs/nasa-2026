# Pi handoff — mixed catalog and hourly archive pilot

Use `codex/lunar-map-sky` at the commit supplied by Codex, existing `.venv` and
cached scientific assets. Codex has not run these scripts/tests. No dependencies,
downloads, app deployment, numerical-policy changes or precision-width gates.
Finish the current Moon-entry visual batch first; this collection is a separate
bounded batch. Preserve unrelated files and the running app's saved results.
Stop at the first genuine failure, retain exact output, and return one next
action. Do not substitute new sites/settings to work around a failed pilot.

## 1. Focused check and workload preview

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_site_archive.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/collect_site_archive.py --plan
```

Require check exit zero. Preview must show 50 IDs, 20 published + 30 exploratory,
1,850 jobs, 1-hour cadence, 2 m observer height, 2026–2028 support. This preview
does not write files, assess terrain or launch calculations. Source coordinates
are in `data/manifests/clps/landing-candidates.csv`, Table A1 of
[Wueller et al. (2026)](https://doi.org/10.1029/2025JE009434). Cross-check
CR01, MMO01 and PNS01 against that table. Exploratory IDs disclose their
parent and 500 m projected offset; they are not official landing selections.

## 2. Pilot preflight: all 50 terrain points, only three selected for processing

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/collect_site_archive.py --sites pub-cr01,pub-mmo01,exp-cr-xp --start 2026-11-19T00:00:00Z --end 2026-11-21T00:00:00Z --chunk-days 1 --preflight
```

Require exit zero. Record the printed **Collection** folder under ignored
`data/local/lml/site-atlas/<identity>/`. Inspect its `sites.csv`: 50 locations,
source IDs/URLs, correct kinds, actual elevations and terrain SHA, 40 m source
spacing, local 5×5-neighborhood completeness and diagnostic slope/relief where
available. A usable site point can have an incomplete neighborhood; that must
leave slope/relief blank, not invent flat ground. A point lookup failure stops
the batch. No location is labeled safe or automatically good/fair.

No solver jobs or app saved entries should be created by this preflight.

## 3. Two-day hourly pilot, six sequential jobs total

Record the app's current `/api/saved` count and run IDs first. Then:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/collect_site_archive.py --sites pub-cr01,pub-mmo01,exp-cr-xp --start 2026-11-19T00:00:00Z --end 2026-11-21T00:00:00Z --chunk-days 1 --max-jobs 6
```

Require six completed jobs and final `complete: true`. Each job automatically
runs the existing evidence verifier and stores its log/hash before marking the
receipt complete. Report real runtimes, peak memory from reports, output disk
size, states/UNKNOWN counts and any broad bounds; neither UNKNOWN nor width
above one percentage point is a failure. No fixed wall-time target is imposed.

The collector uses the verified macOS spawn helper after preflight loads
projection code. A private `work/assets` link reuses cached assets read-only;
receipts/index/locks/runs belong to the collection workdir. Confirm app saved
count/IDs are unchanged. Do not run a second writer in the same collection or
remove locks. Do not run rebuild-index on the interactive app root.

Repeat that **same command once**. Require `new_jobs: 0`, `resumed_jobs: 6`,
`complete: true`, no new env-run directories/logs or verifier reruns. Artifact
integrity checks during resume are expected. All source/runtime/settings/source
asset identities are pinned; preserve this checkout during collection.

## 4. Join and summarize without recalculation

Replace the folder argument with the actual printed pilot collection folder:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/summarize_site_archive.py data/local/lml/site-atlas/<identity>
```

Require exit zero and `summary/complete.json` with hashes/provenance:

- Three `*-timeseries.csv` files, 98 rows each: 49 distinct hourly UTCs per body
  over 48 hours. Shared chunk endpoint contributes no extra duration.
- `seasonal.csv`: 18 rows (collection/month/year × two bodies × three sites).
  Each summary spans 48 hours, not a full month/year. Month/year
  `period_complete` must be false. Bounds and UNKNOWN hours remain visible.
- `mission-windows.csv`: 12 rows (two complete daily one-day starts × two
  bodies × three sites). No seven/14/30-day windows from this short pilot.
- `seams.csv`: six shared-boundary records. Geometry must match; fraction
  intervals may differ if compatible. Next chunk owns the boundary for elapsed
  time; both original results remain in immutable source folders.
- `lineage.csv` identifies all six verified runs/cache keys. `site-profiles.json`
  explains sourced inclusion, terrain context and calculated conditions over
  this exact pilot range. No fabricated ice/access claims or safety ratings.

Compare at least first/shared-boundary/final samples against original run CSVs.
The shared boundary must use the second chunk's starting row. Record sampled
sunlight/Earth summaries, longest obstruction basis and unknown duration for
each site. Repeat summary once: same values, no new calculations. Generated
files stay ignored; make no source changes. Leave app running idle.

## Stop and return

Return commit, focused-check output, source coordinate spot-check, 50-point
preflight, folder path, six job/run IDs and verifier logs, actual timing/storage,
zero-job resume, summary row counts/spot-checks and unchanged app saved results.
No full three-year collection in this pilot handoff. One next action: Codex
reviews the evidence and prepares the long collection batch and atlas UI work.
The full 50-site queue is already expressible by the script, but do not start
it until that bounded next batch is reviewed by the owner.
