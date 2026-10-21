# Finite-disk visibility engine milestone

Historical PR #6 reference. The follow-on measured precision checkpoint is
[LML-PRECISION-MILESTONE.md](LML-PRECISION-MILESTONE.md).

2026-10-20. Owner authorized continuing without approval pauses and stopping
at a real milestone. This checkpoint delivers model-conditional BLOCKED,
FULL, PARTIAL and UNKNOWN with bounded projected disk fractions, evidence
exports, intervals and duration-weighted summaries. Stop here to review
precision and cost before expanding the application.

This is an implemented numerical-engine milestone, **not completion of
L03 release acceptance** or the complete web application. Real transition
bounds remain wide. These measurements cover calculations with cached assets;
result-cache retrieval/API latency and its two-second target remain unverified.

## Contracts retained

Terrain model: `lml-composite-cell-solid-v1`, as defined in
[Composite Model](LML-COMPOSITE-MODEL.md). The existing polar solids remain
unchanged; global LDEM_16 solids fill the exterior, with the shared cap edge
assigned to the union. All nine allowlisted assets and the DE421 kernel/frame
convention are unchanged. No downloads or new dependencies in this checkpoint.

Integrator: `lml-projected-disk-bounds-v1`. Fractions use uniform projected
disk area. They are not brightness-weighted flux, ground-station availability
or link-budget predictions. Physical height error remains unbounded. Six-hour
left-held intervals are sampled estimates, not between-sample certificates.

The scalar fraction is present only for a whole-disk proof of zero or one.
PARTIAL requires positive area proved visible and positive area proved blocked.
UNKNOWN may still have useful bounds such as [0.9900,1]; a narrow interval does
not justify silently changing its state to FULL or PARTIAL.

## Exterior envelope refinement

The former single global maximum is retained as a sufficient shortcut. When
it cannot prove clearance, use maxima from closed one-degree global latitude
bands, clipped to the polar exterior. Include the row touching the cap seam;
ignore no exterior cell. All global samples must still be valid before this
refinement is available. For sample-a this yields 176 band records.

For each band's maximum radius and a lower central separation, propose an
elevation ceiling from endpoint/stationary extrema. Accept it only if the
existing outward trigonometric comparison strictly proves the entire radial
region below that ceiling. Failed proposals leave the envelope unavailable;
ordinary floating-point math never decides a clearance result. Record source
row ranges, radius maxima, separation bounds, ceilings and margins in the
environment report. Every band must pass before its maximum elevation sine
can bound the whole exterior.

## Projected disk area

Use orthonormal local center/tangent vectors `c,u,v` and normalized image
coordinates `x,y` within the unit disk:

`d = c*sqrt(1-sin(rho)^2*(x*x+y*y)) + sin(rho)*(x*u+y*v)`.

Dyadic squares partition `[-1,1]²`. Interval vector boxes enclose the square's
intersection with the image disk. A square is outside only when its minimum
enclosed squared radius exceeds one. Credit its exact square area only when
it is wholly inside the disk and its entire direction box has a supported
classification. Circle-edge squares remain uncertain until subdivided; there
is no unverified circle clipping or sampled-pixel area estimate.

- **Blocked tile:** an existing valid polar inner cap must meet every possible
  forward bearing, and its established lower elevation must exceed every tile
  elevation. With `A=v·up` and
  `B=(v·east*d_east+v·north*d_north)/sqrt(d_east²+d_north²)`, prove
  `A>0`, `B>0`, and `A²+B²>k²` outward. The cap's elevation lower bound
  must have sine strictly above the direction-up upper bound. Float heuristics
  may propose up to 16 candidates; missed candidates lose opportunities,
  never produce a blocked result.
- **Visible tile:** the direction-up lower bound supplies a minimum elevation
  sine. Its corresponding cosine is enclosed by `sqrt(1-sine²)`. Prove all
  exterior bands below it, then use the existing complete polar hierarchy.
  A meridian wedge may exclude terrain only if interval dot products prove
  it contains the entire tile box. Unresolved terrain and exhausted work
  budgets prevent clearance.

For exact sums of proved square areas `V` and `B`, return outward bounds
`V/pi <= fraction <= 1-B/pi`. Unclassified, boundary and unprocessed area
remain uncertain. A proof of the root's complete direction box can classify
the entire disk directly. Increasing a work cap preserves already credited
area; no midpoint fraction is fabricated.

