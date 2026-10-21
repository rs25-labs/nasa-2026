# Pi handoff — map-loaded worker startup correction

Use `codex/lunar-map-sky` at the source commit supplied by Codex. Existing
`.venv`/cached assets only. No installations, downloads, precision experiments,
source edits or lock deletion. Codex has reviewed source and crash reports;
Codex has not executed application code/tests. Stop at the first genuine failure
and return exact output, job ID/log and expected versus actual behavior.

## Evidence and change

Pi verified the terrain map and synchronized saved-result exploration on
`2c3c30a6d1b1042fca828ebdce37abefd5df9ed3` (original handoff sections 1–3).
The fresh `map-site-1` job `8f52d0c20ab248d2967b51080dbf3a7d` failed in
0.0038 seconds with exit -11, an empty worker log and no run folder.

The matching macOS report `Python-2026-10-21-075109.ips` records process launch
at 07:51:08.674 and “crashed on child side of fork pre-exec.” Its stack is
`subprocess_fork_exec → fork → _pthread_atfork_child_handlers → PROJ
SQLiteHandleCache → sqlite3Close → _os_log_preferences_refresh`. A second
07:53:31 report has the same stack. This is a process-launch failure after
native map/projection initialization, before the solver executes.

On macOS the launcher now supplies the options needed for CPython 3.11's
`posix_spawn` path. Repository cwd and session creation happen inside the fresh
worker, after signal handlers are installed. Existing non-inheritable Python
descriptor defaults keep server sockets/log handles out of the worker except
its explicitly redirected stdout/stderr. Other platforms retain their existing
launch path. No calculation, terrain, cache or numerical budget change.

## 1. Focused startup/cancellation check

From the repository root:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_planner_spawn.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_planner_cancellation.py
```

Require both exit zero. The first loads the real terrain/projection from a
background thread, uses the production spawn helper, verifies a native
`posix_spawn` call on macOS, checks worker cwd/session, and sends SIGTERM to a
small lock-holding child. It writes temporary files only, with no environment
calculation. The second retains the inherited-ignored-SIGINT regression check.

## 2. Restart the idle server and retry the exact failed input

Confirm no active job, then stop only the existing idle planner server (SIGTERM
if SIGINT is ignored). Do not remove locks or stop other processes. Restart:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Reload http://127.0.0.1:8765. Load/pan the terrain and click a usable site
**before** submitting, so projection initialization occurs in the server first.
Then submit these exact form values:

- Site: `map-site-1`; latitude `-89.55`; longitude `0.1`; height `2` m.
- Start `2026-11-19T09:00Z`; one day.

Require prompt acknowledgement, responsive controls, and a completed saved
result matching the input coordinates/time. Record job/run IDs and duration.
Wider bounds/UNKNOWN are accepted. Check the result marker, sky and timeline
switch together and the changed-input notice clears.

Run once on that returned run folder:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<new-run-id>
```

Require exit zero. Repeat the same UI submission once; require cache hit and
record timing. Smoke-check one CSV export. Finish original map/sky handoff §5
(desktop/390 px, visible input error, keyboard focus, no unexpected console
errors); do not repeat the already-passed map/sample comparisons or add runs.

Return commit, focused-check/verifier output, job/run IDs, runtime/cache timing,
CSV status and screenshots. Leave the server running idle. On another startup
crash return the matching new macOS crash stack as well as the worker log.
One next action: Codex reviews the result for map/sky milestone integration.
