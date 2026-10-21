# Bearing horizon reuse milestone

2026-10-20. Continue from PR #7 with the owner's authorization to execute,
verify, publish and merge, then stop at a reviewable checkpoint. No new NASA
assets, dependencies, API/UI, training, SPHEREx work or subagents.

## Numerical contract

The composite terrain model remains `lml-composite-cell-solid-v1`. Numeric
integration is `lml-projected-disk-bounds-v3`. Polar heights, frame, ephemeris,
physical uncertainty and time-sampling conventions are unchanged.

For disks overlapping their diagnostic horizon elevation, propose at most
sixteen fixed 1/8-degree bearing wedges before subdivision. Disks away from
that proposed transition retain the existing traversal policy. This is work
selection, never a visibility decision. Each has at most four threshold attempts.
A diagnostic horizon only proposes the first threshold (diagnostic +0.05°);
a successful complete proof allows three lower proposals inside a 0.1° range.
A failed proof is not a lower horizon bound or an obstruction witness.

Every accepted upper certificate independently proves the entire exterior
below its threshold, and partitions the complete polar model into rectangles
outside the cap, outside the meridian wedge, or below the threshold. The
existing outward arithmetic, subpixel geometry and missing-data rules apply.
Store wedge angles, full interval normals, minimum elevation sine, complete
terminal coverage, node counts and proof ID. Tile reuse requires strict
half-space inclusion and a tile-up lower bound above the proved threshold.
No sampled horizon value decides visibility.

Preparation can consume only half the existing remaining terrain-node budget,
capped at 8,192 visits. Each attempt remains capped at 512 visits; all attempts
are exported, including unsuccessful ones. The original per-sample ceiling
remains 32,768 nodes. Only if preparation certifies every bearing bin across the footprint do
subsequent tiles use the bank and obstruction witnesses without further terrain
traversal. Strict half-space inclusion still decides each reuse; bins are
closed, but a tile on a shared seam may fail inclusion and stay UNKNOWN.
Unresolved elevations remain UNKNOWN. Incomplete banks retain the existing
bounded region-traversal fallback. Export all required/certified bin indices.
Probe existing clearance certificates before expensive witness searches.

The original 16,384 tile visits, 4,096 classification calls, depth 10,
16,384-node site cache, 128 sky-certificate cache and 4,096 adaptive-circle
proposal cache remain. These are work ceilings, not wall-clock guarantees.
All shared work and preparation policy are exported per disk partition.

## Stronger obstruction witnesses

The prior component-box cap check can lose correlation between east/north
components and horizontal normalization. It remains a sufficient shortcut.
When it fails, propose an angular sector from corner bearings and prove the
entire direction box lies inside its meridian half spaces. For that sector,
`B(a)=E*sin(a)+N*cos(a)`. On a sector shorter than 180°, positive endpoint
values imply a positive sinusoid with its minimum at an endpoint. Use outward
endpoint values to prove `A>0`, `B>0`, and `A²+B²>k²` for every bearing.

The existing adaptive circle must still lie wholly inside one valid source
pixel and the polar cap, and its elevation lower bound must exceed every tile
elevation. Circle geometry and the deciding angular sector are exported and
replayed. This adds no interpolated terrain or sampled obstruction rule.

## Verification and measured result

Focused checks first failed on the missing certificate module, then on a valid
small-circle/direction-box case rejected by the former bearing check. Both
pass after implementation. Cases include valid reuse, higher elevations,
outside bearings, zero work, missing terrain, and opposite-bearing rejection.
Existing precision, composite-clearance and analytic disk-area checks pass.

Artifact verification replays wedge proofs and their exact normal coefficients,
region reuse links, source-circle geometry and endpoint-sector tests. It
checks preparation work against all attempted proofs and the shared budget,
and confirms no later terrain visits under the certificates-only policy.
Legacy v1/v2 evidence remains replayable under its original policies.
An environment-level regression checks that the diagnostic proposal reaches
preparation; policy checks retain fallback for incomplete coverage and skip
preparation away from a proposed transition.

