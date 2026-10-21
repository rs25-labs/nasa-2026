# Pi handoff — launch the planner app

Pi completed this review and returned two defects in
[its findings](LML-PLANNER-CANCEL-CODEX-HANDOFF.md). The active successor is the
[bounded correction handoff](LML-PLANNER-FIXES-PI-HANDOFF.md). Do not repeat the
entire cold-calculation batch just to verify those two fixes.

The owner has retired the 1-point width target as a release gate. Do not run
the precision-profile experiments or try to improve numerical bounds. This
batch launches and checks the app using its actual results, including UNKNOWN.

Use the current `codex/lunar-precision-target` checkout. Codex has prepared
source only; application execution and browser checks belong to Pi/owner.
Keep all existing assets, reports and unrelated changes. No new dependencies
or downloads are needed.

## Start

From the repository root, run the focused input check:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_planner_requests.py
```

Then start the app in a terminal that will remain open:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Open **http://127.0.0.1:8765** in the owner's browser. If the port is occupied,
report that or choose another explicit `--port`; do not kill unrelated services.
The service binds only to the local machine. No production hosting is part of
this slice.

## Bounded app checks

1. Confirm the form and polar coordinate schematic render at desktop and phone
   widths. Keyboard navigation must reach inputs, calculate, saved-result buttons
   and exports. Open an existing saved result if available; inspect real summary
   ranges, both timelines and sample table. The schematic must be labeled as such.

2. Submit the default one-day mission (new site name `my-site`, -89.54 latitude,
   0 longitude, 2 m height, start 2026-11-23T21:00Z). The request should acknowledge
   promptly; poll queued/running state and actual elapsed time while the page
   stays usable. Do not require a completion percentage. A second simultaneous
   submission must be rejected clearly rather than launching another worker.

3. Wait for a complete result. Wider ranges, PARTIAL and UNKNOWN are acceptable;
   **there is no 0.01 width gate**. Confirm result dates/site match the request,
   full/partial/blocked/unknown durations agree with the saved report, terminal
   samples add no duration, and unresolved scalars have not become zero/midpoints.
   Record observed runtime/memory, without tuning the solver.

4. Download the sample/interval/summary CSVs and evidence report JSON. Verify
   the new full-run evidence once, substituting the run ID displayed by the app:

   ```bash
   PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<run-id>
   ```

   This is an integrity check, not a precision-target experiment. A genuine
   execution/proof error is a defect to return; width above 1 point is not.

5. Submit the identical mission again. It must report a matching saved result,
   `cache_hit: true`, and the same run ID. Reopen from Saved calculations and
   refresh the browser. Record cache/reopen latency; do not change data storage.

6. Start a new calculation with a different site name, cancel while running,
   and confirm it reaches cancelled without a new completed saved result. The
   child must release `.environment.lock`/`.foundation.lock`; never remove a live
   process's locks. Retry the same inputs through the app. Check an invalid
   request (e.g. latitude 0 or dates outside 2026–2028) gives an understandable
   error. Inspect the browser console for unexpected errors.

Leave the app running for the owner after checks. If stopping, use Ctrl+C in
the server terminal; it requests graceful child cancellation rather than killing
the calculation or deleting locks.

## Return

Return the running URL, one app screenshot, source commit, input-check result,
new run ID and evidence-verifier result, observed cold/cache timings, and any
specific functional error. Stop at the first genuine failure and return its
command/log. Keep generated data and job logs under ignored `data/local/lml`.
Do not start another numerical-refinement batch.

This is the first planner slice. Terrain basemap, synchronized sky view,
comparison/date search and outpost training are later app slices, not claimed
complete here.
