# Backend milestones before interface implementation

The owner requests finishing required backend milestones before building UI.
This checklist follows the Lunar Mission Lab PRD; it does not change scientific
acceptance or silently remove required behavior. Codex supplies source and
bounded handoffs; Pi runs it; the owner reviews results. No subagents.

## Current state

Terrain/kernel preparation, model-conditional visibility, finite-disk interval
integration, sampled durations and environment exports are implemented with
historical evidence. CSV/JSON result reuse passed Pi's four-check handoff and
is merged in [PR #10](https://github.com/rs25-labs/nasa-2026/pull/10).

The adaptive algorithm exists, but its measured fixed transition width is
0.017934151658148993 rather than <=0.01. The current v5 scheduling candidate
awaits the [precision handoff](LML-PRECISION-TARGET-PI-HANDOFF.md). This is the
immediate next execution batch. No v5 acceptance or runtime improvement is
claimed yet.

## Remaining deliverables, in dependency order

| Milestone | Required backend behavior | Acceptance evidence |
| --- | --- | --- |
| Environment precision and workload | Fixed transition <=0.01, unchanged outward proof rules, explicit per-sample unresolved bounds and published work limits | Pi fixed profile, full one-day run and new/legacy artifact replay; measured runtime/memory |
| Planning calculations | Distinct Earth-center visibility for communications; supplied darkness/Earth/simultaneous-window constraints; consistent metrics, up to three scenario comparisons and up to 31 daily-start candidates | A bounded real-data comparison/search with independent duration/constraint checks, explicit indeterminate outcomes and immutable result references |
| Planner service | Validated supported inputs, file-backed results, uncached job submission/status/progress/cancel/retry, useful unsupported/missing-data errors and safe result/export retrieval | Pi service handoff demonstrates a new site/date, cached reuse, interrupted/failed job recovery and cancellation; documented request/response contract |
| Training rules | Explicit units, mass costs, limits, equipment rules, load priority, events, seed behavior, UNKNOWN-environment handling and success/failure definitions | Owner reviews a versioned rule sheet before training implementation expands, as required by PRD section 6 |
| Training engine | Immutable planning link, coupled power/reserves/food/science/transmissions/exposure proxy, bounded events, deterministic stepping and resume/replay/export | Pi returns one reproducible run, a resource-shortfall failure and state/export checks; owner reviews the educational behavior |

Every row is needed for the full combined application. The first three provide
the planner backend; training rules/engine provide the mission-control backend.
Interface work can then consume those contracts without inventing backend
behavior. Browser persistence, accessibility and deployment still require their
later application milestones and are not claimed by this backend checkpoint.

Keep storage file-based. A job/service boundary does not imply a database,
distributed queue, cloud deployment or accounts. Start with one bounded local
worker using the existing writer discipline; decide service dependencies only
when implementing that milestone. Do not equate Earth-disk FULL/PARTIAL with
Earth-center communication visibility or infer continuous event times from
six-hour samples.

The PRD also requires both products' data foundations before either interface
is completed. SPHEREx status is a separate coordination dependency, not evidence
that Lunar backend work is finished. Check it before declaring UI release readiness.
