# Planner app — first usable slice

The owner explicitly retires the 1-percentage-point numerical target as an
app/release gate. Stop precision experiments. Keep calculated lower/upper bounds,
UNKNOWN labels, provenance and evidence verification. V8's measured fixed width
is 0.010344217526156609 at 51.1845 seconds; it is accepted as sufficient to move
on, not relabeled as a passing 0.01 benchmark. No further numerical changes.

Build the first local planner slice now, with the existing Python runtime and
CSV/JSON result store. A standard-library HTTP server serves static HTML/CSS/JS
and a small same-origin API. One background calculation subprocess uses the
existing pipeline and writer lock; the browser polls actual job state/elapsed
time. A busy server returns a clear response rather than creating an unbounded
queue. Jobs are small JSON files; completed results retain their existing files.

UI: polar coordinate schematic plus editable coordinates, UTC start, duration
and height; calculate/cancel/retry; saved-result list; Sun/Earth summary ranges,
sampled intervals and detailed sample bounds; CSV/JSON exports. The coordinate
schematic is explicitly not a terrain basemap. No fabricated percentages,
midpoint estimates, demo calculations or Earth-center link claims.

Pi launches the app and checks a new one-day input, saved reopen, cache reuse,
exports, errors and cancellation. The full calculation's evidence must replay;
there is no fractional-width rejection gate. App interaction remains responsive
while calculation is pending. Codex writes source/handoff only; no execution or
subagents. Commit/push source, then owner reviews Pi's running app.

Comparison/date search, a terrain basemap, synchronized sky view and the training
engine remain required later slices. Their absence does not block this first
usable planner review. Avoid claiming the full PRD or backend is complete.

## Pi review and bounded corrections

Pi reports the initial app slice completed real calculations, evidence replay,
exports, saved reopen and cache hits. Measured cold run was about 204 seconds /
445 MiB, with cache hits 0.43–0.44 seconds. Full findings are in
[Pi's handoff](LML-PLANNER-CANCEL-CODEX-HANDOFF.md) identified two defects: cancel
did not interrupt the worker and rejected submissions were not visible in the
UI. Pi now reports the [focused fix handoff](LML-PLANNER-FIXES-PI-HANDOFF.md)
passed on `28387ec`: real cancellation in 2.2 s with locks released, visible
validation/422/409 messages, and saved/export smoke checks. See the
[verified milestone](LML-PLANNER-MILESTONE.md). No new numerical acceptance gate.
