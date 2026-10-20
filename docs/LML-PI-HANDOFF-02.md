# Lunar Mission Lab — Pi Handoff 02

Status: correction pass applied and **one offline diagnostic executed by Codex on 2026-10-20**, explicitly authorized by the owner. Pipeline execution succeeded; L03 scientific acceptance remains blocked by unresolved horizon/footprint bounds. Prior Pi reference run below is historical evidence from uncorrected code.
Batch: horizon and operating environment (one site, diagnostic only).
Scope authority: [Lunar Mission Lab PRD](PRD-LUNAR-MISSION-LAB.md).
Active sequence: [Implementation Plan](LML-IMPLEMENTATION-PLAN.md) Batch 02.
Code branch: feat/lunar-environment (branched from feat/lunar-foundation).
Prior batch: [Pi Handoff 01](LML-PI-HANDOFF-01.md) — foundation must be reviewed before relying on these environments.

## Corrected execution checkpoint — 2026-10-20

- Run: `data/local/lml/env-runs/20261020T184246Z-2082444d/`; exit 0, nine artifacts, 26.74 seconds elapsed, peak process memory 230.77 MiB.
- Used the command below with `--offline` and `PYTHONPATH=apps/clps/api/src`. The initial direct invocation failed before starting the pipeline because the existing environment did not expose `lunar_lab`; explicitly selecting the local source path resolved it without package installation.
- All seven cached assets were reused; no sources added or downloads made. Both lock files were released after completion.
- Original parameters retained: 2-degree azimuths, 150 km requested range, base radial grid 256; comparison 4-degree azimuths/base radial grid 128. Both radial grids are densified toward 40 m spacing, capped at 4096 points.
- Horizons: 180 INDETERMINATE, zero complete; 85 terminate at missing raster and 95 at the requested cutoff.
- Sun and Earth each have 29 UNKNOWN samples, empty visible fractions, and one 168-hour UNKNOWN interval. Summaries account for the complete seven-day duration; longest blackout and mean visible fraction remain unresolved.
- Radial diagnostic differences: max 0.059436 degrees, mean 0.007670 degrees (90 common bearings). Angular diagnostic differences: max 0.613648 degrees, mean 0.177119 degrees (90 intermediate bearings, holding the fine radial grid fixed). Neither establishes an accuracy bound or validates the grid.
- Additional corrections: a capped grid reports its actual extent and `radial-sampling-cap`; cell-scale point spacing is reported separately from unresolved crossed-cell coverage; unusable maxima are excluded from refinement comparisons; nonfinite disk elevations are rejected; summary cadence text follows the requested cadence.
- Verification was bounded to this execution and inspection of its artifacts. No generated test suite or concurrency/stale-lock stress test was performed. Matplotlib used a temporary font cache after reporting that user cache locations were unwritable; both PNG files were generated.
- **Method checkpoint:** the owner authorized defining conservative one-site terrain/footprint bounds; see [Horizon Bounds Design](LML-HORIZON-BOUNDS-DESIGN.md). It separates obstruction witnesses from upper/completeness bounds and specifies whole-disk classification. The method is documented, not implemented. Next implementation is the bounded cell/sector enclosure step in that document. Do not promote the existing diagnostic to a usable visibility planner or claim Batch 02/L03 complete.

## Assignment for Pi

The authorized corrected diagnostic above has been executed; do not rerun automatically. For a future owner-directed run, reuse the Batch 01 seven-asset cache and return one site's diagnostic outputs. Do not build the API/UI, add training rules/engine, generate extensive test suites, or begin SPHEREx. The owner reviews this checkpoint before planner workflow work.

This batch samples the existing LDEM_85S_40M raster along vector-rotated great-circle profiles, retains the sampled maximum per azimuth as a DIAGNOSTIC value, joins Batch 01 geometric positions to evaluate disk footprints, and reruns a coarser grid for split radial/angular diagnostic sensitivity. No completeness bound is established and no far-field DEM is included, so every horizon stays INDETERMINATE (missing-raster vs search-cutoff) and every footprint-unresolved row stays UNKNOWN with no numeric fraction. Summaries are duration-weighted under left-held sample-state semantics. Shared assets are guarded by nested .environment.lock + .foundation.lock around acquisition. Its configured download upper bound reuses the foundation cap below 160 MiB (cache reuse expected, zero download on rerun). Allow approximately 1 GB free space.

Python requirement: 3.11–3.13. A compiler/GDAL installation is not intended to be necessary; NumPy/PyProj/SpiceyPy/Matplotlib are installed from the Python package index. Return any installation failure rather than changing system libraries broadly.

## Checkout

Use the owner's nasa-2026 checkout. Fetch origin and switch to feat/lunar-environment, creating a tracking branch from origin/feat/lunar-environment if it does not exist locally. Preserve existing local changes; do not reset/clean the checkout. Run the following from the repository root.

## Install

For macOS/Linux:

```bash
/opt/homebrew/bin/python3.11 -m venv .venv
.venv/bin/python -m pip install -e apps/clps/api
```

If the Pi machine uses Windows, use the equivalent .venv Python executable. If the editable install does not expose `lunar_lab` (stale `.pth`), reinstall with `.venv/bin/python -m pip install -e apps/clps/api --no-deps` and re-verify with `.venv/bin/python -c "import lunar_lab"`. Do not install packages into the system Python.

## Execute

