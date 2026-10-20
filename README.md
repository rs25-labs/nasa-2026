# NASA 2026

Two complete web applications:

1. **Lunar Mission Lab** — combines CLPS mission planning with a connected educational lunar-outpost simulation.
2. **SPHEREx Sky Change Investigator** — real observation retrieval, compatible image comparison, and saved evidence-based investigations.

## Start with the PRDs

- [Lunar Mission Lab PRD](docs/PRD-LUNAR-MISSION-LAB.md)
- [SPHEREx Sky Change Investigator PRD](docs/PRD-SPHEREX-SKY-CHANGE-INVESTIGATOR.md)
- [Two-application coordination and review plan](docs/TWO-ENTRY-BUILD-PLAN.md)

The owner authorized starting Lunar Mission Lab. Batch 01 source is ready for Pi execution and owner review; SPHEREx remains at the PRD stage. The PRDs take precedence over earlier feature lists and detailed implementation proposals.

Codex generates plans/code; Pi executes; the owner reviews outputs, handles testing, and directs progression. No Codex subagents or application execution.

The repository now includes Lunar Mission Lab's first bounded data/geometry code batch, which has not been executed by Codex. Official submission association, eligibility for two entries, and implementation timing follow applicable organizer rules.

## Current Lunar Mission Lab handoff

- [Pi Handoff 01: execute this batch](docs/LML-PI-HANDOFF-01.md)
- [Active implementation sequence](docs/LML-IMPLEMENTATION-PLAN.md)
- [Data and coordinate contract](docs/LML-DATA-AND-MODEL.md)

Batch 01 provides a Python data-preparation/geometry command. There is no app server or frontend yet. Pi returns the specified artifacts before the next batch.
