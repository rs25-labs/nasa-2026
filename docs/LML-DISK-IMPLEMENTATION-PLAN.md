# Whole-disk obstruction implementation

2026-10-20. Owner authorized the next bounds step, push, and merge to remote main. Execute inline on the feature branch; preserve unrelated local files. No new assets, subagents, API/UI, area integrator, or generated test suite.

Goal: classify an entire apparent disk as BLOCKED when sector witnesses support that conclusion, retaining UNKNOWN otherwise. This is a sufficient-condition classifier, not a complete visibility solver.

Architecture: use the existing outward Decimal intervals to exclude sectors whose inward meridian half-spaces cannot intersect the spherical disk. Include every sector that cannot be excluded, including tangencies and 0/360 wrap. The disk's maximum elevation is at most min(90, center elevation + angular radius). All included sectors must have a model-matched witness lower bound strictly above this value. Missing sectors are inserted as unknown gaps; invalid or overlapping sector geometry fails closed. Zenith/nadir disks include all azimuths naturally. No supported upper terrain envelope exists, so FULL/PARTIAL remain disabled.

For unit disk-center direction c and angular radius rho, every disk direction d satisfies |d-c| <= 2 sin(rho/2). For a unit inward meridian-plane normal n, n·d <= n·c + 2 sin(rho/2). Only a strictly negative upper bound permits sector rejection. For a sector [a,b] of width <180 degrees, its inward normals in local east/north coordinates are (cos a,-sin a) and (-cos b,sin b). Reject if either half-space excludes the whole disk; otherwise require the sector's witness. This enclosure may include extra sectors, losing determinate results without creating false BLOCKED results.

The sector also lies in the forward hemisphere with normal (sin m,cos m), m=(a+b)/2. Apply the same exclusion to this half-space. It safely eliminates opposite-bearing false positives that the separate endpoint tests cannot exclude when sectors are narrower than the disk.

- [x] Add `apps/clps/api/src/lunar_lab/disk_bounds.py`: partition validation/gap insertion, interval sector exclusion, all-disk BLOCKED sufficient condition, witness evidence and fraction bounds [0,0] or [0,1]. Reject malformed/nonfinite inputs explicitly.
- [x] Update `environment.py`: use optional sector bounds for classification, preserve diagnostic horizon fields, add fraction bounds and duration-weighted all-time mean bounds without treating unknown time as visible. Keep existing interval semantics explicit.
- [x] Update `batch_environment.py`: pass sector bounds, update report/plot descriptions and record classification counts. Leave cell/sector evidence intact.
- [x] Check wrap, tangency, missing-sector coverage, zenith/nadir, strict threshold, unavailable upper bounds, nonfinite values and duration weighting with focused inline checks. The first diagnostic exposed overinclusive opposite-bearing sectors; after adding the valid midpoint-hemisphere exclusion, a corrected diagnostic and artifact replay passed. No suite generated.
- [x] Update execution handoff and design status. Final delivery: commit/push, integrate current main, verify unchanged source tree, and merge through a pull request without bypassing branch rules. Preserve unrelated local files and generated data outside Git.

Observed reference run: `data/local/lml/env-runs/20261020T190747Z-d1d0ed49/`, exit 0, 25.62 seconds, eleven artifacts, seven cached assets reused. Sun: 29 BLOCKED samples. Earth: 29 UNKNOWN samples. The initial conservative run `20261020T190604Z-078db67a/` is superseded. Replaying all 58 classifications with the final source reproduced the recorded states and sector IDs. Independent disk-boundary sampling was a sanity check on footprint inclusion, not the enclosure proof.
