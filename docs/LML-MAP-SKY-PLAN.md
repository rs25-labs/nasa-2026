# Terrain map and synchronized sky/timeline

Owner approves the plain-English map/sky/time design. Codex supplies source
and handoff; Pi runs code and browser checks. No subagents or solver refinement.

Use the existing cached LOLA south-polar elevation raster. A bounded read-only
endpoint samples a 192×192 polar-stereographic viewport, preserves invalid and
out-of-cap pixels as missing, and reports source/display resolution. The browser
renders elevation and fixed illustrative relief shading. Source coordinates and
clicks use the same spherical projection as the terrain reader. Zoom stops at
40 m display spacing; no invented higher resolution. Drag/arrow keys pan, +/- zoom,
and form coordinates remain a keyboard selection path. A second marker shows
the site of the displayed calculation so changing draft inputs cannot relabel it.

The saved-result API also returns its existing diagnostic horizon profile.
One selected calculated UTC sample drives Sun/Earth positions, state/bounds,
timeline cursors and highlighted table rows. Slider, previous/next, explicit
Play, interval buttons and table time buttons use the same selection. No
interpolated calculation or inferred visibility from the drawn horizon. The
profile stays visibly labeled diagnostic, with unavailable data left as gaps.

No new sources, dependency installation, database, hosted map service or assets
in Git. The first request verifies cached terrain against receipts; reads are
bounded and memoized by file signatures. Missing terrain produces a visible
message rather than fabricated imagery. Existing jobs/cancel/errors/exports
remain intact. One Pi batch checks map coordinates/coverage/zoom and sample
synchronization, then one bounded new-site calculation; no precision target.

- [x] Supply focused projection/viewport checks for Pi.
- [x] Implement read-only terrain viewport/site endpoints and horizon response.
- [x] Add terrain map navigation/selection, provenance/resolution and two markers.
- [x] Add sky/time controls with discrete playback and linked intervals/table.
- [x] Document the [Pi batch](LML-MAP-SKY-PI-HANDOFF.md); execution/visual QA belongs to Pi/owner.
- [x] Pi verifies the running map/sky app and corrected worker startup.
- [ ] Owner reviews the finished Moon entry batch before combined integration.

Pi verified sections 1–3 on `2c3c30a`: real map/projection, desktop/phone,
exact saved-sample synchronization and discrete playback all passed. The first
fresh calculation crashed before exec (-11, empty log); macOS identifies PROJ's
fork-child cleanup. Pi's [subsequent evidence](LML-MAP-SKY-VERIFICATION.md)
reports both startup regressions, exact fresh-input retry, verifier, cache and
CSV checks passing on `47926e0` with in-progress Moon entry files preserved.
Do not repeat those calculations in the Moon visual batch. Finished Moon entry
verification remains pending before combined integration; no numerical
refinement is needed.
