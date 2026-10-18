# Product Requirements: SPHEREx Sky Change Investigator

Version 1.0 draft | October 18, 2026 | Owner review required
Repository: https://github.com/rs25-labs/nasa-2026
Challenge: [Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)

## 1. Product decision

Build a complete public-facing web application for finding, comparing, and investigating SPHEREx sky observations.

Core promise: **Explore how a patch of sky looks across observations, inspect what may have changed, and preserve the evidence.**

This PRD is the authoritative proposed product scope. It supersedes conflicting scope in the older SPHEREx feature list and implementation plan. Detailed code batches follow owner review. SPHEREx deploys independently from Lunar Mission Lab.

## 2. Users, problem, and differentiation

- **Curious explorer/student:** wants to choose a target or sky position, alternate observations, and investigate an apparent moving or changing source.
- **Citizen-science participant/analyst:** needs source identifiers, image compatibility, quality information, and an exportable record supporting or questioning an interpretation.
- **Educator:** can share an investigation's inputs and ask learners to explain observations and uncertainty; classroom accounts are not required.

IRSA already provides archive search, visualization, cutouts, and other analysis tools. Our added value is a connected, understandable investigation workflow: help users select comparable images, investigate change in a common sky frame, see evidence limitations, and build a persistent annotated case.

Success does not depend on finding a previously unknown planet or introducing a new detection algorithm.

## 3. Outcomes and completion measures

1. A user can submit a new supported position/date query and retrieve actual available observations.
2. The app makes it easy to compare repeat coverage while explaining why some image pairs are incompatible or uncertain.
3. Users can identify a candidate location, inspect original data and quality information, attach notes, and export a reproducible investigation.
4. The app supports known-object examples through the same backend as custom inputs.
5. The owner can use the deployed application with requests not preselected by the developer.

Proposed usability acceptance: a new user can select a valid pair, operate blink/time controls, and explain one comparison limitation without assistance. This is an owner-review goal, not a measured finding.

## 4. Main user journey

Enter RA/Dec or resolve a target name → choose angular field and date range → inspect archive observations/footprints → select comparable epochs and spectral support → load a common-grid view → blink, zoom, or step through time → inspect masks/source metadata → annotate a candidate → save/share/export.

An alternative path starts with an example investigation and allows the user to change coordinates, dates, or source selections. An example is not a special hardcoded analysis route.

## 5. Version 1 feature requirements

| ID | Requirement | Acceptance behavior |
|---|---|---|
| S01 | Sky/target search | Decimal RA/Dec entry with stated ICRS convention and units; optional documented target-name resolution. Show resolved coordinates, angular field, and UTC date interval before querying. |
| S02 | Observation discovery | Query official archive metadata, handle pagination, and list time, footprint, detector/band, relevant wavelength information, release/version, quality status, and stable source ID. |
| S03 | Compatibility guidance | Explain spatial/spectral eligibility, exclusions, and unknown metadata. Provide eligible candidates without silently picking visually dramatic pairs. |
| S04 | Aligned comparison viewer | Common celestial grid, original/common-grid view distinction, linked pan/zoom, blink, side-by-side, sky-coordinate cursor, angular scale, orientation, and missing-pixel transparency. |
| S05 | Time and wavelength exploration | Select available epochs; filter by detector/spectral support; step/play supported sequences. Date and spectral changes remain distinguishable. No synthetic in-between observations. |
| S06 | Quality/evidence inspection | Display available masks/uncertainties, source metadata, processing versions, coverage, reprojection details, and alignment limitations. An unavailable quality field is labeled unknown, not good. |
| S07 | Investigation workspace | Mark points/regions in sky coordinates, add notes and hypotheses, attach selected observations, and keep an ordered evidence trail. Annotation labels are visibly user interpretations. |
| S08 | Save/reopen/share | Named browser-local investigations, duplicate/reopen, versioned JSON import/export, and validated share links referencing sources/settings. Clearly distinguish local annotations from public URL contents. |
| S09 | Evidence export | Download source references, original cutout FITS when supplied, display PNGs, comparison settings, masks, notes, and processing/source manifest as a bundle. Include all warnings. |
| S10 | Complete application | Deployed URL, uncached requests, bounded background jobs, progress/cancel/retry, retained job states, understandable empty/error states, responsive layout, and keyboard controls. |

All ten features are required for the first complete release. Quantitative subtraction, automated source finding, classification, and orbit fitting are optional later extensions.

## 6. Search and workload boundaries

Proposed first-release defaults:
- Any sky position for which the archive returns usable data; no promise of complete repeat coverage at every position/date.
- RA normalized to [0, 360) degrees; declination within [-90, 90]. Correctly handle RA wrap and polar fields.
- Angular cutout up to 10 arcminutes per side.
- At most 20 selected observations per investigation, with up to four active comparison images. Query result pagination/truncation is explicit, and users can narrow the request.
- Date availability comes from archive metadata and capabilities; do not hardcode an assumed full-sky survey schedule as usable coverage.
- Coordinate queries remain available when name resolution fails.

Pi confirms actual field sizes, archive response costs, and limits in the first foundation batch. Numerical caps are product proposals, not validated throughput. Give users a useful explanation when a request must be narrowed.

## 7. Scientific comparison contract

### Different kinds of comparison

The app distinguishes:
1. **Temporal comparison:** matched spatial coverage and suitable local spectral support across times.
2. **Spectral comparison:** different wavelengths, with no implication that appearance differences prove temporal change.
3. **Exploratory/uncertain comparison:** missing or incompatible metadata; side-by-side only, with the reason prominent.

A linear-variable filter means wavelength depends on position within a SPHEREx image. Matching a detector/band label alone is insufficient. Eligibility must use target-local spectral information and, where necessary, per-pixel spectral support.

