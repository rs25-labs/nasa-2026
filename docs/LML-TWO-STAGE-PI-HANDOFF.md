# Pi handoff — v8 unresolved-region continuation

Run on the current `codex/lunar-precision-target` checkout. Codex prepared the
source but has not executed application code/tests. Preserve unrelated files
and all earlier profiles. Use the existing `.venv` and cached assets. No
installation, downloads, parameter sweeps or source/limit changes. Stop at the
first failure and return exact output and exit status.

## 1. Focused checks

Run sequentially from the repository root:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_two_stage.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_reuse_only.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_adaptive_bearing.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_horizon_reuse.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_result_store.py
```

All must exit zero. The new check demonstrates that the root and proved leaves
are not recomputed, initial evidence is frozen, bounds remain nested, the
partition stays complete, stage work sums correctly, and early success adds
no second-pass budget.

## 2. Fixed sample and time gate

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/profile_transition_sample.py --require-target --output data/local/lml/precision-target-v8-profile.json
```

Exit 0 requires width <=0.01 and measured calculation time <=60 seconds.
Exit 2 means failed precision; exit 3 means precision passed but the 60-second
allowance was exceeded. Other nonzero exits are execution failures. Stop on
any nonzero exit. This runtime allowance includes both passes and checkpoint
capture, but excludes final profile serialization, asset loading and process
startup. Return external wall time separately.

Return lower/upper bounds, width, target/latency flags, each stage's counters
and termination, and combined counts. Initial limits are 16,384 tile visits,
4,096 full classifications, 4,096 reuse checks and 32,768 terrain visits.
The second pass adds at most 8,192 / 2,048 / 2,048 / 8,192 respectively and
allows depth 12. The shared 65,536 area-strip and 128 adaptive-attempt ceilings
do not reset. Compare with v7's width 0.010592929572963818 / 37.2578 s.

Confirm the initial partition remains in the profile, every original proved
leaf is unchanged, and the final interval is nested in the initial interval.
If the first pass already meets the target, no second pass should be allocated.
UNKNOWN remains valid where complete evidence is unavailable.

## 3. Full day only if both fixed-sample gates pass

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/prepare_environment.py --work-dir data/local/lml --global-sources data/manifests/clps/composite-global-sources.json --start 2026-11-23T21:00:00Z --days 1 --offline --refresh
```

The returned report must be complete, the 2026-11-24T03:00:00Z Sun width must
be <=0.01, and `elapsed_wall_seconds` must be <=300. Report peak memory and
external wall time too. The 300-second allowance covers the reported pipeline
calculation, not evidence replay or final cache hashing. If either gate misses,
return the report and stop. Do not relax UNKNOWN labels or claim global precision.

Use the returned folder below, then replay the old reference:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<returned-run-id>
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261021T032155Z-485567c6
```

Both must exit zero. New replay checks initial and final partitions, retained
leaves/proof links, nested bounds and cumulative stage work as well as ordinary
source hashes, terrain evidence and durations. Both writer locks must be released
after completion; never delete a live process's lock.

Repeat the full calculation command once with `--refresh` removed. It must return
`cache_hit: true` and the same folder. Record wall time; the PRD cached-result
target is two seconds. No source edits should occur between calculation and hit.

## Return and stop

Return source commit, focused check outputs, fixed profile metrics/path, final
run ID if reached, report timing/memory, verifier outputs, cached-hit timing and
any failure. Keep generated evidence ignored. No API/UI or further refinement
changes in this batch. One next action: Codex reviews this evidence for a bounded
correction or milestone integration; never infer a pass from source inspection.
