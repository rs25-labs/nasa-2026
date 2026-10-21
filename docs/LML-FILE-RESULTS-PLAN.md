# Simple saved-result lookup

2026-10-20. Owner chooses CSV/JSON storage, avoiding database implementation.
Codex supplies source and this handoff; Pi executes checks and the owner reviews.
No subagents. The current working agreement governs this batch.

Keep existing run folders. Add `environment-summaries.csv`, a small per-run
`result-record.json` (request/data/code identity and file checksums), and a
rebuildable `results-index.json` mapping matching calculation keys to folders.
Use the existing work-directory writer lock and atomic JSON replacement.
Default repeated commands reuse complete intact results before terrain/SPICE
work; `--refresh` computes again, preserving old folders. `--rebuild-index`
repairs the index without calculating. No server, ORM or new dependencies.

- [x] Supply focused checks for matching identity, numeric/UTC forms,
  changed inputs/data/code, incomplete/corrupt/superseded files, and recovery
  after index loss.
- [x] Implement `result_store.py`: canonical existing inputs, source/code
  fingerprints, completed-run publication, indexed lookup and index rebuild.
  All artifact paths stay inside their run folder. Reads do not mutate results.
- [x] Wire lookup/publication and summary CSV into `batch_environment.py`.
  Compute on a miss; cache hits return the original report/artifact paths with
  explicit hit status and lookup time. Never relabel old results as new work.
- [x] Pi reports the bounded checks passed: repeated hits without new folders or
  artifact writes, and index rebuild. Verify evidence and measure hit latency.
- [x] Document commands, limits and a bounded [Pi handoff](LML-FILE-RESULTS.md).
- [x] Owner supplies Pi's all-four-checks-passed report and authorizes committing
  this milestone. Detailed command logs were not supplied.

No automatic adoption of old runs lacking the new identity record. Scientific
outputs remain available in their existing folders; newly completed runs enter
the lookup automatically. Cache identity includes all calculation settings,
manifest content, verified asset checksums, package source and dependency
versions. Download limits/offline flags are not calculation settings.
