# CLPS Lunar Mission Browser — Implementation Plan

Status: proposed plan for owner review. Date: October 1, 2026.
Repository: https://github.com/rs25-labs/nasa-2026
Scope: [Feature list F01–F12](./CLPS-FEATURES.md)

**Goal:** deliver a working web application for terrain-aware lunar sunlight/Earth visibility, mission comparison, and landing-date exploration.

**Execution agreement:** Codex generates plans and code. The user's Pi coding agent installs dependencies, runs preparation/build/deployment commands, executes code, and returns outputs. The owner handles testing, reviews those outputs, and authorizes subsequent batches. Codex does not launch subagents or execute application code. This document proposes work; it contains no implementation code or generated test suite.

## 1. Recommended approach

Use a TypeScript React application for the interface and a Python FastAPI service for numerical calculations. Prepare/version NASA terrain and SPICE assets once; perform scenario calculations on the server for requested user inputs. Serve the finished application and API under one origin.

Recommended components:
- Web: React, TypeScript, Vite, OpenLayers for custom lunar polar projection, and SVG charts for sky/timeline views.
- Calculation: Python, FastAPI/Pydantic, NumPy, Rasterio/PyProj, and SpiceyPy wrapping NASA SPICE.
- Persistence: SQLite for job/result metadata, filesystem storage for generated arrays and cached horizons, browser local storage for named scenarios.
- Deployment: a container on a host with persistent disk. Static web build served by the API. Record actual dependency versions in lockfiles when Pi creates the project.

No GPU, Redis, distributed queue, or account service is required. One bounded serial calculation worker keeps SPICE kernel state and the initial deployment simple. The API handles reads while the worker computes; larger concurrency is a later measured decision.

### Approaches considered

| Approach | Strength | Limitation | Decision |
|---|---|---|---|
| Precomputed site/date tables only | Simple delivery | Does not satisfy arbitrary supported coordinates/scenarios | Use only as optional examples/cache |
| Browser-only numerical engine | No calculation server | Large terrain/kernel assets and difficult compute isolation | Do not use for version 1 |
| Versioned data + server calculation + web interface | Full user workflow with controlled compute/data | Requires persistent server and job lifecycle | Recommended |

## 2. Repository layout

All source, documentation, configuration, and preparation scripts belong in nasa-2026. Large downloaded datasets, generated rasters, cache files, credentials, and SPICE binaries are excluded from Git; commit a source/checksum manifest and reproducible preparation instructions instead.

| Path | Responsibility |
|---|---|
| docs/CLPS-FEATURES.md | Reviewed feature scope |
| docs/CLPS-IMPLEMENTATION-PLAN.md | This implementation sequence |
| docs/DATA-AND-MODEL.md | Selected terrain/kernels, coordinates, units, coverage, and numerical conventions |
| docs/PI-HANDOFF.md | Exact batch commands and output checklist, added with code |
| docs/DEPLOYMENT.md | Build, storage, environment, and release instructions |
| apps/web/src/features/explore/ | Polar map and site selection |
| apps/web/src/features/scenario/ | Inputs, sky plot, timeline, and summary |
| apps/web/src/features/compare/ | Scenario comparison |
| apps/web/src/features/date-search/ | Candidate-date workflow |
| apps/web/src/features/saved/ | Browser saves, sharing, and import/export |
| apps/web/src/lib/api.ts | Typed API client and structured errors |
| apps/web/src/lib/contracts.ts | Web representations of the API schema |
| services/api/app/main.py | API composition and static web serving |
| services/api/app/routes/ | Capabilities, scenarios, jobs, results, and exports |
| services/api/app/models/ | Versioned request/result/error contracts |
| services/api/app/science/terrain.py | Elevation sampling and terrain transforms |
| services/api/app/science/horizon.py | Horizon calculation and finite-disk obstruction |
| services/api/app/science/ephemeris.py | Compatible kernels, time conversion, local Sun/Earth geometry |
| services/api/app/science/visibility.py | Visibility states and transitions |
| services/api/app/science/metrics.py | Mission metrics and constraint evaluation |
| services/api/app/science/search.py | Bounded landing-date evaluation |
| services/api/app/jobs/ | Single worker, persistence, cancellation, and progress |
| services/api/app/storage/ | Scenario/result cache and model-version keys |
| scripts/prepare_data.py | Reproducible data preparation |
| scripts/describe_model.py | Manifest/coverage report for owner review |
| data/manifests/ | Committed sources, checksums, projections, and model versions |
| deploy/Dockerfile, compose.yaml | Single-host application packaging |

