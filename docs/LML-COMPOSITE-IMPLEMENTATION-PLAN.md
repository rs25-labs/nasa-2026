# Composite raster visibility implementation

2026-10-20. Owner approved the contract in LML-WIDER-TERRAIN-ASSESSMENT.md.
Execute inline on a scoped branch, without subagents or an extensive suite.

Goal: support model-conditional whole-disk FULL in addition to existing
BLOCKED, preserving UNKNOWN and the original seven-asset path.

Architecture: optional separately validated two-asset global manifest;
strict LDEM_16 reader; direct whole-disk clearance proof over a lazy polar
quadtree and the global exterior envelope. Use existing outward Decimal
intervals. No dependencies, API/UI, physical-error guarantee, partial-area
integration or continuous-time claims.

- [x] Add bounded focused checks before implementation: global convention
  rejection and sample validity, synthetic flat-surface FULL, missing-terrain
  UNKNOWN, work-cap UNKNOWN, strict contact, and bearing exclusion.
- [x] Factor acquisition with explicit manifest profiles: foundation still
  requires its exact seven IDs; global profile requires its exact two IDs.
  Add `composite-global-sources.json`, 33,177,600-byte image and bounded label.
  Integrate an optional `--global-sources` and separate 40-MiB budget under
  the existing ordered locks, with one receipts snapshot.
- [x] Add `global_terrain.py` validating LDEM_16 V3.1 conventions and full
  samples in bounded row chunks. Record observed max only if the exterior
  is fully valid; preserve uncertainty. Zero-based centers follow the PDS
  projection catalog; poles/seam have explicit closed footprints.
- [x] Add `composite_bounds.py`. New model `lml-composite-cell-solid-v1`
  preserves polar solids within the cap and global latitude/longitude solids
  outside, including both at the seam. Prove the global exterior below the
  disk using its validated maximum and a lower central separation. Compare
  `r*cos(delta)-ro` against horizontal distance with interval trigonometry;
  monotonicity in radius permits an outer-surface bound for the full solid.
  Above-horizon disks permit a negative-z far-field shortcut. Otherwise use
  a general interval elevation comparison, retaining UNKNOWN if too loose.
- [x] Traverse a rectangle enclosing the full nominal polar cap, including
  any portions outside the raster as unknown. Circumscribed projected
  circles map to exact spherical-cap enclosures. Closed rectangle/cap tests
  and inward meridian half-spaces may exclude nodes; valid radius maxima
  may prove them below the disk minimum elevation. Subdivide other nodes;
  unresolved leaves, invalid pixels and node/cache budgets fail closed.
  Cache nodes per site and record terminal coverage evidence and traversal
  digest per sample for replay. Do not use floating-point screening to
  certify clearance.
- [x] Integrate optional clearance in environment output after the existing
  obstruction proof. Keep prior lower witnesses valid as subsets of the new
  model. Record both evidence model IDs, threshold, source hashes, budgets,
  counts and termination. Scalar fractions only 0 or 1; UNKNOWN stays [0,1].
- [x] Run focused checks, acquire the two assets through the bounded path,
  and run one seven-day sample-a diagnostic. Inspect receipts, proofs,
  durations, source/model identity, artifacts and locks. Update handoff with
  actual findings. Review inline, commit/push and merge through a PR.

Proof review: the lowest disk elevation is bounded by center minus angular
radius. A wedge is used only if inward-normal dot products with every disk
direction are strictly positive, using the chord enclosure. A polar tile
outside that wedge cannot obstruct the disk. Every other tile must be below
that elevation or subdivided. The quadtree partitions a rectangle covering
the cap; shared edges and clipping use supersets. Its successful terminal
nodes plus geometric exclusions cover all polar terrain, independently of
the sampled diagnostic search radius. The far-field envelope covers the
entire exterior separately. No terrain proof is inferred from point rays.
