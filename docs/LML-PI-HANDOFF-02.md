# Lunar Mission Lab — Pi Handoff 02

Status: corrections, cell/sector enclosures, and **whole-disk obstruction classification implemented and executed by Codex on 2026-10-20**, explicitly authorized by the owner. Push and merge to remote main are authorized. L03 remains incomplete: supported upper terrain bounds and useful partial/clear-sky results are pending. Prior Pi reference runs below are historical evidence, not current validation.
Batch: horizon and operating environment (one site, diagnostic only).
Scope authority: [Lunar Mission Lab PRD](PRD-LUNAR-MISSION-LAB.md).
Active sequence: [Implementation Plan](LML-IMPLEMENTATION-PLAN.md) Batch 02.
Code branch: feat/lunar-environment (branched from feat/lunar-foundation).
Prior batch: [Pi Handoff 01](LML-PI-HANDOFF-01.md) — foundation must be reviewed before relying on these environments.

## Whole-disk obstruction checkpoint — 2026-10-20

Subsequent bounded source check: [Wider Terrain Assessment](LML-WIDER-TERRAIN-ASSESSMENT.md).
Compatible global LDEM_16 metadata and size were verified, but no hard physical
terrain envelope was established. No asset/model integration was made. One
unchanged-source offline run `20261020T191853Z-bf0f2958` reproduced the
obstruction result (25.52 seconds; seven cached assets; Sun 29 BLOCKED,
Earth 29 UNKNOWN). The next action is the explicit composite-raster contract
in that assessment. L03 remains incomplete; do not rerun or broaden research
automatically.

Implementation: [disk plan](LML-DISK-IMPLEMENTATION-PLAN.md), obstruction-classification portion of [bounds design](LML-HORIZON-BOUNDS-DESIGN.md). No new sources/dependencies, API/UI, area integrator, subagents, or generated test suite.

- Reference run: `data/local/lml/env-runs/20261020T190747Z-d1d0ed49/`; exit 0, eleven nonempty artifacts, 25.62 seconds elapsed, peak process memory 230.59 MiB. Same sample-a request and seven cached assets, offline.
- Sun: 29 BLOCKED samples, scalar and per-sample fraction bounds 0/[0,0]. Earth: 29 UNKNOWN samples, empty scalar and bounds [0,1]. No FULL/PARTIAL results. Both bodies retain one 168-hour interval under the documented left-held interpretation. This does not establish continuous blockage or visibility between epochs.
- BLOCKED now requires a supported cell witness over every possibly intersected sector, with each lower bound strictly above the entire disk's maximum elevation. A whole-disk obstruction can be established even though all diagnostic horizons remain INDETERMINATE and no complete upper bound exists.
- Deciding footprints use outward interval half-space exclusions, including the forward midpoint hemisphere. Tangent sectors and the 0/360 seam are included. Missing sectors become explicit unknown gaps; missing/model-mismatched witnesses prevent a BLOCKED claim. Malformed/overlapping sector partitions and nonfinite geometry are rejected.
- Each time-series row records fraction bounds, possible sector IDs, witnessed sector count, witness cell IDs, model ID and reason. `footprint_half_width_deg` is retained only as a diagnostic; it does not decide classification.
- Summaries include duration-weighted mean-fraction lower/upper bounds over all left-held hours; unknowns stay [0,1]. The existing scalar mean remains explicitly known-hours-only. Outward floating conversion can leave the smallest positive float as the upper mean bound when the exact mean is zero.
- Focused inline checks passed: wrap, tangency, missing sectors inside/outside the disk, model mismatch, strict equality threshold, zenith/nadir footprints, malformed inputs, fraction/duration accounting, and fine-sector rejection of opposite bearings. Final-source replay reproduced all 58 states and sector IDs. Independent sampling of 64 boundary directions per disk confirmed inclusion and blocked-sample consistency as a sanity check; the analytic interval construction supplies the enclosure argument.
- Artifact checks confirmed witness IDs resolve to cell evidence, all eleven files are nonempty, there are no unsupported FULL/PARTIAL labels, both summaries account for 168 hours, and locks are released.
- Initial run `20261020T190604Z-078db67a/` was conservative but unnecessarily included opposite-bearing sectors. It is superseded with a note in the ignored output directory; use the reference run above.
- **Next action:** specify the bounded wider-terrain/global upper-envelope source and its uncertainty contract to enable useful clear-sky and partial-disk results. Do not treat current obstruction-only results as completion of Batch 02/L03 or begin API/UI from a claimed complete visibility model.

