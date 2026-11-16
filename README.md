# Lunar Mission Lab

An entry for the NASA Space Apps Challenge 2026, challenge "Lunar Landing Site Navigator".

Lunar Mission Lab helps a mission planner choose where and when to land near the Moon's south pole, and what a crew
would need once there.

Live app: https://lunarlab.rs25labs.com (press **Demo Walkthrough** on the start page for a guided tour)

Slide deck: [docs/deck/lunar-mission-lab-deck.pdf](docs/deck/lunar-mission-lab-deck.pdf)

## What it does

- **Plan.** Compare up to eight landing sites for a landing date and stay. For each site the app shows the share of
  the stay in sunlight, the longest dark spell, when Earth is in view, and the lowest battery charge. A year strip
  shows sunlight and Earth visibility for every day, and the app recommends the best site and the best landing date.
- **Expedition.** The selected site in 3D, built from the same elevation data and lit from the Sun's true position.
  Plan a rover drive and follow battery, sunlight, Earth link, slope and route progress on screen.
- **Outpost plan.** Enter a crew size and stay length. The app sizes the solar array and battery each site would need
  and flags darkness, gaps in Earth contact, time available for outside work and the effect of a landing slip.
- **Real Landings.** Past landings (the six Apollo landings, Chandrayaan-3, SLIM, IM-1, IM-2, Blue Ghost 1) shown on
  their real dates.
- **Export.** One PDF report with the landing plan and the outpost plan, plus CSV, JSON and a share link.

## How it works

For each site and each hour of the stay, the server traces the terrain skyline around the site and tests how much of
the Sun's disc and the Earth's disc clears it.

- **Terrain:** NASA LRO LOLA elevation models. 10 m near the site and 40 m out to 150 km for sites south of 85°S, and
  the global 16 pixels-per-degree model elsewhere.
- **Sun and Earth positions:** JPL NAIF SPICE kernels (DE421 ephemeris and the lunar orientation model), corrected
  for light time.
- **Skyline:** sampled every 2° of azimuth. The Moon has no atmosphere, so there is no refraction.

Every value is an estimate. The app lists its assumptions under "Data and methods" in the Export menu, and the PDF
report repeats them.

## Repository layout

| Path | Contents |
|---|---|
| `apps/clps/api` | Python server: estimates, terrain, routes and the PDF report |
| `apps/clps/studio` | Web app: TypeScript, Svelte and three.js |
| `data/manifests/clps` | Site lists and data source manifests |
| `deploy/vercel` | Script and checksums for downloading the terrain and ephemeris files |
| `Dockerfile.vercel`, `vercel.json` | Container build used for hosting |
| `docs/deck` | Slide deck and its source |

## Run it locally

Requirements: Python 3.11 to 3.13, Node.js 22 and pnpm.

1. Download the terrain and ephemeris files (about 2.5 GB, checked against pinned sizes and SHA-256):

   ```bash
   python deploy/vercel/fetch_assets.py data/local/lml/assets deploy/vercel/asset-receipts.json deploy/vercel/extra-assets.json
   ```

2. Install the server:

   ```bash
   python -m venv .venv && .venv/bin/pip install ./apps/clps/api
   ```

3. Build the web app:

   ```bash
   cd apps/clps/studio && pnpm install && pnpm build && cd ../../..
   ```

4. Start the server and open http://127.0.0.1:8765:

   ```bash
   PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
   ```

## Hosting

`Dockerfile.vercel` builds one container with the server, the built app and the data files. The data is downloaded
during the build. The 10 m terrain is stored as six pieces because the host limits the size of an image layer.

## Data and sources

- LRO LOLA polar and global elevation models, NASA PDS Geosciences Node:
  https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/
- JPL NAIF SPICE generic kernels: https://naif.jpl.nasa.gov/pub/naif/generic_kernels/
- Candidate south-pole sites: Wueller et al. (2026), https://doi.org/10.1029/2025JE009434
- Upcoming CLPS landing regions: https://science.nasa.gov/lunar-discovery/deliveries, with region centres from the
  USGS Gazetteer of Planetary Nomenclature, https://planetarynames.wr.usgs.gov/
- Landing site coordinates: NASA NSSDC, https://nssdc.gsfc.nasa.gov/planetary/lunar/lunar_artifact_impacts.html
- Moon image on the start page: NASA Scientific Visualization Studio, https://svs.gsfc.nasa.gov/4720/
- Earth map used for the rendered Earth: NASA 3D Resources, https://github.com/nasa/NASA-3D-Resources

Per-file notes are in `apps/clps/studio/public/moon/SOURCES.md` and `apps/clps/studio/public/sky/SOURCES.md`.

## Built with

Python (SpiceyPy, NumPy, pyproj, Matplotlib), TypeScript, Svelte, Vite, Tailwind CSS and three.js.

## Licence

The code is released under the MIT licence; see [LICENSE](LICENSE). The NASA, JPL and USGS data and images keep
their own terms, listed under "Data and sources".

## Use of AI

AI coding agents were used to develop this project, under the author's direction. No result shown by the app is
produced by a language model: every number is calculated from the NASA and JPL data listed above.
