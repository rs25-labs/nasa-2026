# Pi handoff — frozen-source 50-site seasonal collection

The owner approved the mixed catalog and 2026–2028 archive; the six-job pilot
and corrected verifier have passed. Codex supplies this handoff, not execution.
No installations, downloads, source edits, numerical/budget changes, precision
gates or database. Preserve both pilot collections and app results. Stop on the
first genuine failure, retaining logs/receipts and one concrete next action.

Use this current handoff, but **execute the collection source frozen at**
`214ba7e5d25964d978103764315d074df5a71b5e`.
That is Pi's verified solver/collector/verifier version. Do not run the long
batch against the editable application checkout or keep extracting updates
over its source. Shared `.venv` and scientific assets must stay unchanged while
the batch runs; UI work may continue in the main repository. If new UI work
needs different dependencies, use a separate environment for that work.

## 1. Create the source snapshot once

From the repository root, use task-specific shell variables:

```bash
ATLAS_REPO=/Users/msreedhar/Documents/Projects/NASA2026
ATLAS_SNAPSHOT="$ATLAS_REPO/data/local/lml/source-snapshots/214ba7e"
mkdir -p "$ATLAS_REPO/data/local/lml/source-snapshots"
mkdir "$ATLAS_SNAPSHOT"
set -o pipefail
git -C "$ATLAS_REPO" archive 214ba7e5d25964d978103764315d074df5a71b5e | tar -x -C "$ATLAS_SNAPSHOT"
git -C "$ATLAS_REPO" rev-parse 214ba7e5d25964d978103764315d074df5a71b5e > "$ATLAS_SNAPSHOT/SOURCE_COMMIT.txt"
```

If the snapshot already exists, do not overlay or delete it. For a documented
resume of this batch, reuse its recorded unchanged snapshot; otherwise return
the existing path for inspection. Extraction/setup must succeed before any
worker starts. Source/assets/logs remain under ignored `data/local`.

Preview using the frozen source and the existing runtime:

```bash
PYTHONPATH="$ATLAS_SNAPSHOT/apps/clps/api/src" "$ATLAS_REPO/.venv/bin/python" "$ATLAS_SNAPSHOT/apps/clps/scripts/collect_site_archive.py" --plan
```

Require 50 sites (20 published, 30 exploratory), 1,850 jobs, one-hour samples,
2 m observer height, full range 2026-01-01 through the 2029-01-01 terminal
boundary. No computation or file writes from `--plan`.

## 2. First full-size chunk checkpoint

The pilot used one-day chunks; validate the first 30-day chunk before committing
the remaining queue. Same collection settings as the final archive; max-jobs
only limits newly processed receipts and does not change identity.

Record the app saved count/IDs. Launch detached so a tool timeout cannot kill
the collector. Set the shell variables above again if using a fresh terminal.

```bash
nohup env PYTHONPATH="$ATLAS_SNAPSHOT/apps/clps/api/src" "$ATLAS_REPO/.venv/bin/python" -u "$ATLAS_SNAPSHOT/apps/clps/scripts/collect_site_archive.py" --assets-root "$ATLAS_REPO/data/local/lml" --output "$ATLAS_REPO/data/local/lml/site-atlas" --max-jobs 1 > "$ATLAS_REPO/data/local/lml/atlas-first-chunk.log" 2>&1 < /dev/null &
ATLAS_FIRST_PID=$!
printf '%s\n' "$ATLAS_FIRST_PID" > "$ATLAS_REPO/data/local/lml/atlas-first-chunk.pid"
```

Record PID, printed collection folder and log. Wait through a persistent session
with spaced read-only progress checks. Do not start another writer or remove
locks. A valid result requires:

- All 50 terrain preflights succeed.
- First `pub-cr01` chunk, 2026-01-01 to 2026-01-31, completes and verifies.
- Its series has 721 timestamps per body (1,442 rows), correct dates/hourly
  cadence, source hashes and actual bounds/UNKNOWN states. Record unknown
  duration, runtime, memory and storage; wide bounds/UNKNOWN are not failures.
