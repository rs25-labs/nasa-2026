# NASA 2026 — Two-Application Build and Review Plan

Updated October 18, 2026.

## Current product direction and document authority

1. **Lunar Mission Lab:** CLPS planning plus a connected educational lunar-outpost simulation. [Authoritative proposed PRD](PRD-LUNAR-MISSION-LAB.md).
2. **SPHEREx Sky Change Investigator:** archive retrieval, comparable images, and an annotated investigation workflow. [Authoritative proposed PRD](PRD-SPHEREX-SKY-CHANGE-INVESTIGATOR.md).

The owner selected both products and requested these PRDs. Detailed requirements await their review. These PRDs supersede conflicting earlier scope; the older CLPS/SPHEREx feature lists and detailed implementation plans remain design references, not instructions to execute unchanged. Reconcile implementation batches after PRD approval.

## Review checkpoints

| Checkpoint | Lunar Mission Lab | SPHEREx | Review outcome |
|---|---|---|---|
| 1. PRD agreement | Planning, coupled resources, operations, debrief, saves/exports, and limits | Query, compatibility, viewer, annotations, saves/exports, and limits | Owner approves detailed requirements before code |
| 2. Both foundations | Terrain/kernel outputs and one environment result; educational rule sheet and a bounded simulation output | Real metadata/cutouts, local spectral compatibility, common-grid comparison, runtime/data-size report | Owner accepts actual scientific/data basis and explicit teaching assumptions |
| 3. First working workflows | Custom site/date → planner results → configured outpost run | Custom sky query → observations → linked/blink viewer | Both applications handle new user inputs |
| 4. Core completion | Comparison/date search plus mission control, events, resource consequences, and debrief | Time/spectral exploration, quality panel, annotations, and evidence workspace | Complete application workflows |
| 5. Persistence and usability | Plans/runs, resume/replay, share/import/export, and accessibility | Investigations, share/import/export, and accessibility | Owner testing and feedback |
| 6. Independent deployments | Working Lunar Mission Lab URL and reproducible assets/setup | Working SPHEREx URL and reproducible retrieval/setup | Owner decides readiness and submission |

Both foundations are reviewed before either interface expands. Pi executes one bounded batch at a time and returns concrete artifacts. Checkpoint 2 may use separate environment and training-engine handoffs; do not expand all scientific components in one uncontrolled batch.

## Ownership and execution

- Codex generates plans, code, and concise handoffs.
- Pi installs dependencies, executes code, prepares data, builds, and deploys.
- The owner reviews results, handles testing, and directs the next batch.
- Codex launches no subagents and runs no application code/tests.
- No extensive generated test suite.
- Every code handoff names prerequisites, exact commands, artifact paths, expected outputs, and known limitations.
- A failed batch returns a concrete failure and one bounded next action. Additional models, datasets, features, or infrastructure need owner direction.
- Published artifacts are attributed to Pi execution; Codex does not claim independent runtime verification.

PRD delivery ends at owner review. It does not start implementation or authorize automatic progression through these checkpoints.

## Repository and implementation boundaries

Keep all source/configuration/documentation in nasa-2026. Proposed product directories:
- apps/clps/web, apps/clps/api, apps/clps/scripts — Lunar Mission Lab planner and trainer modules.
- apps/spherex/web, apps/spherex/api, apps/spherex/scripts.
- data/manifests/clps and data/manifests/spherex.
- deploy/clps and deploy/spherex.
- docs — PRDs, models/rules, and individual Pi handoffs.

Two independent applications/deployments. React/TypeScript frontends and Python/FastAPI services remain the proposed architecture, with bounded jobs, persistent source/derived artifacts, and browser-local user saves. Share conventions before creating shared abstractions.

Large source datasets, caches, generated rasters, credentials, and SPICE binaries stay outside Git. Version/checksum manifests and reproducible preparation steps belong in the repository. No GPU or account platform is required for the initial release.

## Competition association and timing

Proposed primary associations: Lunar Mission Lab under CLPS, with the Junior Astronaut trainer as a complementary challenge; SPHEREx under Planet X and SPHEREx.

The 2026 participant terms permit solutions addressing one or more challenges for posting. That does not establish multiple registration/judging-track eligibility. The owner's two-entry participation arrangement remains unconfirmed.

Published 2026 event guidance says submitted solutions are developed during November 14–15; advance learning and data exploration are permitted. Align actual implementation with applicable organizer guidance. Full challenge statements/resources must be checked before claiming complete fulfillment of the complementary trainer challenge.

Sources: [2026 participant terms](https://www.spaceappschallenge.org/legal/), [published event guidance](https://www.spaceappschallenge.org/2026/local-events/santiago-dominican-republic/).

## Next action

Owner reviews the two PRDs and supplies revisions or approval. Codex then reconciles detailed code batches and prepares only the next requested handoff. No application code was generated or executed in this documentation update.
