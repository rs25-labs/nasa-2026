# Moonrise and south-pole entry

The owner requests a Moon-dominated landing page, an Explore action revealing a
slowly rotating Moon with mission-site markers, then a south-pole zoom into site
selection. Continue under the owner's standing instruction to proceed without
intermediate approval. Codex writes source/docs; Pi prepares assets and runs
the app/checks. No subagents, app execution or tests by Codex.

Design: one full-height dark stage with a large textured lunar limb rising from
the lower edge. Copy: “Your next mission starts here.” and a brief explanation
of site/date, sunlight and Earth visibility. Explore reveals the whole globe,
rotates it, faces the south pole, then zooms and hands off to the actual LOLA
terrain picker centered on the current draft (40 km view). Users can skip
directly to the planner, pause motion, or select a saved site's coordinates.
Saved sites and the current draft supply the markers; do not invent landing
sites. Nearby markers overlap at globe scale; the accessible site list provides
individual selection. Gold means saved calculation location, mint means draft.

A small native WebGL sphere shader keeps the existing dependency-free frontend.
It uses NASA SVS's 2k CGI Moon Kit texture, explicitly illustrative (including
polar fill), never an input to terrain or illumination calculations. Pi caches
the image and provenance receipt under ignored data/local/lml/ui-assets. The
server serves that one local image; the browser makes no NASA requests. Missing
image/WebGL shows an honest untextured fallback and direct site-picking path.
A prerecorded animation would not support live markers; a 3D framework adds
installation/build overhead for a single sphere. Native rendering is the chosen
bounded implementation, with visual/runtime validation deferred to Pi.

Implementation:
- [x] Add separate entry HTML/CSS and globe/controller JS; maintain existing IDs.
- [x] Link draft/saved coordinates and site selection to the terrain picker.
- [x] Supply a bounded Pi asset-preparation script and fixed image endpoint.
- [x] Review source/whitespace; supply Pi handoff covering camera, markers,
      keyboard, reduced motion, fallback, mobile and existing planner behavior.
- [ ] Pi runs [visual checks](LML-MOON-ENTRY-PI-HANDOFF.md); owner reviews output.

Keep the worker startup correction and its pending Pi verification visible.
This batch adds no calculation runs or precision acceptance gates. Stop after
source delivery/Pi handoff for the next review milestone; do not merge unverified
visual behavior.