Final offline run: `data/local/lml/env-runs/20261021T025222Z-ea74fe84/`.
Same sample-a input, start 2026-11-23T21:00Z, one day at six-hour samples,
all nine cached assets reused, fourteen nonempty artifacts, no downloads.
Runtime **80.30 s**, peak memory **337.41 MiB**, versus PR #7's
**114.10 s / 365.02 MiB**. Runtime fell **29.62%** in these individual local
measurements; this is not a service latency guarantee or controlled benchmark.

| Sun sample | PR #7 fraction interval | This checkpoint |
| --- | --- | --- |
| Nov 23 21:00Z | [0, 0.060942] UNKNOWN | [0, 0.009998] UNKNOWN |
| Nov 24 03:00Z | [0.3379711169, 0.5969253413] PARTIAL | [0.3835105684, 0.4957632577] PARTIAL |
| Nov 24 09:00Z | [0, 1] UNKNOWN | [0, 0.779006] UNKNOWN |
| Nov 24 15:00Z | [0.769294, 1] UNKNOWN | [0.683966, 0.928369] PARTIAL |
| Nov 24 21:00Z | [1, 1] FULL | [1, 1] FULL |

Displayed endpoints are rounded outward. The fixed 03:00 width is exactly
0.11225268925279976 in the exported floating ceiling, **56.65% narrower** than
PR #7's 0.2589542243220017. Preparation uses 7,245 terrain-node visits versus
the former 32,768; all subsequent terrain clearance receipts reuse certificates.
It still reaches tile/classification caps and misses the 0.01 width target.

The 15:00 interval is slightly wider: 24.44 versus 23.07 percentage points.
Its lower endpoint worsens while its upper endpoint improves, and positive
proved visible/blocked areas now establish PARTIAL. Fixed work policies do
not guarantee nested intervals between numerical-method versions. The earliest
UNKNOWN Sun meets 1% width but has no whole-disk zero proof; its state is
therefore retained. The 09:00 Sun remains broad.

Final Sun states: 1 FULL / 2 PARTIAL / 2 UNKNOWN; 12 PARTIAL hours and
12 UNKNOWN hours. The terminal FULL sample adds zero hours. Sun all-duration
mean bounds are approximately [0.2668,0.5533], versus [0.2768,0.6645] before:
the upper mean improves while the lower mean is slightly worse. All Earth
states and endpoints match PR #7: 2 FULL / 3 UNKNOWN, 12 FULL hours and
12 UNKNOWN hours, with all-duration mean bounds approximately [0.9950,1].
Both bodies account for all 24 left-held hours.

Evidence contains **1,212 clearance proofs**, including **1,142 reuse links**,
**eight complete disk partitions** and **554 adaptive-circle receipts**.
All replay successfully, including source hashes, preparation counts,
coverage policies, fractions, duration totals and released locks. The plot
was inspected. Historical v2 and v1 transition evidence also replayed
successfully: 300 and 71 clearance proofs respectively, eight partitions each.
All four focused check scripts pass; source reviewed inline.

Intermediate runs `20261021T024549Z-fffb8dce` and
`20261021T024846Z-82758016` are marked superseded. The first exposed a missing
proposal-seed handoff; an environment-level regression now covers that path.
The second exposed precision loss from disabling traversal for partial banks;
complete coverage and transition-selection guards now preserve clear-sky work.
They are not final performance references.

Reproduce with the exact offline one-day command from
[LML-PRECISION-MILESTONE.md](LML-PRECISION-MILESTONE.md). Verify with:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_horizon_reuse.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_precision.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_composite_visibility.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261021T025222Z-ea74fe84
```

Generated evidence and assets remain ignored under `data/local`; source,
verification and checkpoint documentation are the only committed artifacts.

## Take stock

The 0.01 width target and L03 release readiness are still unfulfilled. The
full planner application has not been built. Bounds remain conditional on
solid raster pixels and reported geometric directions; physical terrain-height
error remains unbounded. Six-hour left-held durations do not certify events
between samples. UNKNOWN is preserved when a certificate or witness is absent.

**One next action:** reduce the remaining transition gap with bounded adaptive
bearing wedges and tighter source-pixel obstruction witnesses, measured on
this same fixed input with explicit work and runtime results. Review this
checkpoint before broadening scope or building planner interfaces.
