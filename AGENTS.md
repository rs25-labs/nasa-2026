# Working agreement

- Codex generates plans, source code, and Pi handoffs.
- Pi executes dependency installation, data preparation, application/build/deployment commands.
- The owner reviews outputs, handles testing, and authorizes the next batch.
- Codex must not run application code/tests or spawn subagents.
- Do not generate extensive test suites.
- Keep each handoff bounded; return concrete failures and one next action rather than expanding research.
- All source/docs belong in this repository. Large downloaded and generated assets stay out of Git.
- Product scope: docs/PRD-LUNAR-MISSION-LAB.md and docs/PRD-SPHEREX-SKY-CHANGE-INVESTIGATOR.md.
