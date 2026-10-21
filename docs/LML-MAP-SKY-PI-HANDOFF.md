# Pi handoff — terrain map and linked sky/time exploration

Use branch `codex/lunar-map-sky`, the source commit supplied with this handoff,
the existing `.venv`, and cached assets. Codex has not executed code/tests or
rendered the UI. No dependency installation, downloads, solver changes or
precision experiments. Stop at the first genuine failure and return its exact
command/output and expected versus actual behavior. Preserve unrelated files.

## 1. Focused map check and restart

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_map_view.py
```

Require exit zero. This checks projection axes/roundtrips against PyProj,
out-of-cap masking, source-pixel agreement and bounded/native-resolution views.
It reads existing assets and performs no downloads or new environment run.

Restart the idle planner server to load new endpoints; do not stop an active
calculation or remove live locks. If the idle background server ignores SIGINT,
stop that exact idle server with SIGTERM as in the previous handoff. Then:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Open http://127.0.0.1:8765 and reload the browser so both new JS files load.

## 2. Real terrain map

- Confirm the map shows real LOLA elevation/relief, not the former schematic.
  The full cap has a masked/checkered exterior. Zoom/pan must not turn invalid
  areas into flat terrain. Relief lighting must be labeled illustrative.
- Drag and use arrow keys to pan; +/- and Full cap to zoom/reset. Selected site
  centers a local view. Stop zoom at 40 m display spacing. Source resolution
  stays 40 m; display spacing changes with zoom. Inspect source/frame metadata
  in the map-status tooltip. Check map source responses remain bounded 192×192.
- Click a usable point. Coordinates and selected elevation should update from
  the full-resolution pixel lookup. Compare the site's projected position and
  elevation through `/api/terrain/site?latitude=…&longitude=…` with the returned
  form values (the reader normalizes longitude to 0–360; compare modulo 360).
  Keyboard Enter selects the viewport center; coordinate fields
  remain a keyboard path. Unsupported/no-data selection must show a message.
- Reject malformed/nonfinite/out-of-range queries clearly, e.g.
  `/api/terrain?x=0&y=0&span=1` and `/api/terrain?x=nan&y=0&span=320000` → 422.
  Do not alter/delete cached assets to manufacture a failure.

## 3. Saved real result: synchronization

Open the saved `my-site` transition result from the preceding verified app
milestone (2026-11-23T21:00Z, one day). Use its existing CSVs as the reference.
No new calculation is needed for these checks.

- The gold result-site marker and result coordinates must refer to this saved
  result. Mint identifies draft inputs. Change the draft site/date: a notice
  must explain that the displayed sky/results have not been recalculated. The
  old result marker/data must not silently follow the new draft.
- At the first, middle and final samples, verify UTC, Sun/Earth azimuth and
  center elevation, visibility states and fraction bounds against saved samples.
  SVG marker groups expose `data-body`, `data-azimuth`, `data-elevation`; the
  sky exposes `data-utc`. Positions/readouts must come from those exact rows.
- Slider, previous/next buttons, interval buttons and table time buttons must
  all update the same UTC, both bodies, both timeline cursors and both highlighted
  sample rows. Clicking an interval chooses its calculated start, not an invented
  event time. No fetch/recalculation should occur just from time selection.
- Play advances one stored sample per second and stops at the terminal sample;
  Pause stops it. The final sample is labeled zero duration. Opening another
  result or hiding the page stops playback. No interpolated fractions/positions.
- The drawn horizon must remain labeled sampled/diagnostic, with missing profile
  data left as gaps. Do not judge FULL/BLOCKED by comparing center points to
  that diagnostic curve; labels come from the stored calculation.

## 4. One bounded new-site app run

Select a nearby usable point with coordinates different from the saved site
(for example near -89.55°, 0.1°); use a fresh site name, start
2026-11-19T09:00Z, one day, 2 m observer height. Submit through the UI.
This date is a bounded functional check, not a parameter search.

Require prompt job acknowledgment, usable map/time controls while calculating,
and a completed result whose coordinates exactly match the selected input.
Check the new gold marker/sky/timeline switch together to that result and the
draft-change notice clears. Record runtime; wider bounds/UNKNOWN are valid.
Run the existing verifier once on its returned folder:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<new-run-id>
```

Require exit zero. Repeat the same submission once for a cache hit and smoke
check a CSV export. No old precision profile or fixed-width acceptance gate.

## 5. Visual and regression smoke check

Check desktop and 390 px phone layouts, keyboard access to map/time controls,
clear focus/highlight states and no console errors. Capture one map + sky
screenshot at each width. Confirm the previously fixed visible-invalid-input
message still works. No new cancellation stress/full numerical regression batch.

Return source commit, check/verifier outputs, screenshots, synchronization and
coordinate checks, new run ID and observed timings. Leave the app running idle
for the owner. Generated assets/logs stay ignored; make no source edits. One
next action: Codex reviews any concrete defect or integrates the verified app
milestone after the owner reviews Pi's results.
