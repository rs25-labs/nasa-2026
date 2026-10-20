# Bounded projected disk-area foundation milestone

2026-10-20. Owner authorizes continuing all necessary steps without approval
pauses, stopping at a meaningful milestone. Execute inline, no subagents.

Milestone: real-data finite-disk fraction bounds, including supported PARTIAL
states, time intervals and duration-weighted summaries with complete evidence.
Stop before API/UI, training or SPHEREx work. Do not call uncertainty-free or
continuous visibility a prerequisite for this explicitly conditional model.

The existing horizon/disk design supplies the projected-disk geometry. Use
`d=c*sqrt(1-sin(rho)^2*(x²+y²))+sin(rho)*(x*u+y*v)` over the unit image disk.
Dyadic square subdivision provides exact square areas; accept area only for
squares wholly inside the disk, leaving circle-edge area uncertain. Outside
squares may be excluded only by an interval proof. Outward interval vector
boxes enclose all directions of a square, including tangent/polar geometry.

- [x] Write focused analytic checks first: a half-visible disk must enclose
  0.5 and prove PARTIAL; all-unknown geometry remains [0,1]; work limits and
  missing data cannot create visibility; increasing the work budget nests
  bounds. Verify real proof links and weighted durations later.
- [x] Refine the composite exterior envelope using validated one-degree
  latitude bands of the same global raster. Include the shared cap boundary.
  For each band derive a proved elevation upper bound using its maximum
  radius, minimum separation, endpoints and stationary points. Float math may
  propose a bound; only strict outward interval comparisons accept it. A
  failed/invalid band leaves the envelope unavailable. Record every band's
  source rows, maximum, bound and comparison margin.
- [x] Extend composite clearance to direction boxes. A lower direction-up
  bound gives a lower elevation sine without inverse trig; construct the
  corresponding cosine enclosure. Reuse the verified polar hierarchy and
  only use a wedge when interval dot products contain the entire box. Keep
  per-region and per-sample terrain-work budgets explicit.
- [x] Add bounded disk subdivision. A whole-disk classification remains a
  shortcut. For tiles, require a direct inner-cap witness over every possible
  bearing to prove blocked, or composite direction-box clearance to prove
  visible. Heuristics may propose witness candidates but never certify a
  decision. Use at most 16 proposed witnesses per tile, a fixed tile/depth
  cap and a shared terrain-node budget. Unknown and budget-limited tiles
  remain uncertain; no relaxed proof threshold.
- [x] Export terminal tile coordinates/areas, direction enclosures, witness
  or clearance proof IDs, counts, termination and fraction widths. Compute
  lower=visible square area/pi and upper=1-blocked square area/pi outward.
  PARTIAL requires positive proved area of both types. Do not assign a scalar
  fraction to a non-collapsed bound. Record an integrator version separately
  from the unchanged composite terrain model ID.
- [x] Integrate into the offline pipeline, plots, intervals and summaries.
  Distinguish known-state hours from exact-fraction hours when PARTIAL has
  a fraction interval. Preserve all-time fraction bounds and unknown time.
- [x] Run focused checks, replay one existing real-data series while
  developing, then run one representative offline diagnostic on final source.
  Check proof coverage, hashes, source/model identity, state/fraction and
  duration accounting, budgets and lock release. Document actual milestones
  and limits, review inline, push and merge verified work through a PR.

Acceptance is evidence-based, not an expected classification count. If the
real series lacks a terrain transition, use one bounded, documented follow-up
at an identified boundary rather than a parameter search. Report actual
fraction widths and termination even when the 0.01 target is not reached.
