# Lunar Mission Lab — one-site horizon and disk bounds

2026-10-20. Scope: the conservative-method checkpoint authorized after the corrected Batch 02 diagnostic. This defines the next calculation; it does not claim the algorithm has been implemented or scientifically validated. No new sources, API/UI, training engine, or SPHEREx work.

## Decision

Use bounds over terrain **areas and azimuth sectors**, then bounds over the **whole apparent disk**. Classify only what those bounds establish. A complete horizon is sufficient but is not necessary to prove an obstruction: missing distant terrain cannot undo an already-established obstruction.

The existing seven assets support a first implementation of conservative obstruction witnesses within the DEM model. They do not supply a global lunar terrain envelope. FULL and accurately resolved PARTIAL results are therefore not promised by this source-limited checkpoint.

Alternatives considered:

| Approach | Consequence |
| --- | --- |
| Finer point rays | Useful diagnostics, but no guarantee that narrow ridges or intervening cells were included. Do not use as proof. |
| Area/sector bounds with explicit unknown terrain — selected | Can prove some obstruction despite incomplete coverage; supports a later global envelope without rewriting disk evaluation. |
| Wider DEM plus global height envelope | Needed for generally useful upper bounds and clear-sky results; requires a separate, explicit source/model change. Downloading another DEM alone does not establish error bounds. |

## Terrain model and meaning of a bound

Define `lml-polar-cell-solid-v1`: each valid nearest-neighbor pixel occupies its projected square, clipped to the nominal latitude cap, with constant radius `1737400 + DN*0.5` m. Its solid interior extends radially inward. Shared pixel edges belong to the union of adjacent solids. Invalid pixels and the domain exterior are unknown, never empty space. This explicitly defines the surface between pixel centers; it is a modeling choice, not a measured surface or a bound on actual terrain.

Preserve the requested observer direction, sampled observer radius, east-positive coordinates, and MOON_ME_DE421 frame. Include the containing cell and distances below 40 m. Do not silently relocate the observer to the pixel center. At height zero, equality/contact is unresolved unless handled explicitly by the intersection calculation.

All bounds are conditional on this raster model and the existing geometric ephemerides. There is no supplied per-cell terrain-height error envelope. Do not label these results as landing-safety guarantees or as bounds on the actual lunar surface. Keep numerical uncertainty distinct from missing data and physical/model uncertainty.

## Horizon bounds

For each closed azimuth sector A, compute:

- `horizon_lower_deg`: a value L such that every azimuth in A has an obstruction at elevation at least L, supported by valid terrain witnesses.
- `horizon_upper_deg`: a value U such that every obstruction at every azimuth in A is at or below U. A useful U requires coverage of every possible contributor, including near field, between rays, gaps, and omitted terrain.
- `upper_bound_available`, witness cell/region identifiers, coverage reasons, angular extent, numerical slack, model ID, and termination reason.

Use [-90, +90] as trivial bounds when evidence is absent; mark useful upper bounds unavailable rather than calling this a determined horizon. A lower bound can be valid while the upper bound remains unavailable. An individual sampled maximum is not a lower bound over a finite-width sector.

Process projected cell/tile footprints, not a fixed-distance point grid. Use a hierarchy to reject irrelevant regions and subdivide ambiguous ones. Every rejected region needs a geometric exclusion or an upper bound proving it irrelevant. Unprocessed regions remain unknown. Surface-area coverage must include cell boundaries and the domain clip; a collection of sampled corners is not a conservative enclosure of a curved projected footprint.

A witness supports L over A only if its angular footprint provably covers A and its conservative apparent-elevation lower bound applies throughout that coverage. Several witnesses may cover a sector jointly, provided their closed intervals cover it without gaps. A terrain point at one bearing cannot support the neighboring bearing. Sector wrap at 0/360 degrees is explicit; polar coordinates retain the existing longitude-defined tangent axes.

For a surface radius r, observer radius r_o, and central separation delta, the apparent elevation is:

`e(r, delta) = atan2(r*cos(delta) - r_o, r*sin(delta))`.

This follows from the same observer-relative 3D vector used in Batch 02 and includes spherical curvature. For fixed delta in (0, pi), elevation increases with r. For fixed r, endpoint evaluations alone are insufficient: when r < r_o, the maximum can occur at `delta = acos(r/r_o)`. Include that stationary point when it lies in the enclosed separation interval. Degenerate/coincident cases require explicit handling; an arithmetic failure returns unresolved.

Footprint enclosures and extrema need outward numerical slack, with ambiguous comparisons subdivided or left unknown. Ordinary floating-point sampling plus an arbitrary epsilon is not a proof of enclosure. The first implementation must document and check the enclosure construction before using it to classify results.

## Missing and far-field terrain

Missing terrain affects the upper bound, but does not invalidate an independent valid lower-bound witness. Never require every profile to be complete before accepting a proven obstruction.

