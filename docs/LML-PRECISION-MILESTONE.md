# Measured visibility precision checkpoint

2026-10-20. This follows PR #6's finite-disk milestone. The owner authorized
implementation, bounded execution and PR/merge delivery, then a stop to take
stock. No subagents, new data, dependencies, UI, training or SPHEREx work.

## Delivered numerical changes

The terrain model stays `lml-composite-cell-solid-v1`. Its constant-radius
source pixels have not gained interpolated heights or physical accuracy.
The numerical method is now `lml-projected-disk-bounds-v2`:

- Polar rectangles may split inside a source pixel down to 1/256 pixel per
  axis (0.15625 m projected). Each enclosure retains the maximum radius of
  every source pixel intersected by its interior; adjacent closed rectangles
  cover the shared edges. This tightens geometric enclosures of the same
  pixel solid. Missing/invalid cells still cannot prove clearance.
- Region wedges may use dyadic half-widths down to 1/1024 degree. Float corner
  bearings propose a width; strict outward interval inclusion accepts it.
- Up to 128 successful clearance certificates can be reused above their proved
  minimum elevation sine and inside their proved meridian wedge. Store full
  interval coefficients, a proof ID and each reuse link; never reuse a reused
  certificate. Down-rounding the threshold to 0.00001 makes reuse conservative.
- Up to eight outer-cell candidates can propose an additional circle witness
  per classification. A bounded Newton projection proposes its location and
  size; interval source-pixel/cap containment, forward-bearing inclusion and
  elevation comparisons independently decide blockage. Cache at most 4,096
  proposals. Published circle receipts replay from their decimal geometry.

The existing limits remain: 16,384 tile visits, 4,096 classifications, depth
10, 32,768 shared terrain-node visits, 512 nodes per region and a 16,384-node
site cache. The whole-disk attempt retains 4,096 visits. These are work caps,
not a wall-clock service guarantee. Failed proofs and exhausted budgets leave
UNKNOWN area. Scalar fractions still require a whole-disk proof of zero/one.

## Validation and measured limits

Focused checks cover certified reuse inclusion/rejection and no reuse chains,
exact subpixel partitions, legacy splitting, certified adaptive-circle receipt
replay and rejection of invalid/oversize witnesses. Existing analytic half-disk
and composite-clearance checks pass. The artifact verifier replays published
wedge coefficients/thresholds before caching them, resolves reuse links and
re-evaluates adaptive circles, disk partitions, source hashes and durations.
Legacy evidence defaults to span=1 and the original wedge policy.

The fixed input remains sample-a (-89.54 latitude, 0 longitude, 2 m observer),
2026-11-23T21:00:00Z for one day at six-hour samples, with the same nine cached
assets. No parameter search or additional asset acquisition was performed.
The small profiling helper replays only the previously measured Sun sample
from the ignored PR #6 reference run.

Profiling showed that deferred clearance traversal worsened precision. Visiting
higher disk tiles first also widened the interval despite some cache hits.
Both scheduling changes were discarded; the original area-first order remains.
Adaptive witnesses passed analytic checks but supplied no accepted receipts in
the fixed Sun profile. Its cache had zero hits; do not attribute its improvement
to reuse or new obstruction witnesses. Tighter clearance geometry is the
measured benefit. A profile is not a full-pipeline runtime measurement.

Final offline run: `data/local/lml/env-runs/20261021T023215Z-b50ee60c/`.
It exited zero, reused all nine cached assets, produced fourteen nonempty
artifacts and released both locks. Elapsed time **114.10 s**, peak process
memory **365.02 MiB**, versus PR #6's **60.88 s / 334.20 MiB**. These are
individual local measurements, not a controlled benchmark or latency promise.

| Fixed comparison | PR #6 | This checkpoint |
| --- | --- | --- |
| Sun 2026-11-24T03:00Z fraction | [0.1507037223, 0.5962696432] | [0.3379711169, 0.5969253413] |
| Width, percentage points | 44.56 | 25.90 |
| Sun 15:00Z fraction | [0.0362, 1] | [0.7692, 1] |
| Sun 21:00Z state | UNKNOWN | FULL |
| Earth 15:00Z fraction | [0.6482, 1] | [0.9900, 1] |
| Earth 21:00Z fraction | [0.4920, 1] | [0.8658, 1] |

Bounds in this table are rounded outward. The fixed 03:00 Sun remains
PARTIAL with exact exported width 0.2589542243220017, **41.88% narrower**;
its upper endpoint is slightly looser because a different area partition
spends the fixed budget. It still exhausts tile, classification and shared
terrain-node budgets. The 09:00 Sun remains fully unresolved [0,1].

Final counts: Sun 1 FULL / 1 PARTIAL / 3 UNKNOWN; Earth 2 FULL / 3 UNKNOWN.
All 24 left-held hours per body are accounted for. The terminal FULL Sun
sample has zero duration, so it adds no FULL hours. Earth has 12 FULL hours
and 12 UNKNOWN hours; its all-duration mean bounds narrow to approximately
[0.9950,1], with no fabricated scalar for the UNKNOWN periods.

Across the full run the bounded sky cache recorded 247 hits and retained
43 certificates. No adaptive-circle obstruction receipts were accepted.
Tighter geometry improves several samples, but the total run is slower;
certificate reuse has not established an overall speedup.

Verification: all three focused scripts passed. The new run replayed **300
clearance proofs and eight complete disk partitions**; the historical PR #6
transition replayed **71 proofs and eight partitions** under legacy policy.
The new plot was inspected. An initial historical replay reached its final
lock-release assertion while the new run was active; rerunning after that
run finished passed. No lock was deleted or bypassed.

Reproduce the full one-day run with the composite offline command in
[LML-PI-HANDOFF-02.md](LML-PI-HANDOFF-02.md), using
`--start 2026-11-23T21:00:00Z --days 1`. Verify with:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_precision.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_composite_visibility.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261021T023215Z-b50ee60c
```

Downloaded/generated artifacts remain ignored; source, verification helpers
and this checkpoint record belong in Git.

## Take stock

This is a verified precision increment, not L03 acceptance. The 0.01 fraction
width target, uniform practical precision, continuous event-time certificates,
physical terrain-height uncertainty and API/result-cache latency are still
open. NASA supplies the inputs; these labels remain conditional on our solid
pixel model and reported geometric directions. Six-hour left-held durations
remain sampled estimates. The full working web application remains to be built.

**One next action:** implement a bounded per-bearing horizon certificate that
can be reused across disk tiles, and evaluate it on this same fixed transition
against the width and runtime recorded here. Avoid raising global budgets or
starting planner UI work until that comparison is reviewable. Stop here for
the owner's milestone stocktake.
