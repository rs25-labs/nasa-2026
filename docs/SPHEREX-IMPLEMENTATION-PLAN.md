# SPHEREx Sky Change Investigator — Implementation Plan

Date: October 18, 2026.
Status: implementation proposal supporting the locked product choice.
Scope: [S01–S10](SPHEREX-FEATURES.md).
Authority for order and execution: [two-application plan](TWO-ENTRY-BUILD-PLAN.md).

Codex generates code and Pi instructions; Pi executes; the owner reviews outputs and handles testing. No subagents, Codex application execution, or extensive generated test suites.

## Architecture

React/TypeScript web interface and Python/FastAPI backend. Use Astropy for FITS/WCS handling and a documented reprojection library for common-grid views. Use official archive query/cutout interfaces rather than browser scraping. Confirm actual endpoint contracts and pin dependency versions in the first code handoff.

One bounded background worker performs retrieval and image preparation. Store job metadata in SQLite and immutable source/derived files on persistent disk. Frontend named investigations are browser-local with JSON portability and shareable validated inputs. Science data remains separate from rendered display images.

SPHEREx and CLPS deploy independently. Reuse project conventions without coupling their scientific models or storage.

## Proposed files and responsibilities

| Path | Responsibility |
|---|---|
| apps/spherex/web/src/features/search/ | Coordinates, target resolution, date/area controls, and observation results |
| apps/spherex/web/src/features/compare/ | Common-grid viewer, blink/timeline, and spectral selection |
| apps/spherex/web/src/features/investigations/ | Evidence annotations, local persistence, share/import/export |
| apps/spherex/web/src/lib/ | API client, typed contracts, validation, and display helpers |
| apps/spherex/api/app/routes/ | Capabilities, observations, cutouts, comparisons, jobs, and exports |
| apps/spherex/api/app/archive/ | Archive discovery, name resolver adapter, pagination, and source downloads |
| apps/spherex/api/app/science/ | FITS/WCS, local spectral metadata, compatibility decisions, reprojection, and masks |
| apps/spherex/api/app/jobs/ | Persistent serial job lifecycle, cancellation, and structured failures |
| apps/spherex/api/app/storage/ | Immutable source cache, derived artifacts, and versioned manifests |
| apps/spherex/scripts/ | Bounded data inspection and preparation commands for Pi |
| data/manifests/spherex/ | Source/release manifest and processing conventions |
| deploy/spherex/ | Application container and persistent-storage configuration |
| docs/SPHEREX-DATA-AND-MODEL.md | Actual endpoints, source fields, matching rules, units, and limits |
| docs/SPHEREX-PI-HANDOFF.md | Exact instructions and output paths for the current batch |

## Data pipeline and contracts

1. Normalize sky position, date interval, field size, and spectral selection.
2. Query official archive metadata, preserving source IDs and pagination. Resolve target names separately.
3. Determine overlap and local spectral information; return eligible/excluded/unknown decisions with reasons.
4. Retrieve bounded source cutouts, preserving FITS headers and quality/uncertainty layers.
5. Reproject compatible images to a documented reference sky grid. Combine masks and report interpolation/coverage.
6. Generate display artifacts with common stretch options. Preserve original measured values separately.
7. Attach annotations to immutable source IDs and sky coordinates, not only image screen pixels.
8. Export evidence with source and processing versions.

API namespaces: /api/v1/capabilities, /resolve, /observations, /cutouts, /comparisons, /jobs/{id}, /comparisons/{id}, /exports. GET requests read resources; POST requests create bounded retrieval/processing jobs. A job response contains its ID, state, progress, error details, and result reference. DELETE on a job requests cancellation.

An observation record includes source ID, archive URL, timestamps, sky footprint, detector/band, local spectral support or explicit unknown status, release/version, and relevant quality metadata. A comparison result includes selected sources, common grid, compatibility reasoning, derived artifact IDs, coverage masks, display settings, processing version, and warnings.

Cache keys include query/source identifiers, release, spectral selection, cutout geometry, processing settings, and algorithm version. Do not silently reuse data across reprocessed releases. Retry network failures in a bounded fashion; explain archive outages, missing observations, incompatible spectra, invalid WCS, and exhausted resource limits.

Interrupted jobs become retryable failures after restart. Shared links revalidate inputs and may reconstruct a result; they cannot promise permanent availability of an external archive product.

## Checkpoint 2 — Bounded foundation

- Codex supplies one retrieval/inspection script and exact Pi instructions.
- Pi confirms the official query/cutout contracts and source fields.
- Use one known-object/region example; allow one alternate if suitable temporal/spectral coverage is absent.
- Return query metadata, at least two candidate observations, cutout headers, local spectral information, compatibility reasoning, and one common-grid comparison when supported.
- Return elapsed time, download size, and processing memory.
- Owner reviews whether the source images support the investigation workflow.

Stop with these artifacts. Missing comparable observations trigger a concrete report; do not start whole-sky mining, new model training, or an extended catalog search. Checkpoint 2 does not include automatic discovery or difference-image detection.

## Checkpoint 3 — First working workflow

- Add API contracts, persistent jobs, bounded archive adapter, cache, and source/result retrieval.
- Build the search/results page and linked/blink image viewer.
- Connect an uncached coordinate/date query to real observations and prepared comparison images.
- Show spectral/quality exclusions and preserve user input on errors.
- Pi returns a running preview, representative request/result bundle, and screenshots from two user inputs.

Owner reviews the working application before additional feature expansion.

## Checkpoint 4 — Complete essential features

- Add timeline/wavelength selection and image-availability feedback.
- Add quality masks, coordinate/scale readouts, and source metadata.
- Add sky-coordinate annotations, notes, and evidence selections.
- Keep user interpretations distinct from computed information.
- Pi returns one complete investigation with source IDs and notes.

Quantitative subtraction is outside the required scope. Any proposal to add it needs separate owner review of the supporting scientific outputs.

## Checkpoint 5 — Persistence and usability

- Implement named local investigations, reopen/duplicate, versioned import/export, and shared-input links.
- Preserve stable source references and sky-coordinate annotations across view changes.
- Export source FITS when available, rendered previews, masks, metadata, and user notes.
- Complete keyboard controls, responsive behavior, progress/cancel/retry, empty states, and source/method page.
- Pi returns a reopenable investigation and a downloadable evidence bundle.

The owner handles application testing and returns findings. Codex makes bounded corrections from that feedback.

## Checkpoint 6 — Deployment and release

- Package the web/API/worker with persistent storage and separate environment configuration.
- Publish workload limits, cache retention, archive dependencies, health/readiness behavior, and reproducible setup instructions.
- Pi deploys to the selected host and returns URL, release version, and deployment outputs.
- Owner reviews uncached retrieval, comparison, persistence, and exports in the deployed application.

## Scope control and readiness

A first release is ready when S01–S10 work for new supported requests and users can understand why comparisons are eligible, excluded, or unresolved. A blink viewer with incompatible wavelengths is not completion. An unexplained automated detection layer is not a substitute for a sound investigation workflow.

Exact archive field names, matching tolerances, supported cutout limits, and runtime sizes are established by the bounded foundation and recorded in SPHEREX-DATA-AND-MODEL.md before later code is generated. Do not treat proposed numerical limits as validated performance.

Competition execution timing and eligibility follow the master plan. Code generation begins only upon the owner's next instruction and within applicable event rules.