The label's DERIVED_MAXIMUM of 14054 DN (= 7027 m above the reference sphere) describes this regional product. It is not a maximum for terrain outside the product and must not be reused as one.

Retain 150 km as a requested diagnostic search extent, not a completeness radius. Reducing the extent cannot create evidence that omitted terrain is harmless. Hitting a cell/work/time budget also cannot establish completeness.

A future far-field source/model must provide a documented upper radius envelope R_max applying to all omitted directions. If all omitted terrain begins beyond central separation delta_0, maximize `e(R_max, delta)` over `[delta_0, pi]`, including the stationary point above when applicable. This scalar bound is conservative across azimuths; it can be combined with tighter sector bounds. Interior holes need their own separation bounds. Without a supported R_max and coverage argument, leave the upper bound unavailable. Do not invent a global maximum or infer one from the polar cap.

## Disk bounds and classifications

Evaluate every direction in the apparent disk, including intersected sectors between sampled bearings. A sector is included whenever its closed interval intersects the footprint, not only when its center lies inside. Disks containing zenith or nadir require all azimuths and an explicit direction-vector treatment.

Use strict comparisons with outward numerical slack:

- **BLOCKED:** every disk direction is at or below a proven obstruction. For a sector, a sufficient condition is L strictly above the maximum disk elevation in that sector. Missing farther terrain cannot invalidate this proof. Return fraction bounds [0, 0].
- **FULL:** every disk direction is strictly above the terrain upper bound, with all possible terrain accounted for. Return [1, 1]. Missing terrain without an upper envelope prevents this proof.
- **PARTIAL:** positive disk area is proven visible and positive area is proven blocked. Return the area bounds, not a fabricated exact fraction.
- **UNKNOWN:** the evidence cannot establish one of the above. Keep any useful fraction bounds and reason; do not collapse them into a scalar fraction.

The current straight-edge uniform-disk formula remains a separately labeled approximation. It is not the proof mechanism for a varying horizon, and evaluating it at the nearest bearing does not establish a disk classification.

For a bounded fraction calculation, subdivide a normalized projected disk into tiles. Let the center unit vector be c and tangent basis vectors be u,v. For normalized image coordinates x,y within the unit disk and angular radius rho, evaluate direction

`d = c*sqrt(1 - sin(rho)^2*(x*x+y*y)) + sin(rho)*(x*u+y*v)`.

This defines the uniform projected-area disk without substituting a flat elevation edge. Enclose all directions of a tile, then classify only tiles proven entirely visible or blocked. Tiles straddling the disk edge contribute only conservatively enclosed intersection areas; unclassified/boundary area remains uncertain. Divide by the exact normalized disk area pi:

`fraction_lower = proven_visible_area / pi`

`fraction_upper = 1 - proven_blocked_area / pi`.

The implementation may stop at width <= 0.01 of disk area or an explicit work budget, whichever occurs first. The tolerance is a requested numerical target, not achieved accuracy. Always report actual width and termination. Keep the scalar `visible_fraction` empty unless the bounds collapse to 0 or 1; a later interface may display a labeled interval.

## Bounded implementation sequence

1. Implement and check one-site projected-cell footprint enclosures, including the observer cell, cap edges, longitude wrap, and the exact pole. Return witness/coverage metadata and lower/upper sector bounds. Do not replace unknowns with point interpolation.
2. Wire whole-disk BLOCKED/FULL sufficient conditions first. Keep UNKNOWN when conditions fail; do not target an expected count of determinate samples. Add bounded projected-area subdivision only after the sector enclosures are supported.
3. Preserve the existing left-held time interpretation and 168-hour accounting. Record sample-time classifications as sampled estimates; intervals do not certify the state between timestamps. Summaries must preserve fraction bounds/unknown duration and never report unknown time as visible time.
4. Run the same sample-a seven-day offline diagnostic once. Report execution cost, supported classifications, remaining unknown reasons, fraction widths where available, and evidence identifiers. Do not run a grid search or add a test suite, API/UI, or new assets.

Review the enclosure geometry before claiming conservatism. Focused checks should cover enclosure containment and monotonicity under additional unknown terrain, not merely compare one sampled grid to another. A runtime limit ends with UNKNOWN and a reported budget termination, never a relaxed proof criterion.

## Acceptance and remaining product dependency

This method checkpoint is complete when the contracts, assumptions, proof obligations, and source gap are explicit. Implementation acceptance requires demonstrable enclosures and evidence for every determined classification; counts alone are not acceptance.

Batch 02/L03 remains incomplete until the application can supply useful visible-disk fractions and operating estimates for supported inputs. The seven-asset obstruction pass can be useful progress but must not be advertised as completing that requirement. A global terrain upper envelope and supported physical-uncertainty policy remain dependencies for broadly useful clear-sky results.
