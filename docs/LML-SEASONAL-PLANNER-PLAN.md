# Seasonal calendar, date finder and three-site comparison

Owner explicitly approved items 3/4. Work is isolated in the ignored local
worktree `data/local/lml/ui-workspaces/seasonal-planner`, branch
`codex/lunar-seasonal-planner`, based on `aa32bd9`. Existing Pi UI checkout and
frozen collector are untouched. Codex writes source/docs; Pi executes scripts,
tests/app. No subagents, new calculations, dependencies, database or solver edits.

Design: separate planning panel below the site explorer, with a site/year picker
and 12 monthly cards. Monthly coverage is explicitly full/partial/missing, never
filled with zero. Selecting a month filters up to 31 daily candidate starts.
Choose 1/7/14/30 days and rank by conservative sunlight or Earth visible-disk
mean, known simultaneous visibility, or shortest known darkness. Darkness with
UNKNOWN time is unranked rather than treated as a proven short interruption.
All numeric bounds retain original precision; display rounding is presentation.

Three independent site selectors compare the exact same UTC start/duration,
one-hour source cadence and 2 m observer height. Missing dates/longer windows
remain unavailable. Use inputs copies site/date/duration/height into the draft,
does not submit a job or relabel displayed results. The existing calculator's
six-hour cadence remains visible; these are archived hourly planning previews.

Data pipeline: use the explicitly pinned completed summary only (pilot now,
full archive after publication). A Pi-only preparation command validates source
CSV hashes and creates compact per-site JSON views in a separate ignored
planning-views folder, with lineage/hash receipt. The API reads one small site
file, not a multi-year raw CSV per request, and never scans unfinished archives.
Missing/corrupt views produce clear unavailable states, retaining other features.

- [x] Write derived-view builder/reader and read-only `/api/site-planning` endpoint.
- [x] Write calendar, complete daily-window ranking and matched-date comparison.
- [x] Connect site-card Compare and Use inputs; preserve result/draft identity.
- [x] Supply focused Pi fixture/check and [bounded UI handoff](LML-SEASONAL-PLANNER-PI-HANDOFF.md) after current UI QA.
- [ ] Pi executes fixture, view preparation and browser checks; owner reviews evidence.

Pilot acceptance is intentionally limited to Nov 19–21 2026 for three sites:
two one-day starts, no 7/14/30-day results, no annual coverage claims. Full data
uses the same publication/config path after independent collection verification.
