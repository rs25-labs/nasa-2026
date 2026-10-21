# Saved environment results — CSV/JSON

Implementation checkpoint: Pi reports all four handoff checks passed, with no
failures or source edits. The owner supplied that completion report and
authorized committing the milestone. No database, new dependency or service
is required.

Each completed calculation keeps its existing folder under
`data/local/lml/env-runs/<run-id>/`. Samples, intervals and summaries are CSVs:
`environment-timeseries.csv`, `environment-intervals.csv` and
`environment-summaries.csv`. Reports and numerical evidence remain JSON.
Generated data stays outside Git.

A new `result-record.json` records calculation identity and artifact checksums.
The small `data/local/lml/results-index.json` maps keys to result folders.
Matching requests reuse the original report and files before terrain/geometry
calculation. They print `cache_hit: true` and `lookup_wall_seconds`.

Identity includes normalized inputs (including the complete UTC start time),
manifest bytes, verified source asset checksums, all package Python source,
Python/platform and scientific dependency versions. Package changes
conservatively cause a miss. Download limits and offline flags do not change
calculation identity. Intact files, complete status and absence of a
`SUPERSEDED.txt` marker are required for reuse. Hashes detect file changes;
they do not certify scientific accuracy.

Readers do not acquire the writer lock or update results. A refresh uses the
existing environment writer lock; previous completed results remain readable.
Missing/corrupt index entries fall back to valid per-run records. Index rebuild
chooses the newest report timestamp for each key. Legacy folders without a
record remain available manually and are not automatically adopted.

## Normal use

From the repository root, with the existing environment and cached assets:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/prepare_environment.py --work-dir data/local/lml --global-sources data/manifests/clps/composite-global-sources.json --start 2026-11-19T09:00:00Z --days 1 --offline
```

Repeat that exact command to reuse a matching result. Add `--refresh` to
calculate again into a new folder while retaining previous folders. If code
or assets changed, a repeat is deliberately a fresh calculation.

To rebuild the index without calculating:

```bash
PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/prepare_environment.py --work-dir data/local/lml --rebuild-index
```

For a future caller that already knows a saved key, reading requires only the
standard library and saved run files, without terrain assets or scientific
dependencies:

```python
from lunar_lab.result_store import load_result

saved = load_result("data/local/lml", "<64-character cache key>")
if saved is not None:
    summaries = saved["summaries"]
    sample_csv = saved["tables"]["environment-timeseries.csv"]
```

This is pipeline storage; connecting saved results to the future interface is
separate work. UNKNOWN states, empty unresolved values, bounds and existing
model limitations remain in the saved outputs. Adaptive refinement's numerical
acceptance target is still open.

## Bounded Pi handoff

Use the current checkout and existing `.venv`; preserve unrelated files. No
dependency installation, data downloads or numerical parameter search is
needed. Stop at the first failure and return its exact command and error.

1. Run the small storage check:

   ```bash
   PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/check_result_store.py
   ```

2. Run the normal-use command above, then repeat it twice. Return console JSON
   and wall times. A matching repeat must name the same folder, create no new
   folder, and leave saved files/index modification times unchanged. Compare
   JSON summaries with `environment-summaries.csv`, including empty values.

3. Run index rebuild, then repeat the normal command once. It must still return
   the same completed result. Run that command once with `--refresh`; it must
   return `cache_hit: false` and a different folder with the same key. Repeat
   without refresh and confirm the newly completed folder is selected.

4. Verify the returned composite result's existing numerical evidence:

   ```bash
   PYTHONPATH=apps/clps/api/src .venv/bin/python apps/clps/scripts/verify_disk_area_artifacts.py data/local/lml/env-runs/<returned-run-id>
   ```

Return the check/verifier outputs, lookup timings, folder/key comparisons and
any error to the owner. Do not expand this batch into API/UI work or publish
generated assets.

Existing local evidence includes complete run
`20261021T035349Z-7f3e122a`, whose report records 25.14 seconds calculation
time and 266.52 MiB peak process memory. Earlier development measurements
recorded repeated lookup around 0.36–0.38 seconds. Those measurements are
historical observations, not final Pi acceptance or a performance guarantee.

Pi completion report supplied by the owner: all four checks passed; existing
source changes were preserved. Reported side effects were one new run folder
from refresh and an updated index. Detailed command outputs and final lookup
timings were not included in the supplied report; no additional performance
claim is made here.
