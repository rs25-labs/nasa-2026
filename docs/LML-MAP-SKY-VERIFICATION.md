# Pi evidence — map/sky and macOS worker startup

Owner supplied Pi's result screenshot on October 21, 2026. All reported checks
passed. Codex has not run these checks independently.

Pi reported checked-out commit `47926e0d470637f0f6ce8b93935d4a327e44132f` on
`codex/lunar-map-sky`, with in-progress Moon entry HTML/untracked files present
and preserved. This is evidence for the reported map/worker checks; it does not
verify the finished Moon entry at `06a5094` or assert a clean checkout test.

- `check_planner_spawn.py` and `check_planner_cancellation.py`: both exit zero;
  launch after native map use, cwd/session, inherited signals and cleanup pass.
- Server restarted idle; projection warmed by map interactions/API calls first.
  Exact previously failing input: `map-site-1`, -89.55°, 0.1°, 2 m,
  2026-11-19T09:00Z, one day.
- Job `28909271` completed: UI 24.55 s, report 24.03 s, peak 266.41 MiB,
  cache miss. Run `20261021T150826Z-c4a22710`. Coordinates/date matched;
  result marker/sky/timeline switched together and draft notice cleared.
- Evidence verifier exit zero: six clearance replays, zero complete disk
  partitions, locks released. Sun blocked/Earth full for this day is valid;
  no precision-width gate was applied.
- Repeat job `8b3d48ce`: cache hit, 0.37 s. CSV export HTTP 200, 1104 bytes.
- Desktop/390 px, visible invalid-latitude error, keyboard map controls and
  no unexpected resource/5xx/traceback errors reported. Screenshots:
  `/tmp/lml_spawn_desktop.png`, `/tmp/lml_spawn_phone.png`.
- Server left idle with valid `map-site-1` form state. `/api/saved` had six
  entries. Earlier partial unindexed run `20261021T134540Z-2e75e4dc` was left
  untouched and excluded from saved results; it is not a new defect.

The startup/retry handoff is satisfied by this report. Do not repeat its new
calculation or regressions in the Moon visual batch unless a new failure gives
a concrete reason. Next review is the finished Moon entry's visual behavior.