File boundaries may be consolidated where appropriate, but preserve the separation between geometry, metrics, API, and UI.

## 3. Data and model decisions

### Terrain and reference frame

Pi's first batch retrieves one documented LOLA elevation product for the selectable south-polar region and a suitable broader elevation product for distant obstructions. Select one dataset family and retain its PDS labels. Convert to a documented working format, preserving scale/offset, nodata, projection, horizontal resolution, height/radius convention, and lunar reference frame.

Do not use the average illumination layer as an elevation raster. Context maps may use published averages, clearly labeled as such. Display rasters may be reduced in resolution; numerical calculations use the recorded calculation data.

Use the lunar body-fixed frame compatible with the chosen terrain convention. Load a mutually compatible planetary SPK, lunar orientation binary PCK, frame kernel, planetary constants, and leap-second kernel. Record filenames, versions, checksums, and valid time intervals. Do not combine a frame kernel with a different lunar-orientation realization merely because both load successfully.

### Horizon and ephemeris

Compute a terrain horizon at the observer's position and height. Transform terrain into consistent Moon-fixed Cartesian/local coordinates so curvature is included. Use fine terrain locally and coarser terrain farther away. Extend terrain queries until a documented conservative bound shows excluded terrain cannot alter the required horizon tolerance; if coverage/bounds cannot establish this, return an incomplete-horizon warning or reject the site.

Initial proposed numerical defaults are 0.5-degree azimuth sampling and 15-minute temporal sampling. These are starting engineering settings, not claimed accuracy. Pi returns horizon coverage, processing time, and refinement differences for owner review. Improve only if those outputs show a material problem.

Compute observer-to-Sun and observer-to-Earth geometry with a stated SPICE frame/time/aberration convention. Calculate azimuth and elevation in the same local frame as the horizon. UTC inputs are converted through the leap-second kernel; dates displayed to users remain UTC.

Calculate visible fractions of the finite solar/Earth disks against the angular horizon, using documented disk sampling and boundary refinement. Establish a declared numerical tolerance in the model manifest and record it in results; do not hide discretization behind precise-looking decimals.

### Metrics and event timing

Calculate solar-disk visibility, Earth-center visibility, Earth-disk visibility, and simultaneous Sun/Earth-center intervals. Refine detected state transitions within coarse sample brackets to a proposed one-minute time tolerance. Record that changes briefer than the sampling/model resolution may remain unresolved.

Derive duration percentages, longest interruptions, and user constraint results from intervals, not chart pixel positions. Treat mission boundaries consistently. Cases near a numerical/data limit become indeterminate, including constraints within a recorded timing tolerance of a threshold.

Search daily candidate start dates using the same horizon/ephemeris/metric components. Reuse geometry across overlapping mission intervals and preserve each candidate's sampling/coverage metadata.

## 4. API and result contract

Base path: /api/v1. OpenAPI is the schema source. Maintain one typed representation on the web; do not let scientific fields become undocumented ad hoc JSON.