Limits per subdivided sample: 16,384 tile visits, 4,096 region classifications,
depth 10, 32,768 terrain-node visits shared across its region tests, and at
most 512 terrain nodes per region test. The existing site cache is capped at
16,384 nodes. The separate whole-disk attempt retains its 4,096-node cap.
The fraction-width target is 0.01; actual widths and termination are exported.
Outward conversion can put a width ceiling one floating-point step above one
for a completely unresolved [0,1] interval; the fraction endpoints stay valid.

## Evidence and summaries

`projected-disk-area-proofs.json` records terminal tile IDs, coordinates,
exact square areas, coverage criteria and shared region receipts. Visible
regions link to `composite-clearance-proofs.json`; blocked regions name a
source cell in `terrain-cell-enclosures.csv`. Inherited evidence applies only
to descendant tiles. Terminal tiles partition the root, including all outside
and unresolved pieces. Proof JSON is streamed to an atomic replacement file
to keep serialization memory bounded.

State-known hours now include PARTIAL. `exact_fraction_hours` separately
counts hours with scalar zero/one fractions. Scalar means use only those exact
hours; full-duration mean bounds integrate every row's fraction bounds,
including useful bounds on UNKNOWN rows. Terminal samples still carry zero
elapsed time. Plots show the fraction band instead of hiding uncertain rows.

The focused checks use an analytic half-visible disk, not another sampled
terrain grid. At default budgets they enclose 0.5 in
[0.49496954,0.50496854] with width below 0.01. Checks also cover nesting with
larger work budgets, missing data, zero budget, exact root area, circle
containment, evidence inheritance and the prior composite regressions.

The artifact verifier replays all whole-disk and successful region-clearance
proofs, checks every terminal disk partition, re-evaluates blocked-region
inequalities, resolves proof/source references and checks fraction bounds,
hashes, duration accounting and lock release. This is verification within the
declared model; it does not validate physical terrain accuracy.

## Actual final-source runs

| Run | Samples and result | Cost |
| --- | --- | --- |
| `20261020T195253Z-ac8ce2b8` | Original seven days: Sun 29 BLOCKED; Earth 9 FULL / 20 UNKNOWN | 71.02 s; 396.63 MiB peak |
| `20261020T195032Z-7764e707` | One-day transition: Sun 1 PARTIAL / 4 UNKNOWN; Earth 2 FULL / 3 UNKNOWN | 60.88 s; 334.20 MiB peak |

Both exited zero, reused all nine cached assets offline and produced fourteen
nonempty artifacts. Seven-day verifier: 139 clearance replays and 20 complete
disk partitions. Transition verifier: 71 clearance replays and eight complete
disk partitions. Both account for all left-held hours per body (168 or 24),
resolve their evidence and leave both locks released. The transition plot was
inspected.

At **2026-11-24T03:00:00Z**, sample-a Sun is PARTIAL with visible fraction
**[0.1507037223,0.5962696432]**, conservatively rounded here for display.
This proves some visible and some blocked area; it does not achieve 1% width.
The sample uses the full terrain-node budget and the tile budget.

In the seven-day run Earth has 48 known FULL hours and 120 UNKNOWN hours.
Its all-duration mean fraction lies within approximately [0.3861,0.9599],
despite its exact-hours-only scalar mean of 1. One UNKNOWN Earth sample
achieves the requested 1% fraction width; nineteen other subdivided samples
hit the tile budget with wider bounds. Many remain [0,1].

The transition was selected from one bounded ephemeris interval crossing the
existing diagnostic horizon, not a parameter search or an asserted event-time
certificate. Intermediate runs `20261020T194530Z-b8a561d5` and
`20261020T194902Z-d97095ba` used earlier budgets/diagnostic labels and are not
the current reference. The new final runs supersede them, while older PR #5
obstruction/clearance evidence remains valid under its narrower algorithm.

## Reproduce and take stock

Use the exact composite command in [Handoff 02](LML-PI-HANDOFF-02.md). For the
transition, change only `--start 2026-11-23T21:00:00Z --days 1`; retain the
six-hour cadence and all terrain settings. Verify a completed run with:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_disk_area.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_composite_visibility.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/20261020T195032Z-7764e707
```

The application now has a real offline environment engine with all four states,
fraction intervals and auditable model evidence for new inputs. It still lacks
planner API/jobs, web UI, persistence and the outpost simulation. Per-azimuth
complete horizons, precise event times, a physical terrain-error policy and
uniformly useful fraction precision are not delivered by this milestone.

**Recommended next bounded action:** tighten near-field/polar enclosures and
reuse clearance work until this measured real transition reaches the 0.01
fraction-width target within a published runtime budget. Do that before planner
UI expansion. This recommendation needs no new terrain source or broad
research. Stop now for the owner's milestone review, as requested.
