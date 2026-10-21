# Lunar Mission Lab — Active Implementation Plan

PRD: [Lunar Mission Lab](PRD-LUNAR-MISSION-LAB.md).
The owner authorized starting Lunar Mission Lab. This replaces the earlier CLPS-only batch sequence for active work.

Execution: Codex generates code; Pi runs it; owner reviews/handles testing. No Codex application execution, subagents, or extensive generated test suite.

## Current owner decision — build the app

The owner retires the 1-point precision target as an app/release blocker and
directs work toward the usable application. No more numerical refinement.
V8's measured width is 1.0344 percentage points; display its real bounds and
UNKNOWN states. Earlier precision gates below are historical, not current work.

The [first planner app slice](LML-PLANNER-APP-PLAN.md) now has source for a local
background-job API and browser UI: site/date input, calculations, saved results,
intervals, sample bounds and exports. Pi launches and verifies it using the
[app handoff](LML-PLANNER-PI-HANDOFF.md). No database or new runtime dependency.
Pi has now verified the main app flow, evidence replay, exports and cache reuse;
the app was left running. Pi also verified both corrections (cancel and invisible
submission errors) on `28387ec`. The [first planner milestone](LML-PLANNER-MILESTONE.md)
is verified. Stop here for the owner's app stocktake; the next
recommended slice is terrain map and synchronized sky/timeline interaction.

The owner approved that next slice. [Map/sky source](LML-MAP-SKY-PLAN.md) now adds
an offline LOLA terrain viewport and discrete sample controls linking the saved
sky, interval cursors and sample table. The [map/sky Pi handoff](LML-MAP-SKY-PI-HANDOFF.md)
is pending; no runtime/visual verification is claimed yet. Solver logic and
the retired numerical acceptance gate are unchanged.

## Batch 01 — Data foundation (current handoff)

- [x] Define explicit terrain/frame conventions and seven bounded asset sources.
- [x] Generate download/provenance, PDS terrain reader, topocentric geometry, and report code.
- [x] Supply a Python package and one preparation command.
- [x] Document limitations and exact Pi output checklist.
- [ ] Pi installs and executes [Handoff 01](LML-PI-HANDOFF-01.md).
- [ ] Owner reviews actual manifest, terrain/elevation samples, and geometry artifacts.

Generated code has not been executed by Codex. Source review is not runtime verification. Stop after Pi returns this batch.

## Batch 02 — Horizon and operating environment

Generate wider-terrain acquisition, curvature-aware horizon computation, finite-disk visibility, intervals, and mission metrics. Pi returns one site's horizon/environment and a bounded refinement comparison. Owner reviews before API/interface work. Missing coverage remains explicit.

Current owner-authorized execution checkpoint (2026-10-20): optional
[composite raster clearance](LML-COMPOSITE-MODEL.md) and prior polar
obstruction proofs now produce model-conditional FULL/BLOCKED results.
Follow-on [finite-disk milestone](LML-VISIBILITY-MILESTONE.md) adds bounded
area integration and a real PARTIAL result. Original sample-a now has Sun
29 BLOCKED; Earth 9 FULL / 20 UNKNOWN. The follow-on
[precision checkpoint](LML-PRECISION-MILESTONE.md) narrows the fixed Sun
transition without changing the terrain model or work limits. The next
[bearing-certificate milestone](LML-HORIZON-REUSE-MILESTONE.md) reduces the
fixed transition width and one-day runtime, with remaining tradeoffs recorded.
[Adaptive bearing refinement](LML-ADAPTIVE-BEARING-MILESTONE.md) is now
implemented and verified; it further narrows the fixed transition to 1.79
percentage points at a higher runtime. The 1% acceptance target remains open.
The next [CSV/JSON result reuse checkpoint](LML-FILE-RESULTS.md) now has
implementation completed: intact matching calculations can reuse saved folders,
with explicit refresh and index rebuild. Pi reports all four bounded handoff
checks passed; the owner supplied that report and authorized committing this
milestone. The current working agreement assigns execution to Pi;
the historical execution authorization below describes prior checkpoints.
Precision and performance acceptance remain pending; Batch 02/L03 readiness is
incomplete. The owner now authorizes the remaining Lunar backend milestones
before UI work; see [backend readiness](LML-BACKEND-READINESS.md). The immediate
batch is the owner-approved [two-stage precision handoff](LML-TWO-STAGE-PI-HANDOFF.md).
Pi measured unchanged bounds for v5; v6 narrowed the width to 1.39 percentage
points and v7 to 1.0593, but both failed the 1-point acceptance target. The
third-candidate stop led to a work-policy review; v8 now preserves the first
partition and allocates an explicit second-pass allowance. Pi acceptance remains pending.
Historical execution exceptions do not override the current Pi execution
assignment. No new SPHEREx or UI implementation is included in this batch.

## Batch 03 — Planner workflow

Generate API/jobs and the working polar map, scenario editor, sky/timeline/results. Pi returns a running preview for new user inputs. Complete site/date comparison and landing-window search in a bounded follow-up after review.

## Batch 04 — Training rules and engine

Generate a versioned educational rule sheet and deterministic coupled resource engine. Pi returns one run's histories, decisions, seed, and outcome. Owner reviews teaching assumptions and coupling before the training UI expands.

## Batch 05 — Combined application

Generate outpost setup, mission control, events, and debrief connected to an immutable planner result. A site/date change triggers a new environment; retries retain traceable equipment/rule versions.

## Batch 06 — Persistence, usability, deployment

Finish plan/run saves, resume/replay, share/import/export, recovery, accessibility, and independent deployment. Pi returns the deployed URL and artifacts; owner determines release readiness.

The requirement to review both products' foundations before either interface expands remains in the coordination plan. User direction currently authorizes Lunar Mission Lab Batch 01; SPHEREx execution is not started.

Source/configuration lives under apps/clps and data/manifests/clps. Downloaded/generated artifacts stay in ignored data/local. Scientific scope and execution timing remain as specified by the PRD and coordination plan.
