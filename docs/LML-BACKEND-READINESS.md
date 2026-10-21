# Backend roadmap and planner app

The owner now directs app/UI work using the existing backend and retires the
1-point numerical target as a blocker. Stop precision research. This checklist
follows the remaining PRD scope; actual bounds and evidence remain intact.
Codex supplies source and
bounded handoffs; Pi runs it; the owner reviews results. No subagents.

## Current state

Terrain/kernel preparation, model-conditional visibility, finite-disk interval
integration, sampled durations and environment exports are implemented with
historical evidence. CSV/JSON result reuse passed Pi's four-check handoff and
is merged in [PR #10](https://github.com/rs25-labs/nasa-2026/pull/10).

The adaptive algorithm exists, but its measured fixed transition width is
0.017934151658148993 rather than <=0.01. Pi measured the v5 scheduling candidate:
identical bounds, target not met. That experiment is removed. Pi then measured
v6 disk-edge accounting: width 0.01388282226328252, narrower but still failing.
Pi measured v7 at width 0.010592929572963818: narrower but still failing, with
higher sample runtime. Three bounded candidates have now missed the target.
V8 narrowed the width to 0.010344217526156609 at 51.1845 seconds for the fixed
sample. The owner accepts this as sufficient to move on and retires that width
gate. This is not relabeled as a 0.01 benchmark pass. The current work is the
[planner app handoff](LML-PLANNER-PI-HANDOFF.md); functional/evidence checks remain
pending, rather than further numerical optimization.

## Remaining deliverables, in dependency order

| Milestone | Required backend behavior | Acceptance evidence |
| --- | --- | --- |
| Environment integrity | Unchanged proof rules, actual per-sample bounds, UNKNOWN states and published work limits; no fixed width gate | One completed app calculation and evidence replay, observed runtime/memory |
| Planning calculations | Distinct Earth-center visibility for communications; supplied darkness/Earth/simultaneous-window constraints; consistent metrics, up to three scenario comparisons and up to 31 daily-start candidates | A bounded real-data comparison/search with independent duration/constraint checks, explicit indeterminate outcomes and immutable result references |
| Planner service and first UI | Inputs, file-backed results, one background job, state/elapsed time, saved reopen and exports verified by Pi; cancel and visible submission errors have corrections pending | Focused fix handoff verifies the two remaining defects; initial real calculation, evidence replay and 0.43–0.44 s cache hits already passed |
| Training rules | Explicit units, mass costs, limits, equipment rules, load priority, events, seed behavior, UNKNOWN-environment handling and success/failure definitions | Owner reviews a versioned rule sheet before training implementation expands, as required by PRD section 6 |
| Training engine | Immutable planning link, coupled power/reserves/food/science/transmissions/exposure proxy, bounded events, deterministic stepping and resume/replay/export | Pi returns one reproducible run, a resource-shortfall failure and state/export checks; owner reviews the educational behavior |

Every row is needed for the full combined application. The first three provide
the planner backend; training rules/engine provide the mission-control backend.
The first planner interface is now being built alongside its service, as the
owner requests. Browser persistence, accessibility and deployment still require their
later application milestones and are not claimed by this backend checkpoint.

Keep storage file-based. A job/service boundary does not imply a database,
distributed queue, cloud deployment or accounts. Start with one bounded local
worker using the existing writer discipline; decide service dependencies only
when implementing that milestone. Do not equate Earth-disk FULL/PARTIAL with
Earth-center communication visibility or infer continuous event times from
six-hour samples.

SPHEREx remains separate. The owner's current direction is to start the Lunar
planner app now; this does not claim either product's full release is complete.
