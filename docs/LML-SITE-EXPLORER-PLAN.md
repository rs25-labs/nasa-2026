# Site explorer and dated pilot cards

Owner approved the site explorer/cards as the next UI milestone while Pi runs
the frozen archive. Codex writes source/docs; Pi executes app/tests. No Codex
app execution, subagents, installations or writes into either archive/snapshot.

Design: a searchable/filterable 50-site catalog before mission setup. Browsing
a card shows a detail panel; an explicit Use this site action updates draft
name/coordinates, centers the existing terrain map and preserves date/height
and the displayed calculation. Markers on the terrain/Moon distinguish
published candidates, exploratory offsets, draft and displayed/saved results.
Lists provide a keyboard alternative to clustered markers. Filters cover text,
region, published/exploratory and data availability; zero matches is explicit.

Data: a read-only `/api/sites` endpoint builds canonical catalog entries and
merges a deliberately published, pinned pilot summary. Only three sites have
verified hourly previews, Nov 19–21 2026 at 2 m. The other 47 show collection
in progress, with available preflight terrain context. No seasonal/annual claim
from two days; no inference from current form dates. No archive-run import into
the interactive app index and no automatic job submission.

The published-source manifest pins the pilot collection and complete.json hash;
the reader checks identity and hashes of the lightweight sites/profile files.
It does not scan or hash the large running archive. Missing/tampered/unpublished
previews produce an explicit message and retain coordinate selection. Full
archive publication is a later deliberate update after Pi verifies completion.

- [x] Add published preview manifest and strict read-only atlas reader/API.
- [x] Add searchable list and dated detail cards; show source, offset, terrain,
      actual Sun/Earth explanations and uncertainty/obstruction basis.
- [x] Wire selection to draft/map and add catalog markers to terrain/Moon.
- [x] Correct the already reported missing space in phone planner heading.
- [x] Source review plus bounded [Pi fixture/browser handoff](LML-SITE-EXPLORER-PI-HANDOFF.md); no new calculations.
- [ ] Pi verifies actual browser/data behavior; owner reviews results.

Pi at `aa32bd9`: lightweight publication and API checks passed, but browser
testing stopped before cards loaded because `site-explorer.js:81` lacked the
closing template-literal backtick. Source correction closes that literal;
syntax and resumed browser checks are assigned to Pi in the handoff. No UI
pass is claimed from the backend results. Collector/source archives untouched.

Use current CSS/vanilla JS, no new dependencies or numerical changes. The
frozen `214ba7e` collector remains unaffected. Backend edits change the main
checkout's development fingerprint; no interactive job was active before edits.
