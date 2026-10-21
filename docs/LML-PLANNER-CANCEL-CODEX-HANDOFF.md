# Codex handoff — planner cancel defect (Pi-measured) + full slice findings

Branch: `codex/lunar-precision-target` · commit `5eefcd590b182a0864118d0d4d8843e75d4251db`
Handoff followed: `docs/LML-PLANNER-PI-HANDOFF.md` (first planner slice; 0.01 width gate retired).
Pi executed all app checks against `http://127.0.0.1:8765` (existing `.venv`, cached assets, no installs).
Server left running for the owner. Generated runs/jobs live under ignored `data/local/lml` — not committed.

## 1. Defect to fix: cancel does not stop the worker (check 6 FAILED)

Repro (all from the handoff script):
1. Submit a new calculation with a different site name (`my-site-cancel`, -89.54, 0, 2 m, start `2026-11-23T21:00:00Z`, 1 day).
2. While it is `running`, cancel it (UI Cancel button → `POST /api/jobs/d2031008…/cancel` → **200**).
3. Poll `GET /api/jobs`.

Expected: job reaches `cancelled`, no new completed saved result, child releases
`.environment.lock` / `.foundation.lock` (never delete a live process's locks).

Measured:
- Job `d2031008` stayed `cancelling` for ~3 min while child PID 95812 kept computing at 100% CPU,
  then went to **`complete`** (elapsed 207.70 s — a full run), never `cancelled`.
- A **new completed saved result was created**: `data/local/lml/env-runs/20261021T051804Z-7e95adb0`
  (`my-site-cancel`, full 16-file artifacts, listed in `/api/saved`).
- Locks ended up released, but only via completion — not via cancellation. No live locks were touched by Pi.
- Server log shows the cancel was accepted (`POST …/cancel → 200` at 22:18:13) but the worker
  (`lunar_lab.batch_environment … --site-id my-site-cancel …`) ran to completion (~22:21:31).
  No traceback in the server log.

Owner decision: cancel issue set aside for now — do not let it block the rest of the slice.
Suggested Codex fix (bounded, this branch): make the cancel path actually terminate/reap the child
and mark the job `cancelled` without promoting the partial folder to a completed saved result
(partial `environment-report.json` with `"status": "running"` was already present mid-run).

## 2. Secondary finding: UI shows no error for rejected submissions (API is correct)

- `POST /api/jobs` with `latitude_deg: 0` → **422** `{"error": "latitude_deg must be between -90 and -85."}` — clear.
- `POST /api/jobs` with `start: 2025-01-01` → **422** `{"error": "The full interval must fit within 2026–2028."}` — clear.
- But submitting latitude 0 through the app UI produced **no visible error**: status area kept showing
  the previous “Loaded matching saved result”, no alert/validation text anywhere in the accessibility tree
  (scanned for error/invalid/failed/unable/please — zero hits). The 422 is swallowed.
- Fix (bounded): surface the server's `error` string in the Calculation status region on non-2xx submit.
- Console best-effort: no `window` error hook fired, no failed resource loads via performance entries;
  server log has no 5xx (only a trivial `favicon.ico` 404 from first page load).

## 3. Everything else passed (summary for the record)

- `check_planner_requests.py` → EXIT 0 (`UTC normalization, supported ranges/dates, finite numbers …`).
- Check 1: form + polar schematic render at desktop (screenshot `/tmp/lml_planner_desktop.png`) and 390 px
  phone (`/tmp/lml_planner_phone.png`); schematic explicitly labeled “not a terrain basemap”; keyboard Tab
  reaches banner → inputs → Calculate → Cancel → Retry → Refresh → saved-run buttons (exports are native links);
  opened saved run `20261021T040548Z-9f67e832` (SUN 0–0%, EARTH 100–100%, both timelines, 10-row sample table
  incl. terminal sample).
- Check 2: default `my-site` mission acknowledged in ~2 s (elapsed ticker, page usable, no %); double submit
  rejected — Calculate disabled while running + API `409 {"error": "A calculation is already running. …"}`.
- Check 3: job `938a0983` complete in 204.3 s (report `elapsed_wall_seconds` 203.65 s, peak 445.05 MiB);
  run `20261021T051322Z-8f336b8e`, key `949b388e…`. App ranges match report exactly
  (SUN 29.9–52.7% [0/12/0/12 h], EARTH 99.9–100.0% [12/0/0/12 h]); intervals total exactly 24 h per body;
  terminal samples add no duration; all UNKNOWN/PARTIAL `visible_fraction` empty (never 0/midpoint);
  longest-blocked “Unresolved” matches empty report value. Fixed 03:00Z SUN PARTIAL [0.41017, 0.42051]
  w=0.01034 — recorded only, no gate.
- Check 4: all 4 export URLs → 200, byte-identical to saved files;
  `verify_disk_area_artifacts.py …/20261021T051322Z-8f336b8e` → EXIT 0
  (`1681 clearance replays, 12 complete disk partitions, … released locks`).
- Check 5: identical resubmit → “Loaded matching saved result”, `cache_hit: true`, same folder,
  0.44 s (within 2 s target); reload 3.2 s, reopen-from-Saved 2.2 s, same ranges.
- Check 6 (remainder): retry of `my-site-cancel` inputs → instant cache hit (`816aa4a3`, 0.43 s).
  Invalid-input API messages verified (above). Form restored to valid defaults (-89.54) after testing.

## 4. Requested Codex next actions (bounded, this branch only)

1. Fix cancel so the worker stops: job → `cancelled`, no completed saved result, locks released.
2. Surface submit-time 422/409 `error` strings in the Calculation status region.
3. No numerical-refinement, API/UI expansion, or generated-asset commits in this batch.
