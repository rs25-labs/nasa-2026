# Pi handoff — seasonal calendar and matched mission periods

Run this batch only after the existing site-explorer UI QA session has finished
and returned its evidence. The long frozen archive collection may continue.
Do not stop either running Pi session to start this batch. If earlier UI QA
reported a genuine failure, return that first; do not layer this batch over it.

Source is isolated on `codex/lunar-seasonal-planner`, based on `aa32bd9`, at:
`/Users/msreedhar/Documents/Projects/NASA2026/data/local/lml/ui-workspaces/seasonal-planner`.
Do not switch branches or edit the main checkout or the frozen `214ba7e`
collector snapshot. No installs, numerical experiments, new solver jobs,
precision gates, archive edits or publication changes. Reuse the existing main
virtual environment without modifying it. Codex has not run this code/tests/app.
Stop at the first genuine failure; return exact evidence and one next action.

## 1. Focused fixture and derived view preparation

Run from the isolated worktree above. Explicit paths avoid using a nonexistent
worktree virtual environment or creating a second scientific asset cache.

```bash
PYTHONPATH=apps/clps/api/src /Users/msreedhar/Documents/Projects/NASA2026/.venv/bin/python apps/clps/scripts/check_planning_views.py --work-dir /Users/msreedhar/Documents/Projects/NASA2026/data/local/lml
```

Require exit zero. This fixture copies only four small pilot metadata/summary
files plus the publication/catalog config to a temporary directory. It checks
three available sites, exact pilot starts, partial months/years, missing-site
behavior, repeat preparation, and changed-view/CSV rejection. Real source hashes
must be unchanged. No workers or terrain/ephemeris loading.

Then prepare the real small views, and repeat once to confirm no rewrites:

```bash
PYTHONPATH=apps/clps/api/src /Users/msreedhar/Documents/Projects/NASA2026/.venv/bin/python apps/clps/scripts/build_site_planning_views.py --work-dir /Users/msreedhar/Documents/Projects/NASA2026/data/local/lml
```

Only expected output: a new ignored `planning-views/<published receipt SHA>/`
folder, three site JSON files and a manifest. Source is the deliberately pinned
pilot `247f8c653445187e99a8179dd95044b6c856cd5feb40c68767d9021386a30eec`,
Nov 19–21 2026 UTC, hourly at 2 m. Do not publish or read partial long-archive
results. Compare generated numeric metrics with seasonal.csv and
mission-windows.csv; values retain source precision. Repeat must preserve view
hashes and mtimes, not launch calculations. Leave any `.preparing` folder on
failure for inspection; do not manually promote it.

## 2. Idle app restart and API

Confirm earlier UI QA is finished and **all interactive app jobs are idle**.
Record `/api/saved` IDs and job count before restarting. Use the existing app
port 8765 sequentially; do not run two planner servers against the shared job
store. Stop only the exact idle main planner server (SIGTERM if needed).
Never signal the collector, frozen worker, or its verification process.

Launch from this worktree:

```bash
PYTHONPATH=apps/clps/api/src /Users/msreedhar/Documents/Projects/NASA2026/.venv/bin/python -m lunar_lab.planner_server --work-dir /Users/msreedhar/Documents/Projects/NASA2026/data/local/lml --port 8765
```

Confirm server options against `--help` if needed. Open/reload
http://127.0.0.1:8765/#planner.

- GET `/api/site-planning?site=pub-cr01`: available, six seasonal rows and four
  window body rows (two one-day starts). Same for `pub-mmo01`, `exp-cr-xp`.
- `pub-cr02`: available false, empty seasonal/windows; no nearby substitution.
- Unknown site, missing site, duplicate site query or extra parameter: 422.
- Invalid/missing views are exercised in temporary fixture only; do not rename
  or tamper with any real archives/views for browser tests.
- No scanning running collections, no archive chunks in `/api/saved`, no POST
  jobs from any new planning action.

## 3. Calendar and date finder — desktop and 390 px

- Calendar lists 50 sites, years 2026–2028 and all 12 months. Default ready
  site is Connecting Ridge CR01, November 2026. Only November has partial
  pilot coverage. Show exact Nov 19–21 dates and unknown hours, not a full-month
  or annual claim. Other months/years and 47 pending sites say no data, not 0%.
- Spot-check both November visible-disk ranges and unknown hours against the
  source month rows. Bars show lower/upper sampled estimates. Change the year,
  site and month quickly; no stale result should replace the final selection.
- One-day finder has exactly Nov 19 and Nov 20 starts, complete paired SUN/EARTH
  windows. 7/14/30-day choices show unavailable, not fabricated results. Months
  without data give an explanatory empty state.
- Rank by Sun lower mean, Earth lower mean, joint lower time and shortest known
  darkness. Compare ordering with source numeric values (before display
  rounding), ties by UTC date. Windows with Sun unknown time or null longest
  darkness remain unranked at the end in darkness mode. Do not interpret null
  as zero or rank unresolved lower bounds as a known short night.
- Each card shows exact dates, Sun/Earth mean bounds, joint lower/upper sampled
  hours, unknown hours and the longest-darkness basis. Joint visibility means
  positive visible area of both disks, not power or radio availability.
- Browsing/filtering/ranking does not alter draft inputs, displayed result or
  submit jobs. Keyboard selects/month buttons and focus outlines work. No
  horizontal page overflow at 390 px; comparison may scroll horizontally inside
  its container. Capture calendar/finder desktop and phone screenshots.

## 4. Same-date comparison and input use

- Compare the three ready sites on Nov 19, duration one day: exactly the same
  midnight UTC start/end, hourly cadence and 2 m height in every column. Compare
  all values to their source window rows. Do not compare different dates or
  choose each site's individually best day under one shared heading.
- Nov 20 works; Nov 21 or 2027, a pending site, or 7/14/30 days shows explicit
  unavailable columns. No stale values and no zero substitution. Duplicate
  site selectors show a clear instruction to choose distinct sites.
- Site-card Add to mission comparison fills an empty slot, prevents duplicates,
  and refuses a fourth site with a message. Finder Compare this date copies the
  exact UTC day to comparison. Existing slots remain unchanged.
- Open an existing saved interactive result, then Use these mission inputs from
  finder and comparison. Draft site/coordinates/date/days/height become the
  chosen archived period at 2 m, terrain centers on the site, and the form
  explains hourly preview versus its existing six-hour calculation cadence.
  No automatic calculation. Displayed title/date/sky/gold marker remain tied to
  the previously opened result, with changed-input notice where applicable.
- Comparison names, missing coverage, unknown durations and longest-obstruction
  basis are legible with keyboard and mobile navigation. No safety/winner,
  launch-window, power-output or radio-link claims.

Finish with an existing-result sky/time and CSV-export smoke check. Verify
saved IDs and job count unchanged, no new env-run folders, source archives
unchanged, no console errors/5xx. View preparation is the only new generated
artifact. Leave app idle, collector undisturbed. Return source commit, commands,
API counts, source spot-checks, desktop/phone screenshots and any failures.

One next action: Codex reviews this seasonal planning milestone for integration;
full archive publication remains a separate step after collection verification.
