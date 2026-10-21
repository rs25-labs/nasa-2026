# Mixed site atlas and seasonal archive

The owner approved the hybrid catalog and seasonal archive. Codex writes
source/docs and Pi handoffs; Pi executes data preparation/app/tests. No Codex
application execution, subagents, new numerical refinement or database.

## Approved feature direction

Up to 50 locations with provenance and site-context explanations; hourly
Sun/Earth conditions in 2026–2028 at 2 m observer height; seasonal summaries and
daily-start 1/7/14/30-day mission windows from reused time series. Later UI:
site cards, annual calendar, favorable-date search and three-site comparison.
This delivery is the collection foundation and bounded pilot, before UI or a
multi-day unattended full-archive run. Existing Moon-entry visual QA continues
independently; no edits to that UI or its handoff in this batch.

## Catalog

20 coordinate pairs transcribed from Table A1 of
[Wueller et al. (2026), DOI 10.1029/2025JE009434](https://doi.org/10.1029/2025JE009434),
two per region across ten groups inside current 90–85°S terrain coverage.
These are published research candidates, not certified or currently selected
NASA landing sites. Source IDs remain attached. The seed CSV contains facts,
not the paper's computed illumination results. Region naming follows the table.
[NASA's 2024 region announcement](https://www.nasa.gov/news-release/nasa-provides-update-on-artemis-iii-moon-landing-regions/)
provides historical program context, not endorsement of our individual points.

30 exploratory points are generated deterministically: from the first seed in
each group, offsets (+500,0), (-500,0), (0,+500) meters in our polar projection.
The labels disclose parent, offset and exploratory status. They test local
variation; they are not terrain-optimized or claimed to be within published
landing polygons. All 50 receive actual terrain/coverage and coarse local-slope
checks before a collection starts. No inferred ice deposits or hazard claims.

## Architecture and delivery tasks

- [x] `site_catalog.py`: strict seed loading, deterministic exploratory points,
      source/context fields, terrain sampling and local 40 m-grid slope context.
- [x] `site_archive.py`: serial offline workers in isolated archive workdir;
      <=30-day chunks, hourly samples, immutable collection identity containing
      catalog/settings/source/engine hashes; resumable receipts and job logs.
- [x] `site_archive_summary.py`: validated joins, duplicate chunk-end removal,
      gaps/disjoint bounds or conflicting geometry rejected, monthly and daily-start mission
      windows without rerunning solver. Unknowns/bounds remain visible.
      Compatible seam bounds may differ because witnesses are reused; retain
      both in seams.csv and use the next chunk's starting sample for duration.
      Emit source/context and calculated explanations in site-profiles.json.
- [x] Pi-only focused check for chunking/boundaries/unknowns/leap dates and
      resume/integrity pilot; no extensive generated suite.
- [x] Pi handoff: preflight 50, three representative points × two one-day
      hourly chunks, verify artifacts, resume with no workers, summarize, stop.
- [ ] Pi executes pilot; owner reviews before the long collection/UI milestone.

The background archive reuses cached scientific assets read-only through an
assets-directory link and a private copied receipt ledger. It has its own
locks/index/run folders so app saved results are not flooded with archive chunks.
No concurrent writers to an archive; no deletion of old evidence/live locks.
Stop on first failure, retain logs, resume completed validated work. Ctrl-C/TERM
must unwind the child and retain incomplete status. Package/source changes
require a new identity rather than mixing incompatible samples.

Interpretation: fraction bounds are geometric visible disk, not electrical
power or a radio link budget. Summaries use left-held hourly samples and mark
terminal samples zero-duration. Blocked runs are known sampled interruptions;
unknown runs separately identify possible longer interruptions. No universal
good/fair safety score. Report measured strengths/tradeoffs and missing evidence.

Full collection plan is 50 sites × 37 chunks for 2026-01-01 through 2029-01-01
(30-day chunk size), 1,850 jobs. Runtime/storage are measured in the pilot,
not extrapolated from a previously easy site. Full collection and atlas UI are
the next milestone after owner review of Pi's pilot outputs.