| Endpoint | Purpose |
|---|---|
| GET /capabilities | Model version, coverage, supported dates, scenario/search limits, numerical settings |
| GET /sites | Example-site names, coordinates, context, and coverage status |
| GET /terrain/tiles/{z}/{x}/{y} | Prepared map tiles in the documented lunar polar grid |
| POST /analyses | Validate a scenario and return a calculation job |
| GET /jobs/{id} | queued/running/completed/failed/cancelled status, progress, errors, result reference |
| DELETE /jobs/{id} | Request cancellation; expose whether cancellation has completed |
| GET /results/{id} | Immutable inputs, model provenance, horizon, samples, intervals, metrics, warnings |
| POST /date-searches | Validate and queue a bounded candidate-date search |
| GET /search-results/{id} | Candidate inputs, results, constraint status, and provenance |
| GET /results/{id}/exports/{format} | JSON bundle or ZIP of summary/time-series/interval CSVs |

Scenario inputs: schema version, latitude/longitude in stated degrees, UTC start, duration in hours, observer height in meters, and optional requirement thresholds with explicit units. Validate imported/shared inputs identically to submitted inputs.

Analysis result: immutable result ID; normalized inputs; model/terrain/kernel IDs; horizon arrays; UTC samples with Sun/Earth directions and visible fractions; typed event intervals; metric units; individual constraint outcomes; coverage/resolution warnings; creation timestamp. Include requested and snapped/calculated terrain location when they differ.

Cache identity includes normalized inputs, model version, terrain version, numerical settings, and requirements. Preserve result IDs across model updates. Repeating a completed request may return the existing result; missing/expired files cannot be reported as successful.

Jobs persist in SQLite. On restart, interrupted jobs become explicitly failed/retryable rather than remaining stuck. Limit request size, candidate count, duration, and concurrent queue depth. Use structured error codes for unsupported site/date, invalid input, unavailable assets, queue limit, incomplete horizon, cancelled job, and calculation failure.

## 5. Implementation batches for Pi and owner review

Each batch contains generated source/configuration, exact execution instructions, and an output checklist. Pi returns outputs; the owner decides whether to continue. Do not silently proceed through all batches after a failed checkpoint.

### Batch 1 — Data foundation and coordinate contract

Features: foundation for F01/F03/F11.

- [ ] Add repository README, ignore rules, dependency manifests, and preparation scripts.
- [ ] Select documented terrain and a compatible SPICE kernel set.
- [ ] Prepare elevation/context/map assets and coverage metadata.
- [ ] Write DATA-AND-MODEL.md with actual asset IDs, units, projections, frames, and supported dates.
- [ ] Return a manifest, data-size summary, coverage image, and sampled elevations for three example locations.
- [ ] Owner reviews data usability and coordinate/model conventions.

Stop at these artifacts. If a source is unusable, report the concrete failure and one bounded alternative; no broad dataset search.

### Batch 2 — Numerical calculation core

Features: F03/F05/F06 scientific foundation.

- [ ] Implement terrain sampling, horizon, ephemeris, finite-disk visibility, intervals, metrics, and constraints.
- [ ] Generate an exported result for one example site over one requested mission interval.
- [ ] Include one horizon image, Sun/Earth angle table, visibility timeline, and interruption summary for owner review.
- [ ] Include source/reference comparisons where matching geometry/time conventions exist; long-term average maps are context, not exact validation of a short interval.
- [ ] Return computation time, memory use, and one bounded resolution-refinement comparison.
- [ ] Owner reviews whether the scientific output supports building the application around it.

No broad parameter sweep or automatic test-suite generation. The refinement comparison is a necessary numerical output, not an open-ended research project.

### Batch 3 — API, jobs, and results

Features: F03/F10/F11/F12 backend.

- [ ] Add request/result schemas, capabilities, persistent job lifecycle, result storage, and cache identity.
- [ ] Expose calculation, job, result, and export endpoints.
- [ ] Bound workloads and implement cancellation/restart behavior and structured errors.
- [ ] Return OpenAPI, example request/response files, and a Pi-run uncached calculation result.
- [ ] Owner reviews input behavior and backend output.

### Batch 4 — Working scenario application

Features: F01/F02/F04/F05/F06/F11.

- [ ] Build responsive page shell, lunar polar map, coordinate selection, and mission editor.
- [ ] Connect user submissions to actual API jobs with progress/cancel/error states.
- [ ] Build sky plot, timeline/playback, summary cards, and in-context explanations.
- [ ] Show coverage/date limits, quality warnings, and exact result provenance.
- [ ] Return the running preview URL and screenshots for two different user-entered scenarios.
- [ ] Owner reviews the connected application.

