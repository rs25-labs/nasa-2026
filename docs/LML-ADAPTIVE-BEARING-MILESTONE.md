# Adaptive bearing refinement milestone

2026-10-20. Owner requests finishing adaptive refinement before database work.
This checkpoint implements and verifies that refinement. Database, API/UI,
new assets/dependencies, training and SPHEREx remain outside its scope.
Execution, publication and merge use the owner's standing authorization;
no subagents. Generated assets/evidence remain ignored under `data/local`.

## Completed algorithm

The terrain model remains `lml-composite-cell-solid-v1`; the integration
method becomes `lml-projected-disk-bounds-v4`. Source data, heights, frame,
apparent disk geometry and time-sampling conventions are unchanged.

Start with the existing complete 1/8-degree coarse bearing bank. Refine only
unresolved tiles from disk depth four onward. A certified within-pixel circle
supplies an obstruction floor over the tile's bearings. Skip terrain traversal
if the tile straddles or falls below that floor: subdivision may resolve it,
but that tile cannot cheaply supply a new clearance opportunity. This floor
only selects work; the actual tile state still requires its own complete proof.

For tiles above the floor, select a containing parent certificate and a
child enclosure on a 1/128-degree angular grid. Clip to the parent's interval,
prove meridian inclusion outward, then query the complete terrain at the
tile-up lower endpoint. A successful proof can refine bearing width, minimum
clearance elevation, or both. Handle equivalent angle intervals across north.
Publish every attempt, parent ID, exact direction box, tile ID, source-circle
floor receipt, threshold and terrain-node count. Cache successful certificates;
failed attempts never become obstruction or visibility evidence.

Preparation retains its 8,192-node ceiling. Adaptive work uses only the
remaining existing shared 32,768 terrain-node visits, at most 512 per attempt
and 128 attempts. Tile visits remain capped at 16,384, classifications at
4,096 and disk depth at 10. Incomplete coarse banks retain the existing bounded
traversal fallback. These global node/tile/classification ceilings and the physical model are
unchanged. Per-candidate witness work is higher and is included in measured
runtime.

## Stronger witnesses and complete cache coverage

For a source pixel, retain the former center-circle proposal and consider up
to two ranked intersections of the bearing with inset pixel edges. Float math
proposes/ranks circles. Each accepted circle independently proves containment
inside one valid pixel and the nominal cap, bearing coverage, and an outward
elevation lower bound. This moves a witness within an existing constant-radius
pixel solid; it introduces no interpolated height or invented terrain detail.
The candidate search is bounded and incomplete; missed witnesses remain unknown.

A geometry-only lower probe uses the tile's east/north intervals and an up
threshold of -1. It supplies a bearing obstruction floor for scheduling, not
a classification of the real celestial disk. Any BLOCKED tile must recertify
its circle with the actual direction-up upper endpoint. Artifact replay checks
both kinds of receipt against the source pixel and exact deciding intervals.

Adjacent complete certificates can jointly cover a tile crossing a bearing
seam. Join only closed dyadic intervals with exact matching/overlapping edges,
no gaps, and adequate elevation in every component. Strict outer-wedge interval
inclusion must contain the entire tile. Record every component proof ID in
`reuse_of_all`. Neither single-certificate nor union reuse is remembered as a
new root certificate, so there are no cache-reuse chains. Adaptive parent links
remain explicit and may form a refinement hierarchy; every parent must already
be published and independently clear.

The existing sky-certificate cache remains capped at 128 roots. Memoize only
geometric bearing enclosures and wedge normals in two 4,096-entry LRU caches;
reuse the existing 8,192-entry trigonometry cache. The witness-proposal cache
also remains capped at 4,096 entries, now with LRU replacement and refresh on
hits; reaching capacity cannot freeze out later geometry. These caches contain no site
terrain decisions and do not relax interval comparisons.

## Validation and measurements

Focused analytic checks first exposed the former center-only witness limit,
then the missing adaptive helper, repeated elevation refinement at the minimum
angular width, and joining adjacent certificates. Checks cover opposite and
wrapped bearings, known mixed tiles, zero work, valid parents, full-cache
replacement, exact budget
debits, seam coverage and rejection of coverage gaps/low elevations. Existing
horizon-reuse, precision, composite-clearance and analytic disk-area checks pass.

The artifact verifier replays the complete terrain of every adaptive attempt,
checks its parent enclosure and lower threshold, recertifies its obstruction
floor, reconstructs the real tile direction, resolves union components, and
checks preparation/adaptive/shared work accounting. Historical cache policies
explicitly disable the newer union shortcut during legacy replay.

