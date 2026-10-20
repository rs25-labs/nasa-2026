# Lunar Mission Lab — Foundation Data/Model Contract

Batch 01. This documents generated source assumptions, not observed execution results.

## Selected terrain

PDS LOLA LDEM_85S_40M, product version V2.0, 7584 × 7584 samples.
Official label:
https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/polar/img/ldem_85s_40m.lbl

The selected label was read during code generation. It specifies a south-polar spherical stereographic shape map in planetocentric coordinates, east-positive longitude, and the mean-Earth/polar-axis realization of DE421. Inputs/outputs retain that convention.

- Little-endian signed 16-bit binary samples; expected image size 115,034,112 bytes.
- Reference sphere radius 1,737,400 m.
- Elevation above that sphere = DN × 0.5 m.
- Planetary radius = 1,737,400 + DN × 0.5 m.
- This radius is not a geoid elevation or an Earth-style ellipsoid height.
- Pixel spacing 40 m at the pole; true surface sampling/accuracy differs from a universal 40 m accuracy claim.
- PDS line/sample projection offsets are interpreted as zero-based pixel-center offsets after removing the one-based convention.
- Inverse relation for zero-based grid indexes: col = sample_offset + x/scale; row = line_offset − y/scale.
- Nearest-pixel elevation is reported with its sampled center and projected offset. Requested latitude/longitude remains the observer's radial direction.
- Preview masks to the nominal south-of-85° cap and excludes signed-integer endpoints and samples outside label-derived DN bounds. No shot-count or cell-uncertainty layer has been supplied; do not equate this mask with measured terrain reliability.
- Preview uses decimation for visualization. Site samples use the full-resolution grid.

Reader support is intentionally restricted to this product family/convention. A changed label produces a failure, not a guessed transform.

## Matching ephemerides

Source manifest: data/manifests/clps/foundation-sources.json.

Load the planetary ephemeris de421.bsp with moon_pa_de421_1900-2050.bpc and moon_080317.tf. Use explicit MOON_ME_DE421, not the default IAU_MOON frame. Load naif0012.tls for time conversion and pck00011.tpc for body radii.

DE421 was chosen to match the terrain frame; it is not a claim that DE421 is the newest planetary ephemeris. NAIF's lunar frame documentation explains why mixing ME/PA/orientation realizations shifts surface coordinates.

The CLI reports SPK interval coverage for Sun, Earth, and Moon and binary-PCK coverage for frame class ID 31006. Successful sample calls also require the frame transform for each requested timestamp.

## Geometry

1. Construct the observer from requested radial direction and sampled terrain radius plus observer height.
2. Request geometric body vectors relative to Moon center in MOON_ME_DE421 at the same epoch.
3. Subtract the Moon-fixed observer vector in kilometers.
4. Project onto local east/north/radial-up to report azimuth and center elevation.
5. Report angular disk radius using each body's equatorial radius from the constants kernel.

There is no terrain-normal tilt, atmospheric refraction, terrain obstruction, light-time correction, finite-disk occlusion, or DSN station modeling in Batch 01. At the exact pole, input longitude establishes the tangent-axis convention.

The configured 2026–2028 interval is an application request bound. Successful sampled geometry/coverage reporting is not independent validation of future UTC leap-second assumptions. Review the pinned LSK before final operating-window work.

## Acquisition and reproducibility

Only the seven source-manifest assets are fetched. Downloads have per-file/total bounds, stream to temporary files, and are moved into place after byte/integrity checks. A work-directory lock prevents two preparations from writing the same cache concurrently.

de421.bsp has a published NAIF MD5 integrity value, included in configuration. Other sources use official HTTPS, byte checks and observed SHA-256 receipts. Those receipts detect later local changes but do not provide a pre-pinned authenticated upstream hash.

A fresh report records source-manifest hash, exact observed asset hashes/versions, Python/dependency versions, settings, wall time, process peak memory where available, and limitations. Record full pip freeze in the Pi review output before creating a runtime lock.

## Next calculation batch

After owner review: add wider terrain coverage and a bounded horizon calculation, then finite-disk obstruction/intervals. Do not use the 85° cap alone to silently assume no more distant obstruction. Training rules/engine and frontend are separate later handoffs.
