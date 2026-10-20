# Wider terrain: source gate and upper-envelope contract

2026-10-20. Bounded continuation after PR #3 (`529eff9`). This checkpoint
uses the owner's explicit fallback: if source evidence cannot support the
proposed upper bound, report the limitation and smallest concrete resolution.
No acquisition/model integration is delivered by this checkpoint. L03 and
Batch 02 remain incomplete.

## Verified candidate

**Select PDS LOLA LDEM_16 V3.1 as the candidate for a subsequent global
raster-model extension. Do not yet add it to the acquisition manifest.**

The official [label](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_16.lbl)
specifies:

| Property | Verified value |
| --- | --- |
| Frame | Mean Earth/polar axis of DE421 |
| Projection and longitude | Simple cylindrical; east-positive |
| Extent | Latitude −90 to +90°, longitude 0 to 360° |
| Grid | 2,880 rows × 5,760 columns; pixel registered; 16 pixels/degree |
| Encoding | Little-endian signed 16-bit integer |
| Radius equation | 1,737,400 + DN × 0.5 m |
| Listed extrema | DN −18,150 to 21,580 |

The [official directory](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/)
lists `ldem_16.img` at **33,177,600 bytes (31.640625 MiB)** and the label
at 5,121 bytes. The image size agrees with rows × columns × two bytes.
This is metadata verification, not downloaded-image or hash validation.

The frame and radial units match the existing terrain/kernel convention.
The projection does not match the current polar reader and needs a separate
reader. Never substitute the separate principal-axis `_PA` product.

The [projection catalog](https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/catalog/dsmap.cat)
defines pixel centers, area footprints and offset conventions. For this grid,
zero-based row `i`, column `j` have centers
`lat = 90 - (i+0.5)/16`, `lon = (j+0.5)/16`. A future reader must handle
the poles and longitude seam explicitly rather than rounding into an invalid
index. Spatial resolution varies with latitude; this is not a uniform
1.9-km spatial accuracy claim.

## Why acquisition does not resolve the envelope

The [PDS product description](https://ode.rsl.wustl.edu/mars/pagehelp/Content/Missions_Instruments/LRO/LOLA/GDR/GDRDEM.htm)
describes binned and interpolated altimetry, with pixels representing mean
values. A maximum over these means does not bound peaks between observations.
The label also warns of latitude-band edge artifacts and describes filling
incomplete coverage.

Consequently, **10,790 m**, computed from the label maximum, is a product
value, not a certified maximum elevation of the Moon. Nor does the encoding
range establish a physical lunar ceiling. No arbitrary padding or multiple
of an RMS error repairs that inference.

For comparison, [PGDA product 78](https://pgda.gsfc.nasa.gov/products/78)
provides local adjusted DEMs, RMS height-error maps and statistical clones.
Those characterize uncertainty but do not provide a deterministic envelope
over the entire Moon. [Product 90](https://pgda.gsfc.nasa.gov/products/90)
offers compatible DE421 south-polar terrain extending to 60°S, including a
240-m product advertised at 210M and an error layer at 255M. This remains
regional and exceeds the existing 160-MiB acquisition budget even for the
DEM alone; a larger download would not resolve the missing global contract.
The units on that page are advertised sizes, not verified byte counts.

These sources do not establish the required hard physical envelope. This is
a conclusion about the evidence examined in this bounded check, not a claim
that no suitable evidence could exist elsewhere.

## Contract options and decision

| Approach | What it can establish | Decision |
| --- | --- | --- |
| Infer a physical upper ceiling from a global raster maximum | No supported physical guarantee | Reject |
| Define a complete composite raster surface | Numerical visibility bounds conditional on that explicit surface | Smallest viable follow-up |
| Model physical uncertainty using regional error maps/clones | Statistical sensitivity at supported sites, after choosing a probability model | Separate larger method change |

The present classifier already reports model-conditional obstruction; this
assessment does **not** claim that physical certainty is a prerequisite for
all useful product output. A global composite model is a defensible way to
extend that convention. It must be defined explicitly before its maximum
can be used to make existing unknown exterior terrain disappear.

**One next action:** adopt the following composite-raster contract, then
implement it as one bounded model checkpoint:

- Keep `lml-polar-cell-solid-v1` within its nominal cap. Outside it, define
  constant-radius solids over LDEM_16 latitude/longitude pixel areas. Assign
  the shared cap edge to the union, and include seam/pole closures. Give the
  composite a new model ID; existing results keep their original meaning.
- Verify the acquired global label and every sample before deriving a
  raster-model maximum. Invalid cells remain unknown; a label extent is not
  proof that every sample is usable. Retain receipts and use a separately
  bounded download budget; do not relax the current exact-seven-assets
  validation implicitly.
- Derive the exterior radius bound from the validated global raster under
  this model. It bounds the modeled exterior only; it does not enclose the
  high-resolution polar raster or actual lunar relief. Account separately
  for every polar cell, including near field and invalid cells. Use a
  conservative hierarchy with outward arithmetic; work-budget exhaustion
  leaves the affected upper bound unavailable. Reuse a far-field maximum
  only with a proved lower separation and the curvature extrema specified
  in the existing bounds design.
- Enable a FULL label only when the whole disk is strictly above supported
  upper bounds for every possible contributor. Keep physical height error
  explicitly unbounded, numerical bounds separate, and unhandled coverage
  UNKNOWN. Do not imply continuous visibility between timestamps.

No new model ID, envelope constant, FULL classification, download or manifest
change is introduced here. The selected fallback preserves the existing
scientific contract while making the next implementation decision concrete.

## Execution evidence

One unchanged-source offline diagnostic ran from the branch based on merged
remote main, using the exact sample-a command supplied by the owner. No
subagents, dependencies, parameter search or generated test suite.

- Run: `data/local/lml/env-runs/20261020T191853Z-bf0f2958/`; exit 0;
  25.52 seconds; peak process memory 229.73 MiB; eleven artifacts.
- Seven cached assets reused; zero asset downloads. Source manifest SHA-256:
  `5c34a1dde230b045f97f56b04dbfaabfd066a3c250a6a9daa39c43a540614100`.
- 4,065 cell enclosures; 1,436/1,440 sectors have lower witnesses; zero
  supported upper bounds. Sun: 29 BLOCKED; Earth: 29 UNKNOWN.
- Both bodies account for 168 hours under six-hour left-held sampling.
  No FULL/PARTIAL or physical-envelope claim. Earth fractions remain [0,1].
- Focused artifact checks verify nonempty outputs, witness references,
  classification/fraction consistency, duration accounting, agreement with
  the prior reference's classifications and sectors, and released locks.
  These checks do not validate physical terrain accuracy.

This repeats the prior obstruction result, not a new visibility capability.
The prior reference remains valid; this run supplies current execution
evidence for the source-gate checkpoint. Assets and generated outputs stay
in ignored `data/local`.
