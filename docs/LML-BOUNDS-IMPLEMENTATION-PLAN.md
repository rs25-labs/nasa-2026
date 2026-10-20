# One-site terrain enclosure implementation

2026-10-20. Execute inline; no subagents or generated test suite. This is step 1 of LML-HORIZON-BOUNDS-DESIGN.md, authorized by the owner. The existing feature branch and checkout are retained.

Goal: produce auditable cell enclosures and sector lower bounds from existing assets without claiming a complete horizon or implementing disk-area integration.

Architecture: use exact stereographic circle-to-spherical-cap algebra. A circle inscribed in a pixel supplies a subset of terrain for obstruction witnesses; a circumscribed circle encloses the full pixel. Decimal interval arithmetic encloses rounding; sine/cosine use a finite Taylor series plus an explicit remainder. Candidate selection may miss useful witnesses but cannot certify clear sky. Unvisited terrain remains unknown.

- [x] Add `apps/clps/api/src/lunar_lab/bounded_math.py`: outward interval operations and angle enclosures using standard-library Decimal; no new dependencies.
- [x] Add `apps/clps/api/src/lunar_lab/terrain_bounds.py`: inner/outer caps, nominal-cap containment, observer-relative elevation enclosure, and whole-sector witness checks. Include the observer cell; use diagnostic maxima and adjacent cells as a bounded candidate set, not exhaustive coverage.
- [x] Extend `batch_environment.py` to write cell/sector evidence and report its scope; existing visibility stays UNKNOWN until the separate disk-classification step is implemented.
- [x] Run focused enclosure/sector checks and the seven-day offline diagnostic. Inspect evidence, duration accounting, artifacts and lock release. No test framework or suite added. A discovered axis-convention defect justified one corrected rerun; see handoff for superseded output.
- [x] Update handoff with observed results. Commit and push this bounded step as the final delivery action. Next step is whole-disk classification using these sector bounds, not API/UI.

Construction: for projected circle center (x,y), radius a, reference radius R, set q=x²+y²-a², v=(4Ry,4Rx,q-4R²), k=4R²+q. Projected x follows lunar +Y and projected y follows lunar +X for this south-polar lon_0=0 convention. Its inverse stereographic image is the spherical cap v·n >= k. The inner radius is half a pixel; the outer radius is sqrt(2) times half a pixel. For a sector tangent t, A=v·up and B=v·t; A>0, B>0 and A²+B²>k² establish a forward ground-track intersection with the inner cap. With width<180 degrees and positive endpoint B values, B is positive and concave throughout the sector; its minimum is at an endpoint. Bound elevations over the entire inner cap using enclosed extrema of n·up. This deliberately sacrifices tightness for safety. Inscribed-cap subsets cannot establish upper horizon bounds.
