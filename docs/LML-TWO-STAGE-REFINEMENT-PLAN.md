# Two-stage refinement implementation plan

Owner approves the second-pass direction after the v7 design review. Codex
supplies source and a bounded Pi handoff; Pi executes. No subagents.

## Design and limits

Keep the v7 initial pass, then continue only if its width exceeds 0.01. Preserve
all proved/OUTSIDE leaves, their lower areas and evidence references. Seed a
second priority queue from UNKNOWN leaves only, largest square area first.
Try existing evidence before new classification in this pass. Subdivision
replaces only an unresolved parent, keeping the complete disjoint partition.
Do not rebuild diagnostics, repeat horizon preparation or replay the root.

The explicit additional work allowance is 8,192 tile visits, 2,048 full
classifications, 2,048 reuse-only checks and 8,192 terrain visits, with depth
12. Combined ceilings are 24,576 visits, 6,144 full classifications, 6,144 reuse
checks and 40,960 terrain visits. The shared 65,536 area-strip and 128 adaptive
attempt ceilings remain unchanged. This is a deliberate additional work stage,
not a claim that the old caps remain sufficient.

Store the initial partition/checkpoint with the final evidence, excluding
duplicated region receipts but retaining their IDs. Freeze initial work ledgers
before continuing. Export per-stage actual work and combined limits. Replayer
checks both partitions, retained proved leaves, nesting of fraction intervals,
and exact ledger sums. This first implementation continues in memory with the
same prover; it does not accept arbitrary on-disk checkpoints or add a job API.

Experimental acceptance: the fixed sample must have width <=0.01 and calculation
time <=60 seconds. Then one full offline day must pass evidence replay and
finish within 300 seconds. These are this batch's latency allowances, not
service guarantees or precision promises for all sites/dates. A miss returns
the evidence and stops; no automatic policy changes or parameter sweeps.

## Source tasks

- [x] Add focused checks for a second pass that resolves only UNKNOWN leaves,
  preserves proof IDs/areas, spends no second-pass work after early success,
  and reports cumulative work correctly.
- [x] Extend `disk_area.py` with an internal continuation seed and reuse-first
  scheduling. Add `disk_refinement.py` as the small two-stage coordinator.
- [x] Wire the coordinator into `environment.py` and the fixed profiler; report
  v8 policy/limits and enforce profile precision/time acceptance.
- [x] Extend artifact replay for initial/final partitions and work ledgers.
- [x] Supply [Pi commands](LML-TWO-STAGE-PI-HANDOFF.md), run no application code in Codex, and return one
  bounded verification batch for owner review before merging.
- [ ] Pi executes and owner reviews measured precision, timing and replay.
