# Product Requirements: Lunar Mission Lab

Version 1.0 | October 18, 2026 | Owner authorized starting implementation; review checkpoints apply
Repository: https://github.com/rs25-labs/nasa-2026

## 1. Product decision

Build one working web application with two connected modes: **Plan a lunar mission** and **Operate its outpost**.

Primary challenge: [CLPS Lunar Mission Browser](https://www.spaceappschallenge.org/2026/challenges/clps-lunar-mission-browser/).
Complementary challenge: [Build a Junior Astronaut Mission Trainer](https://www.spaceappschallenge.org/2026/challenges/build-a-junior-astronaut-mission-trainer/).

Core promise: **Choose where and when to land, then experience how that choice affects operating an outpost.**

This PRD is the authoritative proposed product scope. It supersedes conflicting scope in the older CLPS feature list and implementation plan. The owner has authorized starting implementation. The [active implementation plan](LML-IMPLEMENTATION-PLAN.md) and [Pi Handoff 01](LML-PI-HANDOFF-01.md) govern the current bounded batch. The application must process new supported user inputs, not only replay prepared scenarios.

## 2. Users, problem, and differentiation

- **Planning user:** an analyst, educator, or space enthusiast comparing surface operating conditions. They need site/date tradeoffs with transparent geometry and assumptions.
- **Learning user:** a student, initially designed for approximately ages 12–16, learning why power, supplies, crew protection, and mission objectives compete. They need understandable decisions with consequences.
- **Educator:** can share the same initial scenario and compare students' decisions and explanations through exported outcomes. Teacher accounts or a classroom-management system are outside version 1.

The product's distinguishing interaction is the handoff between modes. The site's calculated sunlight and geometric Earth visibility drive the training simulation. A different landing date can change charging opportunities, activity scheduling, and communication windows without changing the equipment rules.

The planner remains useful independently. Training is a functioning outpost-management experience, not a quiz appended to a map.

## 3. Outcomes and completion measures

1. A planning user can calculate a new site/date scenario, understand its interruptions, and compare alternatives.
2. A student can complete or fail a mission because of visible resource/operational decisions, explain the cause, and retry with a revised plan.
3. Changing a site/date changes the environmental inputs used in the training run; the application preserves the link to the exact planning result.
4. Users can save, reopen, share inputs, and export results for both modes.
5. The owner can review a deployed application using inputs not selected by the developer.

Proposed usability acceptance: in a brief owner-run review, a new user can find the longest darkness interval and start a training run without assistance. A learner can identify at least one resource tradeoff from the debrief. These are review goals, not measured claims.

## 4. Complete user journeys

### A. Plan and compare

Select a map location or enter coordinates → choose UTC start, duration, and observer height → optionally set tolerable interruptions → calculate → inspect sky/horizon and timeline → compare up to three scenarios → search candidate start dates → save/share/export.

### B. Configure and operate

Open a completed planning result → choose crew and mission objectives → allocate the equipment/supply mass budget → review assumptions → start the simulation → schedule activities and respond to events → pause/advance → inspect resource consequences → finish or fail → review the debrief.

### C. Learn by revising

Duplicate a run's inputs → change one equipment allocation, activity choice, site, or date → replay using the same event seed where possible → compare outcomes. A site/date change first requests a new planning result; it never silently substitutes synthetic illumination.

## 5. Version 1 feature requirements

All rows are required for the combined release. Implementation stages control delivery order, not silent feature removal.

| ID | Requirement | Acceptance behavior |
|---|---|---|
| L01 | Polar exploration | Lunar polar map with coordinate entry/click selection, example sites, elevation/context, coverage mask, and published data resolution. |
| L02 | Scenario editor | UTC start, duration, observer height, optional darkness/Earth-visibility/simultaneous-window requirements; invalid or unsupported inputs explained before submission. |
| L03 | Terrain-aware environment | Calculate local horizon, Sun/Earth directions, visible disk fractions, operating intervals, and uncertainty/coverage metadata for new supported inputs. |
| L04 | Sky and timeline | Synchronized horizon/sky view and time controls; explicit full/partial/blocked visibility states and UTC interval boundaries. |
| L05 | Planning metrics and comparison | Duration/fraction, longest interruptions, constraint outcomes, and up to three complete scenarios compared on the same definitions. |
| L06 | Landing-date search | Up to 31 daily candidate starts, sorted by a selected metric, with individual constraint outcomes and open-as-scenario action. |
| L07 | Plan-to-outpost handoff | A training configuration references an immutable planning result and displays its location, dates, model version, and environmental limits. |
| L08 | Equipment and supply configuration | Crew size, solar capacity, battery capacity, life-support reserve, food stock, shielding tier, and science equipment share an explicit mass budget. Prevent overspending; show resource units and each equipment rule. |
| L09 | Coupled simulation | Evolve energy, crew-support reserve, food, educational exposure proxy, science progress, and queued transmissions from environment and player choices. Same inputs/versions/seed reproduce a run. |
| L10 | Operations and events | Schedule science, communications, maintenance, and shelter time; pause/step/play; respond to a bounded set of clearly labeled scripted events. No background requirement to keep the browser open in real time. |
| L11 | Mission outcome and debrief | Explain success/failure, resource histories, decisions, and event chronology. Compare retries with the original run and distinguish environmental changes from configuration changes. |
| L12 | Persistence and sharing | Named browser-local plans/runs; duplicate/reopen; versioned JSON import/export; shared input links. A resumed run preserves simulation state and versions; a replay is labeled as a replay. |
| L13 | Exports and evidence | Planning CSV/JSON plus training configuration, event seed/log, resource histories, outcomes, source/model/rule versions, and assumptions. |
| L14 | Complete application | Uncached calculations, progress/cancel/retry, understandable missing-data/error states, responsive/keyboard-accessible controls, and independently deployed URL. |

## 6. Training model: minimum substantive behavior

Keep this a transparent educational model. Publish a versioned rule sheet with every default, unit, mass cost, consumption rate, event modifier, limit, and success criterion. Owner reviews that sheet and one run before interface expansion. Parameter values are configurable and not represented as verified spacecraft hardware specifications.

| System | Player decision | Coupling and consequence |
|---|---|---|
| Power | Allocate solar/battery capacity and schedule loads | Generation follows calculated visible solar fraction under a declared ideal sun-tracking assumption. Battery charge/discharge, efficiencies, rate limits, and available capacity constrain actual delivered power. No negative stored energy or free power. |
| Life support | Reserve mass for crew support and prioritize its powered load | A powered recycler reduces depletion of a simplified crew-support reserve. Power deficits increase reserve depletion according to the rule sheet. Exhaustion ends the run. The reserve is a teaching abstraction, not a physiological model. |
| Food | Allocate stock and choose crew size | Food decreases with crew and elapsed simulation time. More supplies consume mass otherwise usable by equipment. Food production/greenhouse biology is outside version 1. |
| Shielding | Allocate a protection tier and choose shelter during a scripted event | Shielding consumes mass; shelter changes the published exposure-proxy accumulation and reduces available science time. Proxy points are educational units, not predicted radiation dose or medical risk. |
| Science | Select objectives and activity schedule | Activities consume crew time and electrical energy; completed work creates science packets. Objectives and per-activity requirements are visible. |
| Communications | Schedule packet transmission during visible windows | Transmissions use power and a configured teaching-model packet rate, and require geometric Earth-center visibility. Backlog persists through blackouts. No claim of an actual RF/DSN link. |

Use an hourly default simulation step with substeps at environmental/event boundaries; integrate visibility fractions over the step. Resolve competing loads using an explicit life-support-first rule, then the user's scheduled activities. Partial power delivery must not earn full activity progress. The owner reviews numerical defaults and rules before implementation expands.

Supply three guided scenario templates using real calculated environments: an energy-constrained mission, a communication-constrained mission, and a supply/protection tradeoff. One scripted maintenance fault and one protection event are sufficient. Events are educational scenarios, not forecasts. Custom configurations remain supported.

Mission success requires crew-support and food reserves to remain above failure limits, exposure proxy to remain within the configured teaching limit, and the selected science/transmission objectives to be completed before the mission ends. A failed run is a valid outcome with an explanation.

## 7. Scientific and product boundaries

Planning uses real terrain/ephemerides; training uses those environmental outputs plus explicit simplified equipment rules. Label the two evidence levels in setup, results, and exports.

Initial proposed domain: supported terrain south of 85°S; dates in 2026–2028 within kernel coverage; 1–30 Earth-day planning intervals; 0–20 m observer height. Training initially supports 1–14 days and 1–4 crew. Publish actual limits after the data foundation. Never flatten missing terrain.

Use a compatible lunar coordinate frame, terrain radius/height conventions, and SPICE kernel set. Include terrain curvature and sufficiently distant obstructions. Finite disk fractions matter at terrain boundaries. Average illumination maps are context, not requested-date time series.

Geometric Earth visibility is not a ground-station availability or link-budget calculation. Partial sunlight does not mean full electrical power. Display numerical resolution and treat near-threshold/incomplete results as indeterminate where appropriate.

Version 1 excludes orbital flight/launch simulation, rover routing, real-time telemetry, detailed thermal/medical/radiation transport models, agricultural simulation, multiplayer, accounts, and 3D terrain rendering.

## 8. Main screens and information hierarchy

- **Explore/Plan:** map, mission controls, coverage, and calculate action.
- **Plan Results:** sky, timeline, key interruptions, assumptions, compare, and operate-this-plan action.
- **Compare/Find Dates:** consistent metrics and open-selected-plan action.
- **Outpost Setup:** crew, equipment/supplies, mass allocation, objectives, and rule sheet.
- **Mission Control:** environment timeline, resource gauges, activity schedule, event/decision log, and pause/step controls.
- **Debrief:** outcome causes, resource plots, science/transmission results, and retry comparison.
- **Saved Work / Methods:** local persistence and concise source/model explanations.

A saved plan must not be overwritten by a training decision. Changing configuration creates a distinct run.

## 9. Reliability and acceptance

Owner scope update: the fixed-sample 1-percentage-point numerical width target
is retired as a release/UI gate. Stop optimization experiments for that target.
Return actual lower/upper bounds and UNKNOWN states without fabricating scalar
values. Correct calculation, evidence integrity, input handling and useful app
behavior remain required. Begin the planner UI with the existing backend now.

Owner review must demonstrate:
- A new site/date produces a real result and can launch a linked simulation.
- Longest interruptions and constraints agree between screen and export.
- Two identical runs reproduce; changing the event seed is recorded.
- Power and supply shortfalls visibly constrain activities and can end a mission.
- A revised site/date changes environmental inputs while equipment/rule versions remain traceable.
- Save/reopen preserves state; share/import reconstructs inputs without claiming to transfer local-only data.
- Missing assets, interrupted jobs, failed imports, and unsupported intervals are understandable and recoverable.

Performance targets, subject to Pi measurement: cached results usable within two seconds; queued uncached jobs immediately acknowledge and report progress; playback/controls remain responsive. Publish actual uncached processing limits before release. These targets are unverified.

## 10. Implementation checkpoints and ownership

1. **Foundation:** Pi returns terrain/kernel manifest and one environment result. Owner reviews.
2. **Planning workflow:** custom inputs through working map/API/results, then comparison/date search.
3. **Training engine:** Codex supplies the rule sheet and deterministic simulation; Pi returns one complete run, logs, and resource histories. Owner approves model behavior.
4. **Combined application:** setup → mission control → debrief, using actual linked planning outputs.
5. **Complete product:** saves, sharing, exports, accessibility, recovery, and independent deployment.

Codex generates code/handoffs; Pi executes; owner reviews and handles testing. No Codex execution or subagents and no extensive generated test suite. Finish both products' data foundations before completing either interface. Every batch ends with concrete artifacts; failures return a bounded next action.

## 11. Challenge fit and unresolved decisions

CLPS requirements are addressed by L01–L06. The Junior Astronaut requirements are addressed by genuine outpost decisions in L07–L11, with food supplies rather than a crop-growth model in this release. Verify this interpretation against the full challenge statement/resources before claiming complete secondary-challenge fulfillment.

Build one integrated application, with CLPS proposed as the primary submission association. Combining topics does not establish permission for multiple formal registrations or judging tracks. Eligibility and event implementation timing follow the [coordination plan](TWO-ENTRY-BUILD-PLAN.md).

The owner authorized the first code handoff; later batches follow review of Pi outputs. Exact assets, numerical tolerances, educational rule constants, supported workload, and hosting size are settled through the bounded foundation/model checkpoints, not guessed performance claims.

Sources: [LOLA archive](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), [NASA polar illumination](https://pgda.gsfc.nasa.gov/products/69), [NAIF SPICE](https://naif.jpl.nasa.gov/naif/toolkit.html), and the two linked challenge summaries. No application or simulation code was executed in preparing this PRD.
