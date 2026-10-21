# First usable planner milestone — Pi verified

Owner supplied Pi's completion report for source commit
`28387ec2d545cf5ce8711a03003fed8d0f2ba969` on 2026-10-21. Pi reports all
focused correction checks passed, with no source/limit changes or live-lock
deletions. Codex did not run application code/tests. The server was left running
and idle at http://127.0.0.1:8765 for the owner.

## Working slice

Site/date/height input and polar coordinate schematic; one background calculation
with state and elapsed time; Sun/Earth-disk summary ranges, sampled timelines and
sample bounds; CSV/JSON exports; saved-result reopening and automatic matching
result reuse; cancellation/retry and visible input/API errors. Runtime uses the
existing Python environment and CSV/JSON storage, without a database or new
runtime dependency.

Initial Pi review completed a real one-day calculation in approximately 204 s,
with 445 MiB peak memory. Evidence replay passed 1,681 clearance proofs and 12
initial/final disk partitions. Exports matched their saved files. Repeated
requests used the same saved result in 0.43–0.44 s; reported page reload was
3.2 s and saved reopen 2.2 s. These are local observations, not service guarantees.

## Correction verification

- `check_planner_cancellation.py` and `check_planner_requests.py`: exit zero.
- Fresh real calculation: Cancel reached `cancelled` in 2.2 s; child reaped,
  both pipeline locks released, no completed saved result. A second cancellation
  during the busy-request check completed cleanly in approximately 3.2 s.
- Latitude 0: visible validation message, previous success title replaced,
  keyboard focus moved to the field, no request sent.
- Browser-valid interval beyond kernel coverage: actual HTTP 422 message visible
  in status/alert and accessibility tree.
- Busy HTTP 409: exact server message visible; no second worker launched. During
  the second-session check the running job continued to be tracked correctly.
- Saved reopen and CSV export smoke checks passed. Only expected ignored partial
  folders were added. No full recalculation or precision experiments were repeated.

Pi screenshot references: `/tmp/lml_fixes_lat0.png`, `/tmp/lml_fixes_422.png`,
`/tmp/lml_fixes_409_alert.png`; these are local review artifacts, not Git assets.
The earlier [findings](LML-PLANNER-CANCEL-CODEX-HANDOFF.md) describe the now-fixed
defects. The [correction handoff](LML-PLANNER-FIXES-PI-HANDOFF.md) is completed.

## Scope and next milestone

The owner retired the 1-percentage-point width gate. Actual ranges and UNKNOWN
states remain explicit; the historical 0.01 benchmark is not relabeled as met.
Evidence integrity remains required. Numerical optimization is not the next task.

This is the first planner slice, not the full PRD. The current map is a labeled
coordinate schematic. Recommended next app milestone: terrain map and
synchronized sky/timeline interaction, using these real calculated results.
Scenario comparison/date search and outpost setup/training remain later required
slices. No deployment or complete-product claim is made here.
