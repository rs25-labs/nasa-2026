# Composite raster solids and whole-disk clearance

2026-10-20. Implemented checkpoint following the owner-approved
[source assessment](LML-WIDER-TERRAIN-ASSESSMENT.md). Model ID:
`lml-composite-cell-solid-v1`. This extends conditional raster-model
visibility; it does not establish a physical terrain-height envelope.

Follow-on implementation: [Finite-Disk Visibility Milestone](LML-VISIBILITY-MILESTONE.md)
adds latitude-band exterior bounds and projected-area subdivision, including a
verified real PARTIAL result. The surface/model contract here is unchanged;
the later milestone owns current algorithm, precision and execution status.

## Surface and sources

Within the nominal south-of-85° cap, retain `lml-polar-cell-solid-v1`:
constant radius over each projected square, clipped to the cap, with solid
interior. Outside the cap, use LDEM_16 V3.1 constant-radius solids over
closed 1/16-degree latitude/longitude pixels, clipped to that exterior.
The common cap edge belongs to the union. Include both longitude-seam
sides and pole closures. Invalid samples and any uncovered polar-cap
slivers outside the raster rectangle are unknown. The observer keeps its
requested radial direction and existing sampled radius plus height.

Both sources use DE421 mean Earth/polar axis, east-positive longitude,
and radius `1,737,400 + DN*0.5` meters. The global reader strictly validates
the selected label, dimensions, pixel registration and encoding, then
checks every sample in row chunks. If any global sample is invalid, the
global envelope is unavailable. This conservative policy also refuses the
envelope for invalid global pixels that would be hidden by the polar cap.

The separate `composite-global-sources.json` profile requires exactly two
global asset IDs. Foundation acquisition still requires exactly seven.
The supplement has its own 40-MiB default download budget (64-MiB maximum
CLI budget), image expected length 33,177,600 bytes and label cap 65,536
bytes. Shared receipts and ordered environment/foundation locks are reused.
Official HTTPS, byte validation and observed SHA-256 receipts establish
provenance, without a pre-pinned authenticated upstream hash.

The acquired global raster has zero invalid samples, observed DN extrema
−17,963 and 21,371, and model maximum radius **1,748,085.5 m**. This differs
from the label's listed extrema; the envelope uses the validated image's
actual maximum. It bounds global raster solids, not physical relief or
the separate high-resolution polar surface.

## Sufficient clearance proof

Let the disk's reported center elevation be `e`, angular radius `rho`, and
let `theta` be an outward lower bound on `e-rho`. A FULL result requires
every possible obstruction in the disk's azimuth footprint to lie strictly
below `theta`. A disk reaching nadir remains unresolved in this method.

For surface direction `n`, radial up `u`, radius `r`, and observer radius
`ro`, define `C=n·u`, `z=r*C-ro`, and `h=r*sqrt(1-C²)`. For
`−90° < theta < 90°`,

`z*cos(theta) - h*sin(theta) < 0`

proves the apparent elevation below `theta`. Elevation increases with
radius at a fixed nonzero central separation, so a tile's maximum valid
radius encloses its solids' possible elevations. The coincident direction
is resolved only when the strict comparison succeeds; contact cannot
become a clearance claim. Equivalently, the comparison is affine in radius
at fixed direction and negative at zero radius, so a successful outer-radius
comparison also covers the full solid interior.

**Global exterior:** for a polar observer, omitted terrain starts at central
separation at least `delta0 = cap_latitude - observer_latitude`. With the
validated global raster maximum radius `rg`, the comparison becomes

`rg*cos(delta+theta) - ro*cos(theta) < 0`, for `delta ∈ [delta0,180°]`.

Its maximum comes from an endpoint or the cosine stationary maximum at
zero inside the argument interval. The implementation encloses all these
candidates with Decimal interval arithmetic. Failure to prove this
inequality leaves UNKNOWN, even if nearby polar terrain alone would be
clear. This scalar envelope is deliberately loose; it has no physical
uncertainty interpretation.

**Polar terrain:** a midpoint-split quadtree partitions a padded rectangle
whose coverage of the entire nominal cap is verified. Each node is handled
by one of three sufficient criteria:

