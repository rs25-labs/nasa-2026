# Lunar Mission Lab — Pi Handoff 01

Status: source generated; **not executed or runtime-verified by Codex**.
Batch: data foundation and geometric angle reporting.
Scope authority: [Lunar Mission Lab PRD](PRD-LUNAR-MISSION-LAB.md).
Code branch: feat/lunar-foundation.

## Assignment for Pi

Run only this batch. Install the supplied package, run the foundation command once, and return its outputs to the owner. Do not build the UI, add horizon/training algorithms, generate test suites, or begin SPHEREx. The owner reviews this checkpoint before the next code handoff.

This batch downloads a roughly 110 MiB terrain raster plus a small matching DE421 kernel set, inspects the PDS label, samples three coordinates, and produces a terrain preview and Sun/Earth angle report. Its configured total download upper bound is below 160 MiB. Allow approximately 1 GB free space for assets, environment, and reports; package wheels add network traffic beyond the asset cap.

Python requirement: 3.11–3.13. A compiler/GDAL installation is not intended to be necessary; NumPy/PyProj/SpiceyPy/Matplotlib are installed from the Python package index. Return any installation failure rather than changing system libraries broadly.

## Checkout

Use the owner's nasa-2026 checkout. Fetch origin and switch to feat/lunar-foundation, creating a tracking branch from origin/feat/lunar-foundation if it does not exist locally. Preserve existing local changes; do not reset/clean the checkout. Run the following from the repository root.

## Install

For macOS/Linux:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -e apps/clps/api
```

If the Pi machine uses Windows, use the equivalent .venv Python executable. Do not install packages into the system Python.

## Execute

```bash
.venv/bin/python apps/clps/scripts/prepare_foundation.py --sources data/manifests/clps/foundation-sources.json --work-dir data/local/lml --start 2026-11-14T09:00:00Z --days 7 --step-hours 6 --max-download-mib 160
```

The command prints per-asset progress and a final JSON object naming the output directory. On success, it exits 0 and the report status is complete. On handled failure, it exits 1 and writes a failed foundation-report.json. A completion status means this pipeline finished, not that the owner validated the science.

Expected output layout:
- data/local/lml/assets — downloaded files, ignored by Git.
- data/local/lml/asset-receipts.json — observed checksums/source metadata.
- data/local/lml/runs/<generated-run-id>/foundation-report.json.
- Same run folder: source-receipts.json, site-samples.csv, terrain-coverage.png, sun-earth-geometry.csv, sun-earth-angles.png.

Default output: 29 timestamps per site/body, three sites, two bodies = 174 geometry rows plus the CSV header. The final timestamp is an explicit end-boundary sample.

Capture installed dependency versions:

```bash
.venv/bin/python -m pip freeze
```

Return that output with the artifacts. No runtime dependency lock is claimed before this installation has actually completed.

## Return to the owner

1. Console result and exit status; installation error if any.
2. foundation-report.json and source-receipts.json.
3. site-samples.csv and sun-earth-geometry.csv.
4. terrain-coverage.png and sun-earth-angles.png.
5. pip freeze output and a short note about machine/OS and any failure.

Do not commit downloaded assets or generated reports. Do not broaden the source search or substitute a different DEM/kernel family when a download or convention check fails. Return the concrete error for the next bounded correction.

## Important interpretation

- Output angles are geometric and topocentric; no light-time/aberration correction.
- No terrain horizon or obstruction is calculated. Positive elevation is **not** evidence that the Sun/Earth clears terrain.
- No finite-disk visible fraction, operating-window metric, power simulation, API, or frontend is included.
- The terrain is an interpolated shape map. Raster validity is not certified terrain accuracy or landing safety.
- Cached files are checked against prior receipts. If an untracked/corrupted cache file is found, report it before removing/replacing it.
- An interrupted process can leave .foundation.lock. Confirm the old process is stopped before removing a stale lock.
- The asset budget covers configured downloads, not package installation.
- UTC conversion uses naif0012.tls and its stated future-leap-second assumption.

## Optional rerun after owner direction

Use the same command with --offline to reuse verified cached assets without asset downloads. This is not required for the first review and should not start another analysis cycle.

Implementation scheduling and entry eligibility remain governed by the coordination plan and applicable organizer guidance.