One preliminary profile was stopped when repeated sector trigonometry dominated
cost; bounded geometry memoization fixed the measured duplication. Subsequent
fixed-input profiles narrowed width to 0.0280 and then 0.0181. The latter reached
64 attempts with about 6,000 shared terrain-node visits still available. The
final allocation permits up to 128 attempts, retaining the same global ceiling.
A full-run check also exposed the existing witness cache freezing at capacity;
a focused saturation regression now verifies bounded LRU replacement. These
are one fixed input and measured code changes, not a parameter search.

Final offline run: `data/local/lml/env-runs/20261021T032155Z-485567c6/`.
Same sample-a site (-89.54 latitude, 0 longitude, 2 m observer), start
2026-11-23T21:00Z, one day at six-hour samples. All nine cached assets reused;
fourteen nonempty artifacts, no downloads, both locks released.

| Sun sample | PR #8 fraction interval | Adaptive refinement |
| --- | --- | --- |
| Nov 23 21:00Z | [0, 0.009998] UNKNOWN | [0, 0.009998] UNKNOWN |
| Nov 24 03:00Z | [0.3835105684, 0.4957632577] PARTIAL | [0.4066591420, 0.4245932937] PARTIAL |
| Nov 24 09:00Z | [0, 0.779006] UNKNOWN | [0, 0.776422] UNKNOWN |
| Nov 24 15:00Z | [0.683966, 0.928369] PARTIAL | [0.777881, 0.922910] PARTIAL |
| Nov 24 21:00Z | [1, 1] FULL | [1, 1] FULL |

Displayed endpoints are rounded outward. The fixed 03:00 width is
**0.017934151658148993**, or **1.7934 percentage points**, **84.02% narrower**
than PR #8. It makes 87 adaptive attempts, using 25,523 terrain visits plus
7,245 preparation visits: all 32,768 shared visits. Tile, classification and
depth limits also occur. **The 0.01 target is not reached.** This is completion
of the adaptive algorithm, not completion of precision acceptance. Merely
increasing its attempt cap again cannot supply more terrain work.

The 15:00 width narrows from 24.44 to 14.50 percentage points, using 109
adaptive attempts and the full shared terrain budget. The 09:00 Sun remains
broad and UNKNOWN. Every final Sun interval is nested inside or equal to its
PR #8 interval; all Earth endpoints and states match PR #8 exactly. This is
an observed comparison, not a universal monotonicity guarantee across methods.

Final states remain Sun 1 FULL / 2 PARTIAL / 2 UNKNOWN and Earth 2 FULL /
3 UNKNOWN. Each body accounts for 24 left-held hours. Sun has 12 PARTIAL and
12 UNKNOWN hours, with all-duration mean bounds approximately [0.2961,0.5335].
The terminal FULL Sun adds zero duration. Earth retains 12 FULL and 12 UNKNOWN
hours and mean bounds approximately [0.9950,1]. Partial/unknown results have
no fabricated scalar fraction.

Full-run runtime is **139.41 s**, peak process memory **382.00 MiB**, versus
PR #8's **80.30 s / 337.41 MiB**. Runtime increased **73.61%**; the improved
precision is not a speedup. These are individual local cached-asset runs,
not a controlled benchmark or service-latency guarantee. The cache fix reduced
the intermediate run's 196.57 seconds by **29.08%**, with identical final
fraction endpoints and proof counts. Intermediate run
`20261021T031643Z-1201de54` is marked superseded.

Evidence replay passed **1,024 clearance proofs**, **eight complete disk
partitions**, **726 single-certificate reuses**, **32 combined-coverage reuses**
and **1,003 adaptive-circle region receipts**. This includes all 196 adaptive
attempts, their source-circle scheduling floors, parent links, threshold and
bearing inclusion, source hashes, exact area accounting, shared work, durations
and released locks. The plot was inspected and source reviewed inline.

All five focused scripts pass. Historical v3, v2 and v1 reference evidence
also replays: 1,212, 300 and 71 clearance proofs respectively, each with eight
complete disk partitions. This checks numerical/model evidence, not physical
terrain accuracy.

Reproduce with the exact composite offline one-day command in
[LML-HORIZON-REUSE-MILESTONE.md](LML-HORIZON-REUSE-MILESTONE.md). Verify with:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_adaptive_bearing.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_horizon_reuse.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_precision.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_composite_visibility.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261021T032155Z-485567c6
```

## Take stock

Adaptive bearing refinement is implemented. Fraction-width acceptance and
runtime acceptance are assessed from the actual measurements above, separately
from implementation completion. Uniform precision, physical terrain-height
uncertainty, continuous event timing and L03 release readiness are not implied.
Six-hour left-held durations remain sampled estimates. Bounds and labels remain
conditional on solid raster pixels and reported geometric directions.

Database work has not started. The completed artifacts remain suitable for
later immutable result storage with source/model/method identities intact.
