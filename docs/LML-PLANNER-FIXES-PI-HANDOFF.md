# Pi handoff — cancellation and submission errors only

Owner supplied [Pi's findings](LML-PLANNER-CANCEL-CODEX-HANDOFF.md). Source now
addresses those two defects. Codex has not run application code/tests. No
numerical refinement or feature expansion is part of this batch.

## Changes to verify

- Worker entry explicitly installs SIGINT/SIGTERM handlers before calculation
  imports. This handles background shells inheriting SIGINT as ignored. Cancel
  sends SIGTERM, unwinds calculation lock context managers, and reaps the child.
  A child already exited is allowed to finish publishing its job outcome rather
  than reporting a cancellation that could not be performed.
- The form explicitly checks browser validity and shows its message in the
  page, rather than relying on a native browser popup preventing submit events.
  API rejections show the exact server message in the calculation status region
  and alert; the previous success title is replaced.

## 1. Restart the idle app

The old server is still running old Python code; a browser refresh alone cannot
load the worker fix. Confirm there is no active job, stop that server with
Ctrl+C in its existing terminal, then start from the repository root:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python -m lunar_lab.planner_server
```

Do not delete live locks, force-kill unrelated processes or start competing
servers. Leave the new app running at http://127.0.0.1:8765 for the owner.

## 2. Small signal regression

In another terminal:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_planner_cancellation.py
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_planner_requests.py
```

The signal check uses only a temporary child and a temporary lock, no NASA
calculation. It reproduces inherited ignored SIGINT and requires both supported
cancellation signals to exit 130 and release the lock within five seconds.

## 3. Real cancel, once

Submit a fresh, unique site name with the usual one-day transition inputs.
Do not reuse `my-site-cancel`: it already has a completed cache result. Confirm
the new child command uses `lunar_lab.planner_worker` and wait until the child
has started its calculation/created `.environment.lock`. Cancel once in the UI.

Require `cancelled` within ten seconds, child exit/reap, both pipeline locks
released, no new completed result for this fresh site, and no new `/api/saved`
entry. A partial unindexed run folder is expected. Do not delete it. Return
job ID, child PID/exit, elapsed cancel time and log tail. If it keeps computing,
return that failure rather than waiting through another full calculation.

## 4. Submission errors

After an existing saved result has been opened or a prior success is displayed:

1. Enter latitude 0 and submit. A visible alert and calculation-status message
   must appear; the old success title must disappear. Keyboard focus should
   move to the invalid field. This may be caught locally without a network call.
2. Submit a browser-valid interval extending beyond kernel coverage: start
   2028-12-31T21:00Z, duration 2 days. The actual HTTP 422 message
   `The full interval must fit within 2026–2028.` must be visible in the status
   region/alert and accessibility tree.
3. Check an actual busy HTTP 409 rejection also surfaces its server message;
   use a second tab if needed. Do not launch a second worker.

Restore the valid form defaults. Open a saved result and one CSV export as a
smoke check. Do not repeat the already-passed 200-second full calculation or
precision experiments in this correction batch.

## Return

Return source commit, focused-check outputs, real-cancel evidence, screenshots
or accessibility text of both validation paths, and any exact failure. Stop at
the first failure. Do not change source/limits, delete locks or commit generated
assets. One next action after passing: owner reviews the fixes for integration.
