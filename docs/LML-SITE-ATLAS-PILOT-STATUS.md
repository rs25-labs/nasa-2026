# Site atlas pilot — completed and verified by Pi

## Final result on 214ba7e

Owner supplied Pi's successful continuation. No failures, installs, downloads,
solver/budget changes or source edits. Codex inspected the saved progress and
summary receipt read-only; Codex has not executed application code/tests.

- Focused cache regression passed. Exact failed run replay passed: 2,833
  clearance proofs and 54 complete disk partitions, original artifacts intact.
- Adopted collection:
  `247f8c653445187e99a8179dd95044b6c856cd5feb40c68767d9021386a30eec`.
  Original collection remains untouched. First five responses were cache hits
  with original IDs, all reverified. Only sixth job calculated fresh:
  `20261021T192345Z-c9520d47`, 1450.1 s, 1001.6 MiB; 4,084 clearance replays,
  56 complete disk partitions. Adopted collection about 1.5 GB.
- Six complete receipts. Repeat: zero new jobs, six resumed, no new runs or
  verification logs. App saved entries stayed at six.
- Summary passed: three 98-row series, 18 seasonal rows, 12 mission-window
  rows, six seams, six lineage entries and dated site profiles. All joined
  sample values matched original chunks; boundary uses chunk-two start.
  Partial month/year flags were correct. Repeated summaries were byte-identical.
- Server idle, no live collectors/workers or held locks. Full archive not started.

This completes the collection pilot milestone. Next:
[long collection from frozen source](LML-SITE-ATLAS-LONG-PI-HANDOFF.md), then
calendar/site-comparison UI using completed archive data.

## Earlier failure and diagnosis (retained history)

Pi reported `83a9721`: focused check/workload preview and all 50 terrain
preflights passed. 20 published candidates + 30 exploratory neighbors; all
neighborhoods complete at 40 m. No app saved-entry changes (six).

Original collection:
`37782bb8f8af88b6148cf386802012b59a2202f35ebc7713b6901aff56fc3f13`.

Four runs calculated and verified:
- `pub-cr01`, November 19: `20261021T162237Z-89ed297c`, 1678.7 s, 1048 MiB.
- `pub-cr01`, November 20: `20261021T170617Z-e6c2a5f5`, 1200.0 s, 935.7 MiB.
- `pub-mmo01`, November 19: `20261021T173202Z-56c6eed5`, 18.2 s.
- `pub-mmo01`, November 20: `20261021T173223Z-41c34af2`, 18.2 s.

`exp-cr-xp`, November 19, `20261021T173244Z-83a3dc5f`, calculated in 910.0 s
at 823.7 MiB, but its verifier failed comparing replay clear/termination.
Job 6 never started. No resume or summary was attempted. Original data occupies
about 1.1 GB. Runtimes cannot be estimated from the easier one-day app example.

Read-only inspection by Codex found 16,384 saved terrain nodes (full capacity),
and three trailing whole-disk proofs (`clearance-2830`–`2832`) terminating at
cache capacity. `TerrainTileProver._classify` can populate the node cache via
failed region checks without adding those checks to the published proof list.
The old verifier replays only published proofs; its cache history can differ.

The correction is confined to verifier scripts: reconstruct/check the final
saved node inventory directly against source terrain, then retain every exact
proof comparison. Positive clear claims still require full original replay;
stored UNKNOWN/bounds/budgets are unchanged. Pi subsequently confirmed the
diagnosis and the correction as recorded above.

After verification, a bounded script copies cached runs to the new verifier
identity without changing original collection metadata or promoting receipts.
The unchanged solver/package hash lets the first five requests be cache hits;
all are reverified, and only the remaining sixth job needs calculation.
Follow [replay correction handoff](LML-SITE-ATLAS-REPLAY-PI-HANDOFF.md).

Operational note: Pi's original foreground command exceeded a tool timeout,
leaving its separate-session worker to finish. Pi verified the collector PID
was dead, removed its stale lock, and restarted with nohup; job 1 was correctly
adopted via cache. This is separate from the verifier failure. Use a persistent
execution session for continuation; no live locks may be removed.