For a whole-field temporal blink, establish comparable support over the displayed valid region. If matching is only established around the selected target, restrict the temporal interpretation to that region and mask or clearly flag the remainder. Unknown spectral compatibility cannot become a green/approved state.

### Common-grid behavior

Reproject onto a documented reference sky grid, propagate coverage and quality masks, and retain original FITS headers/data separately. Do not register on a suspected moving source; static-sky alignment must preserve apparent motion. A common WCS does not by itself establish accurate empirical registration.

Display a shared stretch option. If per-image contrast is enabled, label it and explain that visual brightness is then not directly comparable. Never treat rendered PNG intensities as physical flux measurements.

PSF/background differences, calibration versions, and registration errors can mimic change. Version 1 uses guided visual comparison and evidence inspection. No detection probability, calibrated variability significance, or numerical source-motion claim is required.

A quantitative difference image is not part of required scope. Adding it requires owner review of registration, local spectral matching, PSF/background treatment, masks, and uncertainty propagation. Do not produce an attractive subtraction image first and invent interpretation later.

### User annotations

Store candidate points/regions in celestial coordinates with observation IDs, timestamps, notes, and the comparison settings in effect. Suggested labels: possible motion, possible brightness change, likely artifact, and unresolved. A label is not a verified discovery. Deleting or replacing a source selection warns when annotations lose their supporting evidence.

## 8. Main screens

- **Search:** target/coordinates, dates, field size, archive availability, and submit.
- **Observations:** result table/footprints, filters, quality information, selection, and compatibility explanations.
- **Investigate:** linked images, blink/time controls, spectral selection, source/quality panel, and sky-coordinate annotations.
- **Evidence:** notes, selected sources, interpretation, and export.
- **Saved Work / Methods:** local saved investigations, import/share, assumptions, and source links.

Navigation preserves the investigation. Loading a new query does not silently overwrite saved work. Deep links validate inputs and report unavailable or changed archive products.

## 9. Data, persistence, and reproducibility

Use official IRSA query/cutout services and calibrated released products. No browser scraping or raw instrument reduction. Preserve source ID, archive URL, acquisition time, release, pipeline version, relevant quality layers, cutout geometry, WCS, units, and local spectral information.

Separate:
- Immutable source cache, identified by source/release/checksum.
- Derived common-grid/display artifacts, identified by source IDs and processing settings/version.
- User investigation state: selections, notes, regions, and display settings.

Local saves and downloadable JSON preserve annotations; ordinary share URLs include only the inputs/source selections needed to reconstruct a view. Sharing annotations requires an explicit exported investigation, with a clear disclosure of included notes. No accounts or cloud collaboration in version 1.

An archive reprocessing update cannot silently overwrite the provenance of a saved investigation. Reopen the recorded version where available; otherwise report the mismatch and offer a labeled reconstruction.

## 10. Reliability and acceptance

Owner review must demonstrate:
- A new coordinate/date query returns real observations or an accurate no-data state.
- A known repeat-coverage example loads at least two epochs with documented compatibility.
- An incompatible/unknown pair is explained and cannot masquerade as a validated temporal comparison.
- Sky coordinates, masks, source dates, and selections remain consistent during blink/pan/zoom.
- Notes/regions survive save/reopen and versioned import/export.
- Evidence exports identify the actual sources and processing, and distinguish science data from display rendering.
- Archive outages, rate limits, partial downloads, cancelled jobs, invalid FITS/WCS, and interrupted processing produce recoverable states.
- Resource limits are visible; the app never submits unbounded whole-sky downloads.

Initial performance targets, subject to Pi measurement: job acknowledgement within two seconds, usable cached viewer within five seconds, and responsive blink after images load. Publish actual uncached archive/processing time limits before release. These are unverified targets.

## 11. Scope exclusions

No automated Planet Nine claim, all-sky mining, new ML model, automatic detection/classification, orbit solution, scientific novelty certification, live observatory connection, user-uploaded arbitrary FITS pipeline, account system, or multiplayer review.

The first complete product is an investigation environment. Optional algorithms must improve that workflow and have a bounded evidence case before being added.

## 12. Implementation checkpoints and ownership

1. **Bounded foundation:** one documented archive adapter and one known-object/region example, allowing one alternate. Pi returns query metadata, two candidate epochs, cutouts, local spectral information, compatible/excluded decisions, alignment output, and runtime/data-size report.
2. **First working workflow:** user query → archive observations → comparison viewer, with actual jobs/errors and uncached requests.
3. **Core completion:** time/wavelength selection, masks, source metadata, annotations, and evidence workspace.
4. **Persistence/usability:** named saves, shared inputs, import/export, responsive controls, and recovery.
5. **Deployment:** independent URL, persistent backend storage, documented external dependencies/limits, and source attribution.

Codex generates code and concise handoffs; Pi executes; owner reviews and handles testing. No Codex code execution or subagents and no extensive generated test suites. Finish both products' foundations before either interface expands. Failed checkpoints produce a concrete report and bounded next action, not an extended catalog/model search.

## 13. Decision status and sources

Product selected. Detailed requirements await owner review before code generation. Archive endpoint contracts, exact release selection, compatibility tolerances, field-size limits, and hardware sizing are recorded from foundation outputs; they are not asserted as already validated.

Competition execution timing and two-entry eligibility follow the [coordination plan](TWO-ENTRY-BUILD-PLAN.md).

Primary references:
- [IRSA SPHEREx archive and services](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [Data Explorer overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html)
- [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html)
- [FAQ](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/faq.html)

No application code, archive retrieval, or image processing was executed to prepare this PRD.