- Progress: `new_jobs: 1`, `total_jobs: 1850`, `complete: false` (expected because
  the remaining queue has not run). App saved results remain unchanged.

Do not infer a precise overall completion time from this one chunk. If these
checks pass, proceed to §3 without repeating the pilot or waiting for another
approval. On a failure, stop and return the job/logs; do not change chunk sizes,
parameters or sites as a workaround.

## 3. Continue the full queue

Only after the checkpoint process exits successfully and releases its locks:

```bash
nohup env PYTHONPATH="$ATLAS_SNAPSHOT/apps/clps/api/src" "$ATLAS_REPO/.venv/bin/python" -u "$ATLAS_SNAPSHOT/apps/clps/scripts/collect_site_archive.py" --assets-root "$ATLAS_REPO/data/local/lml" --output "$ATLAS_REPO/data/local/lml/site-atlas" --max-jobs 1850 > "$ATLAS_REPO/data/local/lml/atlas-full.log" 2>&1 < /dev/null &
ATLAS_FULL_PID=$!
printf '%s\n' "$ATLAS_FULL_PID" > "$ATLAS_REPO/data/local/lml/atlas-full.pid"
```

Require the same collection folder; first completed receipt is skipped. The
remaining jobs run serially, offline, verifying each before marking it complete.
No need to rerun the synthetic checks or startup/UI batches. Each completed job
is retained across restarts. For a resume, use the same snapshot/runtime/settings
and command only after confirming no earlier collector/worker or live locks.
Do not remove a lock simply because the foreground tool ended; a separate-session
worker may still be active. Return uncertain/stale-lock cases for inspection.
While active, count complete job receipts and read the current log; progress.json
summarizes the last invocation that returned and is not a live progress counter.

The full batch may substantially exceed a day; runtime is not yet measured.
If Pi's session ends while the detached batch is running, return **running**
with PID, collection folder, progress and log path. Do not claim completion or
launch a duplicate. On a real failure return the failed receipt/log; no retries
with altered settings. No recurring automation is required by this handoff.

## 4. Final acceptance and summaries

After the collector reports `complete: true`, require 1,850 completed receipts
and verification logs. Confirm app saved results still have the same IDs.
Repeat the same collection command once (persistent execution if validation is
slow): `new_jobs: 0`, `resumed_jobs: 1850`, no new runs or verifier logs.

Set ATLAS_COLLECTION to the actual recorded folder, then run the frozen summary
script in a persistent session, saving output to an ignored log:

```bash
PYTHONPATH="$ATLAS_SNAPSHOT/apps/clps/api/src" "$ATLAS_REPO/.venv/bin/python" -u "$ATLAS_SNAPSHOT/apps/clps/scripts/summarize_site_archive.py" "$ATLAS_COLLECTION"
```

Require a hashed `summary/complete.json` and:

- 50 joined site series, each 52,610 rows: 26,305 hourly timestamps per body,
  including one final zero-duration boundary. Total 2,630,500 body rows.
- 4,000 seasonal rows: 36 complete months, three complete years and one full
  collection scope, two bodies, 50 sites. Period flags must be correct.
- 433,600 mission-window body rows: daily starts with full 1/7/14/30-day
  coverage only. No windows beyond the collected range.
- 3,600 seams and 1,850 lineage rows; 50 sourced, dated site profiles.
- Spot-check earliest/final timestamps, leap day, a chunk seam, uncertainty
  preservation and cross-chunk obstruction durations. Repeat summary once:
  byte-identical files, no calculations. No fabricated overall safety scores.

Return source commit, snapshot/runtime identity, collection path, checkpoint
metrics, final receipts/resume status, total runtime/storage, summary checks and
unchanged app saved results. Leave the app running idle, with no live batch
workers or held locks once finished. One next action: Codex reviews the completed
archive and connects site cards/calendar/date search/comparison to the data.
