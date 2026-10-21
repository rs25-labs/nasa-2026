# Pi handoff — moonrise → orbit → south-pole site selection

Branch `codex/lunar-map-sky`, source commit supplied by Codex. Codex wrote and
reviewed source; no app/test execution or browser rendering of this app by
Codex. The Space Apps reference was inspected in the browser. This batch adds
no solver work, dependencies or new calculation runs. Preserve unrelated files.
Stop at the first genuine failure; report one concrete next action.

## 1. One visual asset and restart

Use the existing `.venv` and cached scientific assets. The owner requests an
illustrative textured Moon. Only this bounded NASA image download is needed:

```bash
.venv/bin/python apps/clps/scripts/prepare_moon_texture.py
```

Require exit zero and the cached image + SHA receipt under ignored
`data/local/lml/ui-assets/`. Source: [NASA SVS CGI Moon Kit](https://svs.gsfc.nasa.gov/4720/),
2k JPEG (~447 KB). The browser uses a local endpoint, not NASA/CORS/CDN access.
The image is illustrative and is not scientific terrain, calculated sunlight,
or a new input to any calculation.

Restart only the idle planner server to load new static routes. Preserve live
jobs/locks; if the exact idle server ignores SIGINT, use SIGTERM as before.

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Open http://127.0.0.1:8765 with no hash; reload styles/scripts.

## 2. Visual journey (desktop and 390 px phone)

- Initial screen: a large recognizably textured Moon rising from the lower
  edge, occupying most of the scene, legible intro, Explore and direct planner
  link. No calculation form before entering planning. NASA credit visible.
- Explore: Moon pulls back into a whole globe, rotates slowly, shows mint draft
  and gold saved-site markers, turns south-pole face-on, zooms, then reveals the
  real LOLA map. Roughly 8.3 seconds total. No event is claimed to be a physically
  timed orbit or illumination simulation. Confirm north/south and visible lunar
  near-side features are not vertically flipped; longitude zero is near-side
  center when facing the equator at zero longitude.
- Markers must correspond to current form/saved coordinates. `globe-pin` spans
  expose latitude/longitude data; near-identical sites may overlap at globe
  scale, with individual coordinates in the site list. Do not invent sites if
  saved data is empty or fails to load. The draft marker remains available.
- On arrival, map centers on the draft at 40 km width or closer (prior zoom
  may be retained). Click a terrain point: form coordinates/elevation update as
  before. The entry motion must not submit any calculation.
- Go back to Moon. Pause/Resume freezes/continues the journey. Tab into the site
  list: journey pauses so it cannot hide a focused choice. Choose a saved site:
  site name/coordinates become draft inputs, picker centers there, date/height
  stay as entered; displayed old results keep their own site and change notice.
- Skip/Choose a site now/direct planner nav works immediately; `#planner`
  opens the planner directly. Home and browser Back allow re-entry without
  resetting draft inputs or disconnecting jobs. Repeat Explore/skip twice;
  require no accumulating animations, flash of hidden content or console errors.
- Check both widths for clipping, readable copy/site list, usable links/buttons,
  visible keyboard focus and no horizontal overflow. Capture initial moonrise,
  paused orbit with markers, and final terrain picker at both widths.

## 3. Motion and failure paths

- With OS/browser reduced motion enabled: hero static; Explore goes straight to
  picker, no camera flight. Controls remain usable. Restore preference afterward.
- Hide tab mid-flight, return: no elapsed-time jump. Pause then resize: globe
  resizes but does not resume. Toggling reduced motion mid-flight enters picker.
- Browser-block `/media/moon-color.jpg` (do not delete assets), reload: honest
  untextured-preview message, usable Explore/skip; remove block afterward.
- If browser allows disabling WebGL, check graceful untextured hero fallback
  and immediate planner access. Report unavailable emulation rather than adding
  packages or changing system/browser security settings.

## 4. Existing planner smoke and outstanding startup verification

Open an existing result and use one time/sky control. Existing map selection,
saved result, CSV export and visible form error still work. No recalculation for
this visual batch; no new numerical tests or width gate.

The preceding macOS worker fix at `47926e0` remains unverified. If it has not
already passed, run the separate [startup/retry handoff](LML-MAP-SPAWN-PI-HANDOFF.md)
on this same commit after these visual checks. Its one exact fresh calculation
is the outstanding check, not an additional numerical research batch. Do not
claim the combined app milestone ready to merge until that evidence is returned.

Return source commit, asset receipt hash, screenshots, interaction/accessibility
findings, browser errors (if any), and startup handoff status. Leave server idle.
One next action: Codex reviews the evidence for the next app milestone.