1. Its entire projected rectangle is strictly outside the cap.
2. Its enclosing spherical cap is strictly outside a proved superset of
   the disk's azimuth footprint.
3. All its raster samples are valid, and its maximum radius and enclosing
   spherical cap prove it strictly below the disk minimum elevation.

The enclosing cap is the exact inverse stereographic image of a
circumscribed projected circle, using the previously audited axis convention.
The disk wedge is used only if its inward-normal dot product is positive
over the complete disk, using `|d-c| <= 2*sin(rho/2)`; otherwise all azimuths
are included. A tile can be excluded only when a cap dot-product enclosure
is strictly negative for a wedge half-space. There is no floating-point
candidate exclusion or sampled-corner completeness claim.

Unresolved nodes split until a sufficient criterion succeeds or a pixel,
invalid coverage or work limit is reached. The fixed limits are 4,096 node
visits per sample and 16,384 cached nodes per site. Limits never relax a
comparison. A FULL transcript's successful terminal nodes partition the
root; the exterior proof accounts for the remainder of the Moon. This
does not compute a complete horizon for every azimuth.

All deciding geometry uses the existing 50-digit outward Decimal intervals
and Taylor trigonometric enclosures. Numerical enclosures are separate from
physical height error, which remains **unbounded**.

## Classification and evidence

The existing polar witness proof runs first. Its BLOCKED result remains
valid because the polar model is a subset of the composite model; adding
global solids cannot remove an obstruction. Record the old witness model
ID separately from the new visibility model ID. For other samples, optional
composite clearance may prove FULL. Remaining samples stay UNKNOWN.
Fractions are respectively [0,0]/0, [1,1]/1, or [0,1]/empty scalar.

Each attempted clearance has a proof ID, threshold, exterior comparison
margin, termination, node counts, terminal-node criteria and transcript
digest. `composite-terrain-nodes.csv` supplies node boxes, valid maxima and
cap/elevation intervals. `composite-clearance-proofs.json`, source receipts,
both manifest hashes, request and model metadata permit deterministic replay.
The model metadata's `wall_seconds` runs from model construction through
report collection and includes the intervening horizon/ephemeris stages;
use the top-level elapsed time for end-to-end cost.

## Verified result and remaining scope

Reference: `data/local/lml/env-runs/20261020T192833Z-2cd591e7/`.
Exit 0; 25.82 seconds; peak process memory 266.28 MiB; thirteen artifacts;
nine cached assets reused during the diagnostic. The two global assets were
acquired separately through the bounded downloader before this offline run.

Sun: 29 BLOCKED. Earth: 7 FULL and 22 UNKNOWN. All 29 clearance attempts
replay exactly; seven complete terminal partitions were checked, with
225–241 node visits per FULL sample and 249 cached nodes overall. All 22
unknown attempts terminate at the global exterior envelope comparison.
Under six-hour left-held sampling, Earth has 36 known visible hours and
132 unknown hours; both bodies account for 168 hours. These are sampled
estimates, not continuous-time certificates. Earth's full-duration mean
fraction remains bounded by approximately [0.214286,1], rather than claiming
its known-hours-only mean of 1 applies to the entire week.

Focused checks cover an analytic sphere, longitude wrap, zenith, strict
contact, missing terrain, a raised near-field cell, node/cache limits,
wrong-frame/manifest rejection, real global sample validation and injected
invalid data. Artifact checks verify all nine source hashes, fractions,
duration accounting, unchanged polar obstruction evidence and released locks.
The generated plot was inspected. No extensive test suite or subagents were
generated. Review reproduced and corrected a tiny-negative-longitude modulo
rounding defect in the standalone cell-index helper; its focused regression
check passes. That helper does not participate in the clearance proof, whose
reference transcripts replay unchanged after the correction.

L03 remains incomplete: no PARTIAL classification or projected disk-area
integration, no physical error envelope, and no between-sample temporal
proof. **Next action:** implement bounded projected disk-area subdivision
using the existing obstruction and composite-clearance sufficient conditions,
retaining uncertain area where either terrain proof is inconclusive.