Use real data for review output. Any temporary fixture during development is labeled and removed from release workflows.

### Batch 5 — Comparison and landing-date search

Features: F07/F08.

- [ ] Implement comparison state and aligned result views for up to three scenarios.
- [ ] Implement bounded search through the shared scientific service and job mechanism.
- [ ] Provide sorting, individual constraint outcomes, no-solution states, and opening a candidate as a scenario.
- [ ] Return comparison output and one date-search output, with actual duration/compute metrics.
- [ ] Owner reviews whether the tradeoffs are understandable and useful.

### Batch 6 — Persistence, sharing, exports, and usability

Features: F09/F10/F11/F12.

- [ ] Add named local saves, reopen/duplicate, schema-versioned import/export, and shareable input URLs.
- [ ] Preserve work across navigation and validate externally supplied scenario inputs.
- [ ] Finalize CSV/JSON exports with units, assumptions, IDs, and warnings.
- [ ] Complete keyboard access, legends, responsive layouts, and method/source page.
- [ ] Return saved/shared scenario examples and downloadable result artifacts.
- [ ] Owner performs their application review and testing.

### Batch 7 — Deployment and release handoff

Features: F12 and release of F01–F11.

- [ ] Package the web/API/serial worker for one persistent host.
- [ ] Add deployment instructions, health/readiness behavior, environment template, storage locations, and backup/recovery guidance.
- [ ] Keep raw data/caches outside Git and document prepared-asset installation.
- [ ] Pi deploys to the owner-selected host and returns the application URL, version, and deployment outputs.
- [ ] Owner reviews the deployed application and decides release readiness.

Hosting-provider selection is deferred to this batch; it does not block the feature/design review. The container contract avoids tying the calculation service to a static-only hosting provider.

## 6. How batches are handed off

Codex supplies changes and a concise PI-HANDOFF.md section: prerequisites, exact commands, expected artifact paths, and the outputs to return. Pi runs them. The owner provides feedback or approval. Execution results supplied by Pi are reported as Pi outputs, not claimed as independently verified by Codex.

Do not add extensive generated tests or dispatch subagents. The owner determines and handles testing. Include only artifacts essential to assessing data correctness, scientific results, functional completion, and deployment.

Do not use a new research question, a larger dataset, or another framework as a reason to expand a batch. Fix concrete failures within the approved scope or return a bounded decision to the owner.

## 7. Completion criteria

All F01–F12 features operate through the deployed application. A user can select a new supported coordinate/date combination, receive an uncached analysis, inspect the sky/timeline/summary, compare alternatives, search start dates, save/reopen/share the scenario, and export the actual result.

Failures are understandable and recoverable. Scientific units and assumptions are consistent across the UI and exports. Example scenarios exercise the same backend as user-created scenarios. Prepared data, kernels, and dependency versions are reproducible from repository instructions. The owner determines correctness and release readiness from their reviews/testing.

## 8. Source references and current uncertainties

Primary references: [CLPS challenge](https://www.spaceappschallenge.org/2026/challenges/clps-lunar-mission-browser/), [LOLA archive](https://pds-geosciences.wustl.edu/missions/lro/lola.htm), [NASA polar products](https://pgda.gsfc.nasa.gov/products/69), [SPICE Toolkit](https://naif.jpl.nasa.gov/naif/toolkit.html), [NAIF lunar-frame kernel documentation](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf).

This is an implementation proposal. Actual selected DEM files, compatible kernel set, horizon numerical tolerance, processing performance, and hardware sizing are established through batches 1–2, then recorded as concrete outputs before application expansion. Existing documentation supports the approach; no calculation or runtime installation has been executed for this plan.

The full challenge statement/resources, when published, must be reconciled with scope before competition submission. Owner review of these two documents is the next step; code generation follows their instructions.

