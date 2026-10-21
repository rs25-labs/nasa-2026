# Bearing horizon certificate checkpoint

2026-10-20. Continue inline under the owner's standing execution/PR/merge
authorization. No subagents, new assets/dependencies, API/UI or training.

Goal: improve the same fixed Sun transition's 0.258954 fraction width and
114.10-second one-day runtime without increasing the existing work caps.

Design: prove fixed 1/8-degree meridian wedges clear above proposed elevation
thresholds, then reuse those complete-terrain certificates across disk tiles.
A sampled diagnostic may propose an initial threshold; only the existing
outward interval traversal can certify it. Allocate at most half the existing
per-sample terrain work, capped at 8,192 visits, to preparation. Each attempt
retains the 512-node limit. At most sixteen wedges and four attempts each;
reserve remaining work for the current fallback when preparation finds no
certificate for every bearing bin. Skip preparation away from the diagnostic
transition. Only a complete bank replaces further traversal with its
certificates and obstruction witnesses; unresolved tiles stay UNKNOWN. Missing coverage
remains unproved. Keep all attempts, threshold decisions, work counts and reuse links.

Alternatives: merely increasing budgets increases cost; an analytic exact
ray/pixel solver is a larger geometry change. Select bounded wedge preparation
using the proven traversal. Also remove dependency loss in circle bearing
coverage by independently proving a direction box lies inside a proposed
angular sector, then bounding its cap intersection at the sector endpoints.
The positive concave sinusoid has its minimum at an endpoint for width<180°.
No floating proposal decides a classification.

- [x] Add a focused analytic check first: valid wedge certificate reuses at a
  higher elevation, misses outside the wedge, zero preparation work is safe,
  missing terrain cannot produce a clear certificate, and cap-sector coverage
  rejects bearing boxes outside its witness. Observe the missing feature fail.
- [x] Add `bearing_horizon.py` for angular inclusion and bounded preparation;
  `CompositeClearance.prove_wedge` for complete terrain proof; prepare once in
  `integrate_disk`, pass the proposal seed from `environment.build_timeseries`,
  debit the existing node budget, publish v3 plus attempts.
- [x] Use certified endpoint-sector cap coverage for adaptive obstruction
  witnesses when direct component intervals are too loose. Replay each receipt.
- [x] Extend artifact replay to wedge proofs and node-work accounting while
  retaining v1/v2 replay. Run focused checks and the fixed single-sample profile.
- [x] Run one final offline one-day transition. Replay new and historical
  artifacts, inspect the plot, record precision/runtime/remaining uncertainty.
- [x] Review inline, push and merge verified source/docs through a PR, preserve
  unrelated files, then stop for the owner's stocktake.

Verification commands use existing `.venv`, `PYTHONPATH=apps/clps/api/src`,
`check_horizon_reuse.py`, existing precision/composite/disk checks, and
`verify_disk_area_artifacts.py RUN`. Reuse the exact offline transition
command recorded in LML-PRECISION-MILESTONE.md; no parameter search.
