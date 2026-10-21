# Measured transition precision and work-reuse milestone

2026-10-20. Owner grants full authority until the next milestone. Execute
inline; no subagents, new terrain sources, dependencies, API/UI or training.

Goal: narrow the measured 2026-11-24T03:00:00Z sample-a Sun interval toward
the 0.01 target while reducing repeated terrain traversal, then verify one
representative transition run and stop. Publish actual bounds/runtime and
remaining limits; do not achieve precision by relaxing proof criteria.

Approaches considered: merely raising budgets leaves loose pixel geometry;
closed-form ray/square clipping adds substantial new geometry. Select reuse
of existing strict clearance certificates plus bounded subpixel geometry.
The constant-radius pixel-solid terrain model remains unchanged.

- [x] Add focused checks before implementation: reuse only inside a proved
  sky wedge and above its proved elevation threshold; mismatched directions
  must miss; subdivision of a constant-radius pixel preserves coverage.
- [x] Refine polar nodes inside a pixel with dyadic rectangles, at most eight
  additional subdivisions per axis (40/256 m). Derive heights from all source
  pixels intersected; never interpolate or alter the model. Keep the same
  node/cache caps. Export the leaf-span policy and retain legacy span=1 replay.
- [x] Cache successful region certificates, including their verified meridian
  wedge, minimum elevation sine, root coverage proof and proof ID. Reuse only
  after outward interval inclusion checks. Cap the cache; avoid chains of
  reused certificates and record each reuse link. Missing work remains UNKNOWN.
- [x] Generate bounded adaptive obstruction witnesses inside a source pixel
  when coarse inner circles cannot prove a tile. Floating-point geometry may
  propose a projected circle near a bearing, but interval rectangle/cap
  containment, forward-bearing coverage and elevation bounds must independently
  certify it. Export circle geometry, source pixel and deciding intervals.
- [x] Profile the single previously measured Sun sample using existing evidence.
  Tune work scheduling only when a measured bottleneck requires it; retain
  explicit caps, legacy compatibility and complete disk partitions. Record a
  new numerical-method version separately from the unchanged terrain model.
- [x] Update artifact verification for subpixel nodes, reuse links and adaptive
  witnesses. Check analytic/negative cases, replay old evidence and the new
  transition. Run one final offline one-day diagnostic at the fixed reference
  input; compare width and runtime against PR #6. Keep broad unknowns explicit.
- [x] Document actual results and limitations, review inline, commit/push and
  merge through a PR. Stop at this milestone for the owner's stocktake.
