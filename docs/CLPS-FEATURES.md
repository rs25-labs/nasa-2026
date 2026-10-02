# CLPS Lunar Mission Browser — Feature List

Status: proposed scope for owner review. Date: October 1, 2026.
Repository: https://github.com/rs25-labs/nasa-2026
Companion: [Implementation plan](./CLPS-IMPLEMENTATION-PLAN.md)

## Product goal

Help users answer: **Where and when could a lunar surface mission have the sunlight and Earth visibility it needs?**

Deliver a working web application that accepts user-selected coordinates, dates, and mission constraints; calculates results from NASA terrain and ephemeris data; compares alternatives; and preserves the resulting scenarios. Every completed feature must work across the published supported domain. Example scenarios introduce the application but use the same calculation service as custom scenarios.

Primary users are mission-planning enthusiasts, educators, and analysts exploring preliminary site/date tradeoffs. The application provides geometric planning analysis. Engineering assumptions, resolution limits, and the distinction between visibility and actual link/power performance stay visible where they affect decisions.

## What makes this worth building

The product joins three activities in one workflow:
1. See the Sun and Earth against the site's actual terrain horizon.
2. Understand the operating intervals and longest interruptions.
3. Change site, date, observer height, or mission requirements and compare the consequences.

The differentiator is this integrated workflow and transparent evidence. We do not claim a new illumination algorithm or flight-qualified mission design software.

## Proposed supported domain for version 1

- South-polar terrain: initially latitude 85°S to the pole, within the usable coverage of the selected LOLA elevation product. A coverage mask determines selectable coordinates; missing terrain cannot become flat ground.
- Dates: initially January 1, 2026 through December 31, 2028, provided the selected compatible SPICE kernel set covers the entire requested interval. Availability is exposed through the API and date controls.
- Mission duration: 1–30 Earth days. Every interval must remain inside supported dates.
- Observer height: 0–20 meters above the terrain cell elevation.
- Comparison: up to three site/scenario combinations.
- Landing-date search: up to 31 daily start candidates per request for a chosen mission duration, site, and constraints.
- Model resolution and accuracy are published from actual data/preparation outputs. Numeric coordinate entry does not imply subpixel terrain accuracy.

These are application limits for a substantial first release, not fixed storyboards. Expansion should follow a working first release.

## Version 1 features — all required

| ID | Feature | User-visible behavior and completion requirement |
|---|---|---|
| F01 | Polar map and site selection | Pan/zoom a south-polar map, inspect terrain/context layers, click any supported location, enter coordinates, or select an example location. Show marker, sampled elevation, terrain resolution, and coverage status. Use lunar coordinates and polar projection correctly. |
| F02 | Mission scenario editor | Set site, UTC start, duration, observer height, maximum acceptable darkness, maximum acceptable Earth-center visibility interruption, and minimum simultaneous sunlight/Earth-center visibility hours. Validate units, coverage, and date limits before submission. Constraints are optional; unset values do not silently become requirements. |
| F03 | Terrain-aware calculation | Generate the local horizon and time-dependent Sun/Earth directions from the selected elevation and ephemeris sources. Return new results for user inputs with progress, useful failure messages, and reuse of identical completed calculations. |
| F04 | Local sky view | Show an azimuth/elevation plot containing the terrain horizon and the Sun/Earth disks at the selected UTC instant. Scrubbing or playback moves both bodies on the same calculated timeline. Display angles and visible disk fractions; do not depict a flat horizon where terrain exists. |
| F05 | Operating timeline | Display solar visibility, Earth-center visibility, Earth disk visibility, and simultaneous operating intervals. Highlight blocked, partial, and visible states with text as well as color. Show actual UTC event times and the published temporal resolution. |
| F06 | Mission summary | Show sunlight duration/fraction, longest fully blocked solar interval, Earth-center visible duration, longest Earth-center interruption, and simultaneous operating duration. Show meets / does not meet / indeterminate for each user constraint. Explain each metric and its basis. |
| F07 | Site/date comparison | Compare up to three complete scenarios with synchronized metric definitions, constraint results, and timeline views. Reveal tradeoffs rather than hiding them behind a composite best-site score. Keep each scenario's inputs and data/model version available. |
| F08 | Landing-window search | Evaluate the permitted daily start dates using the real calculation service. Return candidates, their metrics, and constraint results; allow sorting by a selected metric and opening a candidate as a scenario. Explain when no date satisfies the supplied constraints. Report search sampling; do not claim an exact globally optimal landing time. |
| F09 | Save, reopen, and share | Save named scenarios in the browser, reopen and duplicate them, export/import a versioned scenario JSON, and copy a URL encoding validated scenario inputs. A shared link reconstructs and recalculates the scenario; it does not expose local storage or require an account. Clearly disclose that browser saves are local to that browser. |
| F10 | Export results | Download a summary, time series, and visibility intervals as CSV, plus a JSON bundle with inputs, units, sources, model version, limitations, and result identifier. Export exactly the currently calculated result, including warnings and clipping of intervals at mission boundaries. |
| F11 | Evidence and explanations | Provide a concise in-app method/source page and result-level links to terrain and kernel provenance. Distinguish any solar-disk visibility from a fully visible Sun, and geometric Earth visibility from a DSN station link. Explain missing data and near-horizon uncertainty without overwhelming the main workflow. |
| F12 | Complete application behavior | Responsive layout, keyboard-operable inputs/time controls, accessible legends, loading/progress/cancel states, recoverable errors, and a deployed URL. Keep the application useful without 3D graphics. It must handle uncached requests and server restarts; results cannot depend on developer tools or manually editing files. |

