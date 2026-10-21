# Pi handoff — v6 disk-edge area correction

Use the current checkout on `codex/lunar-precision-target`. Source is prepared,
not runtime-verified. Preserve unrelated files. No installation, downloads,
parameter sweep or budget changes. Stop at the first failure, return the exact
error plus output, and leave correction to Codex. The owner reviews results.

## 1. Focused checks

From the repository root, run these sequentially using the existing `.venv`:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_adaptive_bearing.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_horizon_reuse.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_result_store.py
```

Each must exit zero. The disk-area check now covers clipped quarter/interior/
outside areas, reflection, refinement and early work-limit accounting. Adaptive
checks retain the v4 proof rules. Codex has not executed these checks. The v5
duplicate-work experiment failed and was removed; this candidate changes area
accounting for already proved regions instead.

## 2. One fixed sample, with an explicit acceptance exit status

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/profile_transition_sample.py --require-target --output data/local/lml/precision-target-v6-profile.json
```

Uses the existing PR #9 reference's sample-a Sun at
2026-11-24T03:00:00Z and cached terrain. Records full area/proof evidence under
ignored `data/local`. Exit 0 requires fraction width <=0.01; exit 2 means that
the target was not met. In that case return the JSON metrics and stop. Do not
call a narrower interval a passing result if width still exceeds the target.

Preserve the earlier failed `precision-target-profile.json`. Return elapsed
seconds, lower/upper bounds, width, termination, terrain visits, attempt count,
clipped tile count and circle-area strips used/budget. Compare with v4/v5's interval
[0.40665914200781333, 0.4245932936659623], width 0.017934151658148993.
Record any widening; scheduling changes are not assumed monotonic.

## 3. Full one-day run, only after the fixed sample passes

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/prepare_environment.py --work-dir data/local/lml --global-sources data/manifests/clps/composite-global-sources.json --start 2026-11-23T21:00:00Z --days 1 --offline --refresh
```

Use the returned folder in:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<returned-run-id>
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261021T032155Z-485567c6
```

Both replays must exit zero. Confirm the full pipeline's fixed Sun sample also
has width <=0.01; cross-sample cache state may differ from the isolated profile.
Report the other samples' bounds, UNKNOWN states and durations without changing
their labels. Return runtime and peak memory against v4's 139.41 s / 382 MiB;
no speedup or global precision guarantee is assumed. Both writer locks must
be released by the finished run; never remove a live process's lock.

## Return

Return the source commit, commands' exit statuses and compact outputs, profile path, final
run ID if reached, verifier outputs, and fixed-sample acceptance result.
Do not commit generated evidence or broaden this into backend/API/UI work.
One next action after a failure: Codex corrects the measured failure on this
branch. After passing, the owner reviews the precision milestone for integration.
