# NASA 2026 — Agreed Two-Application Build Plan

Decision date: October 18, 2026.
Status: **product pair and overall scope locked by the owner**. Detailed implementation batches remain subject to owner review.
Repository: https://github.com/rs25-labs/nasa-2026

## The two applications

| Entry | Product | Essential user outcome |
|---|---|---|
| CLPS Lunar Mission Browser | **Lunar Mission Planner** | Compare lunar sites and start dates against sunlight and geometric Earth-visibility requirements. |
| Planet X and SPHEREx | **Sky Change Investigator** | Retrieve comparable sky observations, inspect temporal changes, and preserve an evidence-based investigation. |

Both are complete web applications within explicitly published data/compute limits. Users can supply new inputs, receive real results, inspect limitations, and save/share/export their work. Example cases use the same workflows as custom requests. No feature depends on a manually curated presentation sequence.

## Execution agreement

- Codex designs the system and generates documentation, code, and concise Pi handoffs.
- Pi installs dependencies, runs retrieval/preparation and application code, builds, and deploys.
- The owner reviews returned artifacts, handles testing, and directs the next batch.
- Codex launches no subagents and executes no application code or tests.
- No extensive generated test suite. Code batches include only essential review artifacts and exact Pi execution instructions.
- A failed checkpoint returns a concrete cause and one bounded next action. No unapproved scope expansion, model search, or open-ended scientific investigation.
- Product selection is approved. This documentation update does not authorize automatic execution of all implementation batches.

## Six shared review checkpoints

These are coordination checkpoints for two independently deployable applications, not a combined application. Finish both foundations before investing in either full interface. Within a checkpoint, Pi runs one bounded batch at a time; the owner controls progression.

| Checkpoint | CLPS delivery | SPHEREx delivery | Owner review |
|---|---|---|---|
| 1. Product agreement | Retain F01–F12 scope and explicit geometric interpretation | Approve S01–S10 and user-guided investigation scope | Pair/scope locked; review detailed feature/implementation documents before code |
| 2. Data/calculation foundation | Terrain/kernel manifests, horizon, Sun/Earth positions, one scenario's metrics | Archive queries, cutouts, matched image pair, registration/quality metadata | Real outputs, coverage, runtime, and whether the scientific basis is sound |
| 3. First working workflow | Custom coordinate/date → job → sky/timeline/summary | Custom sky coordinate/date query → observations → comparison viewer | New user inputs work end to end |
| 4. Essential features complete | Three-scenario comparison and landing-date search | Wavelength/time selection, quality overlays, annotations, investigation workspace | Complete core decision/investigation workflow |
| 5. Persistence and usability | Named local scenarios, shared inputs, CSV/JSON exports | Named investigations, share/import/export, evidence bundles | Save/reopen behavior, responsive layout, errors, and owner testing |
| 6. Deployment and submission | Independent deployed app and source attribution | Independent deployed app and source attribution | Working URLs, final application review, submission readiness |

Each app has its own checkpoint status. CLPS passing does not imply SPHEREx passed, or vice versa.

## Repository structure and shared infrastructure

Proposed implementation layout:
- `apps/clps/web/`, `apps/clps/api/`, `apps/clps/scripts/`
- `apps/spherex/web/`, `apps/spherex/api/`, `apps/spherex/scripts/`
- `data/manifests/clps/`, `data/manifests/spherex/`
- `deploy/clps/`, `deploy/spherex/`
- `docs/`: product plans and individual Pi handoffs.

Use React/TypeScript frontends and Python/FastAPI backends, with bounded persistent jobs where calculations/retrieval require them. Each application has separate storage, capabilities, scientific contracts, and deployment configuration. Share visual conventions and handoff format; introduce shared code only after an actual duplicate implementation justifies it.

Generated assets, source data, caches, credentials, and SPICE binaries are excluded from Git. Record sources/checksums and reproducible preparation instructions. No GPU, account system, distributed workers, or generic platform is a dependency for the first release.

## Definition of done

CLPS: a new supported site/date scenario can be calculated, interpreted, compared, used in a landing-window search, and saved/shared/exported through the deployed application.

SPHEREx: a new supported sky/date request retrieves actual observations; users can inspect which images are comparable, compare them in a common sky frame, review quality information, annotate evidence, and save/share/export the investigation. Automatic object discovery and classification are later extensions.

For both: unsupported inputs produce useful explanations; numerical/data limits remain visible; results identify source and model versions; deployment supports uncached requests. Owner testing determines readiness.

## Competition scheduling and two-entry eligibility

The two-product build decision is distinct from confirmation of two official entries. Current published event guidance says submitted solutions are developed during the November 14–15 event, while learning and data exploration can happen beforehand. Align execution with the applicable organizer rules; do not treat this plan as permission to begin submitted-solution development early.

Two-entry eligibility for the owner's participation arrangement remains unconfirmed. The owner should obtain an organizer answer before committing both as official submissions. Do not infer eligibility from the ability to create two applications or repositories.

Source: [published 2026 event guidance](https://www.spaceappschallenge.org/2026/local-events/santiago-dominican-republic/). Full challenge statements/resources must be checked when available and material changes returned to the owner.

## Document map

- [CLPS features](CLPS-FEATURES.md)
- [CLPS detailed implementation plan](CLPS-IMPLEMENTATION-PLAN.md)
- [SPHEREx features](SPHEREX-FEATURES.md)
- [SPHEREx detailed implementation plan](SPHEREX-IMPLEMENTATION-PLAN.md)

Next action: owner review of the detailed plans. The first code handoff, once requested and appropriately scheduled, is one bounded foundation batch. No application code was generated or executed to create this plan.