## Key screens

1. **Explore:** map, site controls, and selected-site context.
2. **Scenario:** mission inputs, local sky view, timeline, and summary.
3. **Compare:** up to three scenarios with aligned metrics and timelines.
4. **Find dates:** search controls, candidate results, and open-in-scenario action.
5. **Saved scenarios:** local saved work and import/export.
6. **About the calculation:** supported domain, sources, assumptions, and interpretation.

Implement these as a connected application with deep links. Navigation preserves current user work.

## Scientific behavior that affects the features

- Terrain comes from elevation data. Long-term average illumination maps may be used as context, not as a replacement for requested-date calculations.
- Coordinate systems, lunar reference frame, reference radius, elevation units, and the matching SPICE kernels must be explicit and consistent.
- The terrain horizon incorporates lunar curvature and sufficiently distant terrain, including terrain outside the selectable region when it can obstruct the view.
- Sun and Earth have finite angular disks. Partial visibility matters near a ridge; a center-only calculation cannot stand in for visible disk fraction.
- Earth-center visibility is the version-1 communications proxy. Earth disk fraction is displayed separately. Neither establishes visibility of a specific ground station or an RF link budget.
- Darkness means the solar disk is fully terrain-blocked under the model. Partial sunlight is reported separately and is not assumed to supply full rated power.
- Sampling and data limits are disclosed. Uncertain/unsupported results cannot receive an unconditional meets-requirements label.
- Interruption lengths are clipped to the requested mission interval; disclose when an interruption is already in progress at the start or continues after the end.
- Results are deterministic for a recorded scenario and model version. An update does not silently relabel an older calculation as current.

## Later extensions — do not bundle into version 1

- Scenario-based electrical energy model with panel orientation, load schedule, battery capacity, and efficiencies.
- Specific Earth ground-station geometry and radio link budgets.
- Local 3D terrain visualization.
- Rover traverse planning, orbital relays, and terrain hazard assessment.
- Account-based synchronization or collaborative projects.
- Larger spatial/date domains and finer resolution.

The basic mission constraints in F02/F06 remain part of version 1. The later electrical model must not delay the full working visibility/planning workflow.

## Review decisions

Proposed defaults: an accessible 2D polar map and sky plot; full F01–F12 release; browser-local saves with shareable input URLs; no login dependency; explicit constrained south-polar domain. The owner reviews these before code generation. Exact terrain assets and computational resolution are confirmed by Pi's first implementation batch and reviewed before the rest of the application is built.

## Source basis

- [NASA 2026 CLPS challenge](https://www.spaceappschallenge.org/2026/challenges/clps-lunar-mission-browser/): site/date comparison and Sun/Earth positions relative to the horizon.
- [LOLA data archive](https://pds-geosciences.wustl.edu/missions/lro/lola.htm): source terrain documentation and products.
- [NASA polar illumination products](https://pgda.gsfc.nasa.gov/products/69): lunar projection/reference-radius conventions, long-term context maps, and Earth-disk visibility interpretation.
- [NAIF SPICE Toolkit](https://naif.jpl.nasa.gov/naif/toolkit.html) and [lunar frames documentation](https://naif.jpl.nasa.gov/pub/naif/generic_kernels/fk/satellites/moon_080317.tf): ephemeris/orientation calculation and compatible lunar reference frames.

Source documentation was reviewed; no terrain downloads or model calculations were performed for this feature proposal.

