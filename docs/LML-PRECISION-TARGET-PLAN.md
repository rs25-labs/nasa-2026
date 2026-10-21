# Adaptive precision target — bounded follow-up

Owner authorizes storage merge and remaining backend work before UI. Storage
is merged in PR #10. Codex prepares source; Pi runs application checks. No
subagents, downloads, database or new dependency.

## Design

The fixed Sun transition remains at width 0.017934151658148993, above 0.01.
Its saved partition reaches tile, classification, depth and terrain limits.
The saved clearance inventory includes repeated unsuccessful attempts over
identical bearing wedges. Raising the attempt limit alone cannot fix this.

Choose bounded suppression of repeated unsuccessful work. Within one sample,
if the exact same angular wedge previously failed at an equal or higher up
threshold, skip the new attempt and leave its classification UNKNOWN. This
is a scheduling heuristic, not an obstruction proof: an earlier failure may
mean incomplete traversal. Successful clearance and obstruction still require
all original outward comparisons. A higher threshold, narrower wedge or new
sample remains eligible. Record skips with links to earlier failed attempts
and exact tile directions. Keep all global caps and terrain geometry unchanged.

Alternatives deferred: increasing all budgets adds latency without addressing
duplicate work; analytic circle clipping adds a separate area-proof method.
Neither is needed to evaluate this bounded improvement.

## Implementation and acceptance

- [x] Add a focused synthetic check for repeated lower-threshold suppression,
  higher-threshold eligibility, sample isolation and unchanged work debits.
- [x] Add per-sample failed-attempt scheduling memory and skip receipts in
  `bearing_refinement.py` / `disk_area.py`; bump the integrator method to v5.
- [x] Extend artifact replay to validate skip references, exact directions and
  thresholds without treating them as classification evidence. Preserve v4
  replay and all existing ceilings.
- [ ] Pi runs the focused checks and one fixed transition profile. Proceed to
  the full one-day evidence run only if width <=0.01. Otherwise return that
  measured failure; do not search parameters or silently raise budgets.
- [ ] Owner reviews actual bounds, proof replay and runtime before this change
  is integrated. Backend readiness remains tracked separately.

No target achievement is claimed from source inspection. Skipping work can
change scheduling and can widen a result; measurement must establish its value.