```bash
.venv/bin/python apps/clps/scripts/prepare_environment.py --sources data/manifests/clps/foundation-sources.json --work-dir data/local/lml --site-id sample-a --latitude-deg -89.54 --longitude-deg 0 --observer-height-m 2 --start 2026-11-14T09:00:00Z --days 7 --step-hours 6 --az-step-deg 2 --max-distance-m 150000 --distance-steps 256 --max-download-mib 160
```

The command reuses cached assets (prints `Reusing ...` per file) and a final JSON object naming the output directory. On success, it exits 0 and the report status is complete. On handled failure, it exits 1 and writes a failed environment-report.json. A completion status means this pipeline finished, not that the owner or Codex validated the science.

Expected output layout:
- data/local/lml/assets — reused files, ignored by Git.
- data/local/lml/asset-receipts.json — unchanged unless cache was missing.
- data/local/lml/env-runs/<generated-run-id>/environment-report.json.
- Same run folder: source-receipts.json, site-sample.csv, horizon-profile.csv, horizon-profile-coarse.csv, environment-timeseries.csv, environment-intervals.csv, horizon.png, environment-visibility.png.

Reference run (Pi, UNCORRECTED code, historical only): data/local/lml/env-runs/20261019T002657Z-481564d9/ — 95 DETERMINED / 85 INDETERMINATE azimuths, refinement max diff 0.22 deg, Sun 13 BLOCKED / 16 UNKNOWN, Earth 29 UNKNOWN. Do not compare corrected-code outputs against these counts; corrected code reports all horizons INDETERMINATE and all footprint rows UNKNOWN.

Capture installed dependency versions:

```bash
.venv/bin/python -m pip freeze
```

Return that output with the artifacts. No runtime dependency lock is claimed before this installation has actually completed.

## Return to the owner

1. Console result and exit status; installation error if any.
2. environment-report.json and source-receipts.json.
3. site-sample.csv, horizon-profile.csv, environment-timeseries.csv, environment-intervals.csv.
4. horizon.png and environment-visibility.png.
5. pip freeze output and a short note about machine/OS and any failure.

Do not commit downloaded assets or generated reports. Do not broaden the source search or substitute a different DEM/kernel family when a download or convention check fails. Return the concrete error for the next bounded correction.

## Important interpretation (corrected)

- Ground tracks use Moon-fixed vector rotation preserving longitude-defined polar tangent axes; reference sphere/frame conventions unchanged.
- Every horizon is a diagnostic sampled maximum with horizon_is_complete False and completeness UNRESOLVED (termination missing-raster vs search-cutoff). Reaching max-distance without missing data does not claim completeness. Never read a diagnostic maximum as a complete horizon or clear sky.
- Radial grids are densified toward the 40 m cell scale (capped at 4096/azimuth); max_gap_m and spacing_within_cell describe point spacing. sampling_resolved remains False because this does not prove crossed-cell coverage or resolve the near field/between-ray terrain. A truncated grid reports radial-sampling-cap and its actual extent. Refinement is split into radial common-bearing and angular intermediate-bearing sensitivities, with the latter using the same fine radial grid on both bearings. Eligible complete-horizon comparisons are unavailable (not zero). No accuracy grid is locked.
- Visible fraction keeps the uniform-disk circular-segment formula as an explicitly identified straight-edge approximation. Disks are evaluated over their azimuth footprint (half-width from disk radius/center elevation); any unresolved footprint coverage forces UNKNOWN with an empty fraction. FULL/BLOCKED need conservative bounds and PARTIAL needs an applicability condition, neither established here. Labels and fractions stay consistent (no 0/1 without bounds).
- Intervals use left-held sample state over [t_i, t_{i+1}); the terminal boundary sample carries zero elapsed time and starts no zero-length interval. Summaries weight by elapsed hours (counts stay labeled as counts), means cover known hours only, longest known blocked is a lower bound when unknown time remains, and all-UNKNOWN leaves the maximum unresolved. Six-hour sampling gives coarse estimates (e.g. FULL 0h/BLOCKED 6h/FULL 12h boundary = six FULL + six BLOCKED hours, fraction 1/2), not precise event times.
- Earth-disk visibility is distinct from Earth-center communications visibility; no link-budget claim is made.
- Shared cache: .environment.lock for the whole run plus .foundation.lock around asset acquisition/receipt snapshot (consistent order); stale-lock checks preserved.
- Output angles remain geometric and topocentric; no light-time/aberration correction.
- The terrain is an interpolated shape map. Raster validity is not certified terrain accuracy or landing safety.
- Cached files are checked against prior receipts. If an untracked/corrupted cache file is found, report it before removing/replacing it.
- An interrupted process can leave .environment.lock or .foundation.lock. Confirm the old process is stopped before removing a stale lock; acquisition order is environment-outer, foundation-inner around assets only.
- The asset budget covers configured downloads, not package installation.
- UTC conversion uses naif0012.tls and its stated future-leap-second assumption.

## Optional rerun after owner direction

Use the same command with --offline to reuse verified cached assets without asset downloads. Vary only --az-step-deg / --distance-steps / --max-distance-m when directed to bound a specific numerical question. This is not required for the first review and should not start another analysis cycle.

## Open Codex audit points (correction pass)

1. Vector-rotation destination math and polar tangent-axis preservation.
2. Completeness semantics (diagnostic maxima, termination reasons, no DETERMINED without bound).
3. Footprint-based UNKNOWN propagation and straight-edge applicability.
4. Densified sampling caps and split radial/angular reporting.
5. Left-held duration weighting and terminal-sample handling.
6. Nested shared-cache locking order and stale-lock safety.

Implementation scheduling and entry eligibility remain governed by the coordination plan and applicable organizer guidance.
