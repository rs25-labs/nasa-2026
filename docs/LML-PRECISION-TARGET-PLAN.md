# Adaptive precision target — bounded follow-up

Owner authorizes storage merge and remaining backend work before UI. Storage
is merged in PR #10. Codex prepares source; Pi runs application checks. No
subagents, downloads, database or new dependency.

## Failed v5 experiment

The fixed Sun transition remains at width 0.017934151658148993, above 0.01.
Its saved partition reaches tile, classification, depth and terrain limits.
The saved clearance inventory includes repeated unsuccessful attempts over
identical bearing wedges. Raising the attempt limit alone cannot fix this.

Pi ran commit `47a1822`. The fixed profile exited 2: exactly the same v4 bounds,
87 attempts, nine skips, all 32,768 terrain visits, 16,384 tiles and 4,096
classifications. Inner time was 27.8975 s; wall time 28.51 s. No full pipeline
run or replay followed. Evidence: `data/local/lml/precision-target-profile.json`.
The scheduling hypothesis failed its acceptance test and is removed from the
next candidate. Legacy v5 evidence remains readable by the verifier.

## Root cause and v6 design

The failed partition contains 1,603 circle-edge leaves with existing visibility
proofs but zero credited area. Another 4,925 queued leaves inherit such proofs;
their wholly interior squares alone cover 0.004764556884765625 image units.
Discarding these proved regions at the disk edge/work cutoff contributes
uncertainty independently of terrain traversal. Source inspection confirms
that only wholly interior processed squares currently contribute area.

For an already classified rectangle, count a lower bound on its intersection
with the unit disk directly. Over each of 256 vertical dyadic strips, let
r(x)=sqrt(1-x*x) and h(x)=min(y1,r(x))-max(y0,-r(x)). The function h is concave.
If both endpoint lower bounds are nonnegative, the trapezoid between them lies
below h across the whole strip. Otherwise count zero. Outward interval square
roots and sums produce a lower area; integration residual stays uncertain.
No interior sampling assumption, approximate trigonometric primitive or new
terrain detail is introduced.

Terminate those proved circle-edge rectangles instead of repeatedly dividing
them on the global queue. Credit already proved queued interior/edge regions
during the existing final partition walk; perform no new classifications or
terrain traversal there. The additional area work is explicitly capped at
65,536 strips per sample. If exhausted, use the previous subdivision/unknown
fallback. Terrain, tile, classification, depth and adaptive-attempt limits stay
unchanged. Report clipped lower area and strip work for each affected tile.

This is method v6, with the same physical terrain model. It may release tile
work and account for previously discarded area, but reaching 0.01 still needs
measurement. Increasing terrain limits and changing witness scheduling remain
out of this correction.

## Implementation and acceptance

- [x] Supply focused quarter-disk, outside/interior rectangle, reflection,
  refinement and limited-work accounting checks before implementation.
- [x] Add bounded `circle_area.py`, clip only independently classified regions,
  and credit already proved queued regions. Bump method to v6 and remove failed
  v5 scheduling suppression.
- [x] Extend artifact replay for lower clipped areas, partition totals, proof
  links and strip-budget accounting. Preserve historical replay.
- [ ] Pi runs the focused checks and one fixed transition profile. Proceed to
  the full one-day evidence run only if width <=0.01. Otherwise return that
  measured failure; do not search parameters or silently raise budgets.
- [ ] Owner reviews actual bounds, proof replay and runtime before this change
  is integrated. Backend readiness remains tracked separately.

No target achievement is claimed from source inspection. The current source
and focused checks have not been executed by Codex under the working agreement.
