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

## Pi v6 result and v7 correction

Pi measured v6 at [0.40906439489187646, 0.42294721752470166], width
0.01388282226328252: narrower, but still failing the 0.01 gate. Inner time was
27.8807 s; wall time 28.41 s. Only 12,333 of 16,384 tiles were visited, with
4,096/4,096 classifications and 32,768/32,768 terrain visits. Twenty-four
clipped tiles used 6,144 of 65,536 strips. No full run/replay was reached.
Evidence: `data/local/lml/precision-target-v6-profile.json`, retained unchanged.

All 8,233 remaining UNKNOWN leaves have criterion
`region-classification-budget`, totaling 0.0435943603515625 square image units.
The classification guard discards them before looking up any existing evidence.
The area accounting change did release tile work; a remaining budget guard now
prevents using that work even for zero-traversal evidence checks.

V7 retains the v6 area correction and adds up to 4,096 separately counted
reuse-only checks after full classifications are exhausted. They recheck
published sky certificates, original polar-circle witnesses, or geometry
already in the bounded adaptive-circle cache. Candidate ranking is heuristic;
outward certification still decides every accepted result. A frozen per-sample
circle snapshot is ranked with bounded NumPy arrays, checking at most 16
candidate circles per tile. No new circle is constructed, no terrain is
traversed and no adaptive-bearing attempt is made in this mode. A changed
terrain-work debit is an error.

The previous limits remain 4,096 full classifications, 32,768 terrain visits,
16,384 visited tiles, depth 10 and 65,536 area strips. The additional 4,096
reuse-only checks are explicit extra proof-checking work, not free or disguised
full classifications. All checks also consume the existing tile budget.
Receipts identify reused regions and their tile IDs. Artifact replay rechecks
their proofs/circles and verifies separate count limits and zero-node clearance.

Focused checks cover reuse at zero full-classification budget, zero/one reuse
limits, analytic half-disk bounds, cached-circle bearing/elevation rejection
and prohibition of traversal. Pi must measure v7 using the same fixed gate.
If this third bounded candidate also misses, stop for a work-policy/precision
design review rather than adding another automatic cap increase. No target
achievement or runtime improvement is claimed for v7.

## V7 result — stop incremental corrections

Pi measured width 0.010592929572963818, interval
[0.409994194837805, 0.42058712441076884], exit 2. Inner time was 37.2578 s;
wall time 37.84 s. Full classifications, terrain visits and reuse-only checks
all reached their limits; 15,173/16,384 tiles were visited. No full run or
artifact replay followed. Source remains at `b1f89f4` pending review.

The agreed third-candidate stop has been reached. See the
[design review](LML-PRECISION-DESIGN-REVIEW.md) for measured tradeoffs and the
proposed next direction. No further algorithm or budget change is part of this
stocktake.
