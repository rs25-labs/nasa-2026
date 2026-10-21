# Pi handoff — moonrise → orbit → south-pole site selection

Branch `codex/lunar-map-sky`, source commit supplied by Codex. Codex wrote and
reviewed source; no app/test execution or browser rendering of this app by
Codex. The Space Apps reference was inspected in the browser. This batch adds
no solver work, dependencies or new calculation runs. Preserve unrelated files.
Stop at the first genuine failure; report one concrete next action.

The owner has now supplied [passing map/worker evidence](LML-MAP-SKY-VERIFICATION.md)
from the preceding batch. Do not repeat the spawn/cancellation scripts, fresh
calculation, verifier or cache submission. That report included in-progress
Moon files; it does not verify the finished Moon entry. Restart/reload from
this handoff's current commit for the visual checks below.

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

## 4. Existing planner smoke using the verified saved result

Use the existing `map-site-1` result, run `20261021T150826Z-c4a22710`:
open it and use one time/sky control. Existing map selection, saved result,
CSV export and visible form error still work. Check that opening this result
does not change the draft's globe marker; choosing a saved site's coordinates
changes the draft only, with the displayed result retaining its own identity.
No recalculation for this visual batch; no new numerical tests or width gate.

Record the saved-entry count before and after (six in the preceding report;
use the actual current count). Explore/skip/site choice must not POST a new
job or create a saved result. Leave partial unindexed folders untouched.
The startup fix already passed: 24.55 s fresh calculation, verifier exit zero,
0.37 s cache hit and CSV HTTP 200. No startup rerun is requested here.

Return source commit, asset receipt hash, screenshots, interaction/accessibility
findings, browser errors (if any), saved counts and confirmation that navigation
did not submit calculations. Leave server idle with valid form inputs.
One next action: Codex reviews the evidence for the next app milestone.
