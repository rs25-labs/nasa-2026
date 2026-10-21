# Adaptive bearing refinement plan

2026-10-20. Owner requests finishing adaptive refinement before database work.
Standing authority covers bounded execution, PR and merge. Work inline without
subagents. No new data/dependencies, database, API/UI, training or SPHEREx.

Goal: implement demand-driven refinement of the unresolved disk bearings,
measure against PR #8's fixed Sun width 0.11225268925279976 and 80.30-second
one-day run, and publish actual precision and cost. The 0.01 target remains an
acceptance measurement, never a reason to weaken proof criteria.

Design: retain the existing complete coarse bank as a safe starting point.
For unknown disk tiles inside a complete bank, refine a dyadic bearing enclosure
only if its minimum elevation is above a certified obstruction floor. Query the
complete terrain at that minimum, record the parent certificate, tile enclosure,
attempt and work, and reuse successful certificates. Limit refinement to 128
attempts, 512 terrain nodes each, using only the existing remaining shared
32,768-node budget. Begin at disk depth four; angular grid at most 1/128 degree.
Missing parents, missing witnesses, failed proofs and exhausted work remain
UNKNOWN. Incomplete coarse banks keep the existing bounded fallback.

Improve source-pixel circle proposals by considering the bearing's intersections
with inset pixel edges as well as the center projection. Float elevation ranks
at most two edge candidates for interval certification. Preserve the former center
proposal if it is stronger. All accepted circles must independently prove
source-pixel/cap containment, bearing coverage and an elevation lower bound.
A lower-only probe may select work but cannot itself classify an actual tile.

Alternatives: uniform smaller bins repeat work across already resolved sky;
raising global limits increases cost. Choose unresolved-tile refinement and
stronger within-pixel witnesses without changing the terrain model.

- [x] Focused failing checks: a within-pixel edge proposal improves a known
  analytic obstruction floor; opposite bearings still reject; adaptive refinement
  debits shared work, records a parent and reuses a complete proof; zero work
  and known mixed tiles cause no new proof.
- [x] Implement improved proposals in `adaptive_witness.py` and refinement in
  `bearing_refinement.py`; connect `TerrainTileProver` in `disk_area.py` and
  export integrator v4 with per-sample adaptive attempt/work records.
- [x] Extend `verify_disk_area_artifacts.py` to replay adaptive threshold and
  bearing inclusion, parent links, and preparation plus adaptive shared work.
  Retain historical v1-v3 evidence replay.
- [x] Run focused existing checks and the same single-sample profile. Make
  bounded adjustments only for measured failures; no parameter search.
- [x] Run final offline one-day reference, verify evidence and inspect plot.
  Compare every row, record actual target width, runtime and remaining limits.
- [x] Review inline, commit, push and merge through a PR; preserve unrelated
  files and ignored generated assets. Stop at the measured milestone.

Checks use existing `.venv`, `PYTHONPATH=apps/clps/api/src`, the new
`check_adaptive_bearing.py` and existing four focused checks. Use the exact
one-day offline command in LML-HORIZON-REUSE-MILESTONE.md and replay its
completed artifacts with `verify_disk_area_artifacts.py RUN`.

Measured adjustments: the first profile was stopped after repeated uncached
sector trigonometry dominated cost. Memoize direction-bearing enclosures and
wedge normals at 4,096 entries each; reuse the existing 8,192-entry trig cache.
A bounded profile reached width 0.0280, then joining adjacent certified dyadic
intervals removed artificial seam gaps and reached 0.0181. Its 64 adaptive
attempt ceiling left about 6,000 existing terrain visits unused. Permit up to
128 attempts while retaining the 32,768 shared-node ceiling; this reallocates
remaining work, without increasing existing global limits. Final-run results
must decide whether 0.01 acceptance is reached. No parameter search.

The first full adaptive run verified width 0.017934 but took 196.57 seconds.
Before publication, a focused saturation test reproduced that the existing
4,096-entry witness cache froze after reaching capacity. Keep the same cap,
refresh hits, and evict the least-recently-used entry for each new proposal.
Repeat the identical final diagnostic to measure that concrete correction.
