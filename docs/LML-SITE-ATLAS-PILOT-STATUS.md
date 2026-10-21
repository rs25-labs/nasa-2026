# Site atlas pilot — evidence and replay correction

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
stored UNKNOWN/bounds/budgets are unchanged. A focused synthetic check and
exact failed-run verification are pending Pi, not claimed passing by Codex.

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