## Cell/sector enclosure checkpoint — 2026-10-20

Implementation: [bounded plan](LML-BOUNDS-IMPLEMENTATION-PLAN.md), step 1 of [bounds design](LML-HORIZON-BOUNDS-DESIGN.md). No new sources, dependencies, API/UI, disk-area integrator, or generated test suite.

- Corrected run: `data/local/lml/env-runs/20261020T185541Z-87e28417/`; exit 0, eleven nonempty artifacts, 22.40 seconds elapsed, peak process memory 231.83 MiB. Geometry bounds took 3.84 seconds.
- Same original request, offline, seven assets reused. Prefix the execution command with `PYTHONPATH=apps/clps/api/src MPLCONFIGDIR=/private/tmp/lml-matplotlib` on this checkout. Fontconfig still reported unwritable user cache locations; PNG generation succeeded.
- 4,065 valid candidate cells enclosed, including the observer cell; the 8,192-cell candidate cap was not reached. Candidate discovery follows diagnostic-maximum neighborhoods and may miss useful witnesses; it never establishes complete terrain coverage.
- Every cell records an inner projected circle mapped to a spherical cap for witnesses and an outer cap enclosing the full square pixel. The inner circle must lie wholly inside the nominal product cap before use. No clipped/outside region is called empty.
- 1,440 closed sectors partition all azimuths at 0.25 degrees, with shared boundaries. 1,436 have a valid lower-bound witness; four remain at the trivial -90-degree lower bound. All upper bounds remain unavailable. These are bounds conditional on constant-radius pixel solids, without a physical terrain-error envelope.
- New artifacts: `terrain-cell-enclosures.csv` (inner/outer cap interval coefficients and cell IDs) and `horizon-sector-bounds.csv` (lower bounds, witness IDs, upper-bound availability and reasons). Existing horizon diagnostics remain INDETERMINATE.
- Focused checks passed for cardinal trigonometric enclosures, polar sectors, 0/360 wrap, wide/opposite-sector rejection, elevation sign, cap containment, and independent PyProj axis conventions. PyProj comparison used 1e-12 unit-vector tolerance as a sanity check, not as the interval proof. Deciding bounds use 50-digit outward Decimal operations and Taylor remainder bounds; analytic construction is recorded in the plan/code.
- An initial run `20261020T185353Z-e51d521b` exposed a projected-axis swap during review. It is superseded, with a `SUPERSEDED.txt` note in that ignored output directory. The corrected run above is the reference; do not use the earlier cell/sector geometry.
- Artifact checks confirmed all witness IDs resolve, sectors cover 0–360 without gaps, both body summaries cover 168 hours, and both locks were released. Visibility stays UNKNOWN by design in this step because sector-to-disk classification is not yet wired.
- This enclosure checkpoint has since been connected to whole-disk obstruction classification; see the newer checkpoint above. No FULL claim without a supported terrain upper envelope. Batch 02/L03 is not complete.

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
- **Method checkpoint:** see [Horizon Bounds Design](LML-HORIZON-BOUNDS-DESIGN.md). Cell/sector enclosures and whole-disk obstruction classification are now implemented (checkpoints above). Useful upper bounds, FULL/PARTIAL results and disk-area integration remain pending. Do not claim Batch 02/L03 complete.

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
- Same run folder: source-receipts.json, site-sample.csv, horizon-profile.csv, horizon-profile-coarse.csv, terrain-cell-enclosures.csv (when valid candidates exist), horizon-sector-bounds.csv, environment-timeseries.csv, environment-intervals.csv, horizon.png, environment-visibility.png.

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
- The uniform-disk circular-segment formula remains an unused straight-edge approximation. Current classification instead uses conservative sector-footprint inclusion and lower-bound obstruction witnesses. BLOCKED requires every possible sector to prove the disk obstructed, returning 0/[0,0]; otherwise UNKNOWN returns an empty scalar/[0,1]. FULL/PARTIAL remain disabled without supported upper bounds. Missing distant terrain does not undo an established obstruction.
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
