# Precision stocktake after three bounded candidates

Pi's isolated fixed Sun sample still fails the <=0.01 fraction-width gate.
The current branch is not ready to merge. No full one-day candidate run or
artifact replay has been reached. This review records evidence and a proposed
direction; it does not change the target or authorize a passing label.

## Measurements supplied by Pi

Same sample-a Sun at 2026-11-24T03:00:00Z, existing cached terrain:

| Candidate | Fraction width | Percentage points | Sample calculation time | Gate |
| --- | --- | --- | --- | --- |
| v5: suppress repeated failed attempts | 0.017934151658148993 | 1.7934 | 27.8975 s | Fail |
| v6: account for clipped proven area | 0.01388282226328252 | 1.3883 | 27.8807 s | Fail |
| v7: additional reuse-only checks | 0.010592929572963818 | 1.0593 | 37.2578 s | Fail |

These are individual local profile runs, not a service benchmark. V7's interval
is [0.409994194837805, 0.42058712441076884]. It misses by 0.0593 percentage
points and takes about 34% longer than v6. Narrower bounds alone do not establish
acceptance or full-pipeline evidence validity.

V7 spends all 32,768 terrain visits, 4,096 full classifications and 4,096
reuse-only checks. It visits 15,173/16,384 tiles. Circle-area work uses only
7,168/65,536 strips across 28 clipped tiles; increasing that cap is not indicated.

The remaining partition contains:

- 6,971 classification-budget leaves, square area 0.026592254638671875.
- 1,736 depth-limit leaves, square area 0.006622314453125.

Those square areas are scheduling diagnostics, not visible-fraction estimates.
All unproved area remains uncertain. The evidence files remain ignored under
`data/local/lml/precision-target*-profile.json`.

## What the experiments establish

V5 did not improve bounds and was removed. V6 recovered proved area that the
former square-only accounting discarded. V7 showed that more existing-evidence
checks can recover additional area, with a measurable time cost. The remaining
problem spans classification, reuse and depth limits. It is not a single
forgotten counter or evidence of inaccurate NASA inputs.

The present algorithm mixes initial exploration, proof construction, proof
reuse and final area accounting in one bounded pass. Each local improvement
exposes a different exhausted limit. A fixed combination of limits cannot
promise 1% precision across all supported inputs. UNKNOWN must remain a valid
outcome, even after this particular acceptance sample passes.

## Recommended direction for discussion

Use an explicit second refinement stage over the remaining unresolved region,
preserving the first stage's certified area and proof references. Allocate its
work according to unresolved area and available proof opportunities, instead
of replaying the whole calculation or adding another ad hoc fallback. Publish
combined work, attained precision and stop reason. This would also provide a
clear backend boundary for progress/cancellation and later UI updates.

That is a design change, not implemented here. Before implementing, define
the resumable partition/proof invariants, explicit total work limits, and a
measured latency allowance. Compare it first on this fixed sample, then perform
the required full run and historical/new evidence replay. Keep the 0.01 gate.

A simpler alternative is a separately named higher-work calculation policy,
with all increased limits and latency published and included in result identity.
It may be appropriate if longer uncached jobs are acceptable, but it must be
an explicit product/work-policy choice and still needs measurement; another
unreviewed cap increase is not the next step.

Do not merge v7, lower the acceptance standard, or claim backend/UI readiness.
One next action: review the proposed two-stage refinement design and latency
tradeoff with the owner before producing another algorithm candidate.

## Owner continuation

The owner approved proceeding. The [two-stage implementation plan](LML-TWO-STAGE-REFINEMENT-PLAN.md)
now defines explicit extra work and experimental latency allowances. Source v8
is prepared for the [new Pi handoff](LML-TWO-STAGE-PI-HANDOFF.md), not yet runtime
verified. Historical failures above remain unchanged; acceptance is still open.
