# Pi handoff — candidate-site explorer and pilot cards

Use current `codex/lunar-map-sky` source commit supplied by Codex for the app.
The ongoing collector must keep using its existing frozen `214ba7e` snapshot
and runtime. Do not restart/stop that collector, change its source, install
dependencies, alter archives or start any new calculations. Codex has not run
these scripts/tests or rendered this app. Stop at first genuine failure and
return exact evidence plus one next action. Preserve unrelated files.

## 1. Lightweight publication check and idle app restart

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_site_atlas_ui.py
```

Require exit zero. It copies only four small pilot metadata files into a temp
fixture, checks 50 entries/three ready previews and missing/corrupt-data fallback,
and confirms original pilot bytes are unchanged. It loads no scientific assets,
launches no workers, and writes nothing into real collections.

Confirm the app has no active interactive job; only restart the exact idle
`lunar_lab.planner_server` from the main checkout to load `/api/sites` and new
static files. If SIGINT is ignored, SIGTERM that exact idle app server as before.
Never signal a frozen collector or its workers. Launch:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Open/reload http://127.0.0.1:8765/#planner. Record app `/api/saved` IDs and job
count, plus the active frozen collector PID/folder if it is still running.

## 2. API and data honesty

Inspect `/api/sites`: 50 unique IDs, 20 published research candidates and 30
exploratory points. Exactly `pub-cr01`, `pub-mmo01`, `exp-cr-xp` have `ready`
status; 47 have `collecting`. All have the verified pilot's terrain context.
Read-only responses must not include or discover unfinished long-run results.

The publication is deliberately pinned by
`data/manifests/clps/site-atlas-ui.json`: pilot collection
`247f8c653445187e99a8179dd95044b6c856cd5feb40c68767d9021386a30eec`,
Nov 19–21 2026 UTC, hourly, 2 m. Compare one ready card with the exact matching
entry in its `summary/site-profiles.json`; compare one pending card's coordinates
and terrain to `sites.csv`. No interpolation, nearby-site substitution,
good/fair safety scores, full-year claims or inferred radio/power availability.

## 3. Site browsing and selection (desktop and 390 px)

- List shows all 50 sites. Search `CR01`, filter a region, published candidates,
  exploratory points, and ready previews. Expect 20/30/3 for type/readiness
  filters, and five entries for each individual region with no other filters.
  An unmatched search shows zero matches and no stale selected detail. Clearing
  filters restores the catalog. Refresh previews preserves usable controls.
- A card click/keyboard activation shows a detail panel with source link,
  coordinates, inclusion rationale, exploratory parent/offset where applicable,
  elevation, diagnostic local slope, relief and the 40 m/160 m-baseline context.
  Browse alone must not change form coordinates or submit a calculation.
- Ready preview explicitly states the two-day dates, 2 m/hourly settings and
  independence from draft dates. Check Sun/Earth explanations, UNKNOWN duration
  and longest-obstruction basis match the source. Pending site has no borrowed
  calculated conditions. A different draft date/height must not relabel previews.
- Open an existing interactive saved result, change draft date/height to other
  valid values, then Use this site on a different catalog point. Only site name
  and coordinates change; terrain centers there and elevation lookup works.
  Date/height stay entered. The old displayed result retains its own coordinates,
  sky and gold marker, with changed-input notice as before. No job POST.
- Full cap terrain view has blue published-circle and purple exploratory-diamond
  markers in correct positions. Click a catalog marker: corresponding exact
  site goes into the draft, card details appear. Drag starting on a marker must
  pan rather than select. Raw terrain click/arrow/Enter still works. Offscreen
  markers hide when zoomed; lists remain the alternative for clustered points.
- Back to Moon: catalog appears as markers and a scrollable list with distinct
  draft/published/exploratory/saved colors and labels. Sample both catalog kinds
  against API coordinates (`globe-pin` latitude/longitude data). Choosing one
  enters the picker with exact coordinates, preserving date/height. Focus in
  the Moon list still pauses the flight. Nearby markers may overlap at scale.
- Check keyboard filters/card/detail/Use action, visible focus, phone layout,
  long labels, no horizontal overflow, and no console/5xx errors. The previous
  phone heading defect must now read “window on”, with a space when wrapped.

Capture desktop/phone explorer and one dated ready card, plus a pending card and
Moon/terrain catalog markers. No new full calculation is required.

## 4. Failure and regression smoke

Use browser request blocking for `/api/sites` if available: clear message,
coordinate/map/saved-result access retained. Unblock and Refresh restores list.
Missing/tampered pilot handling is covered by the temp fixture; do not hide,
rename or alter any real running or pilot archive files for browser tests.

Open an interactive saved result, use one time/sky control and export a CSV.
Confirm draft and displayed markers remain distinct, Explore/skip still works,
app saved IDs and job count are unchanged, and frozen collection remains in
its prior running/completed state without UI-induced jobs or writes.

Return commit, focused-check output, API/filter counts, coordinate and preview
spot-checks, screenshots, no-job/no-archive-write evidence and exact failures
if any. Leave the app idle and the existing collector undisturbed. One next
action: Codex reviews this UI milestone before calendar/date-search work.
