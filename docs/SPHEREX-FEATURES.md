# SPHEREx Sky Change Investigator — Feature List

Date: October 18, 2026.
Status: product selected and core scope locked; detailed design proposed for owner review.
Challenge: [Planet X and SPHEREx](https://www.spaceappschallenge.org/2026/challenges/planet-x-and-spherex/)
Coordination: [two-application plan](TWO-ENTRY-BUILD-PLAN.md)
Implementation: [SPHEREx plan](SPHEREX-IMPLEMENTATION-PLAN.md)

## Product purpose

Enable a user to investigate changes across real SPHEREx sky observations and understand whether the available evidence supports an apparent change.

Primary user: an astronomy enthusiast, educator, or analyst exploring a target or sky region. The complete workflow is coordinate/target selection → observation discovery → compatible image selection → aligned visual comparison → quality/evidence inspection → annotation → save/share/export.

The contribution is an accessible investigation workflow with traceable evidence. Existing IRSA search and image services are inputs and baselines for differentiation. The application does not claim that every residual is an astronomical event, or require discovery of a previously unknown object to be useful.

## Version 1 features — all required

| ID | Feature | Completion behavior |
|---|---|---|
| S01 | Sky/target search | Enter celestial coordinates or resolve a target name using a documented public resolver; specify sky area and date interval. Show resolved coordinates, field size, and supported limits. Failures preserve the user's inputs. |
| S02 | Observation discovery | Query the archive for actual coverage. List observation time, footprint, detector/band, applicable wavelength information, release/processing version, quality status, and source identifier. Show no-data and partial-coverage states. |
| S03 | Comparable-image selection | Help users choose observations with overlapping sky coverage and compatible spectral/quality characteristics. Explain why an image is excluded or why only a side-by-side comparison is available. |
| S04 | Aligned image viewer | Display source cutouts in a common sky frame with linked pan/zoom, coordinate readout, blink, and synchronized side-by-side views. Show orientation, angular scale, and explicit missing pixels. |
| S05 | Date/wavelength exploration | Filter and sequence comparable observations by time and spectral selection. Use a timeline to select available observations. Distinguish temporal changes from comparisons at different wavelengths. |
| S06 | Quality/evidence panel | Inspect input quality masks, uncertainty availability, coverage, processing versions, and alignment metadata. Surface saturation, detector artifacts, and missing-data information relevant to the comparison. |
| S07 | Investigation workspace | Mark a location or region, add notes and a user interpretation, attach selected source observations, and keep an ordered evidence record. Labels include possible motion, possible brightness change, likely artifact, and unresolved; these are user annotations. |
| S08 | Save/reopen/share | Save named investigations locally, reopen/duplicate them, and import/export a versioned investigation JSON. Share links encode validated inputs and stable source IDs; recipients retrieve/reconstruct the view. Clearly state local-save and archive-availability limits. |
| S09 | Export evidence | Download source references, selected cutouts, comparison metadata, and annotations as a bundle. Separate science FITS files from display PNGs when available; include units, masks, alignment details, and limitations. |
| S10 | Complete application | Deployed URL, uncached requests, bounded retrieval jobs, progress/cancel/retry, persistent backend job status, responsive views, keyboard-operable controls, and readable errors. Examples and custom requests use the same backend. |

## Supported-domain proposal

- Query any sky coordinate with archive coverage. Published limits constrain area, returned observations, and processing load, not arbitrary example-only targets.
- Initial cutout field: up to 10 arcminutes per side; up to 20 retrieved observations per investigation and four images loaded in a comparison view. These are proposed request caps, to be confirmed with the foundation outputs.
- Observation dates and release availability come from the archive/capabilities, not a promise of complete all-sky repeat coverage.
- Name resolution is optional convenience: coordinate search remains usable if a resolver is unavailable.
- Use calibrated released images and documented cutout services. No raw instrument reduction pipeline.

## Scientific contract

A calibrated SPHEREx image's wavelength varies with detector position. Matching a detector/band label alone is insufficient to establish comparable measurements at the selected sky position. The foundation must establish how local wavelength/support information can be recovered and used.

A common WCS grid aligns celestial coordinates but does not automatically equalize wavelength response, point-spread function, background, or calibration. Expose those limits. Interpolation-derived pixels retain coverage/quality masks. Align the sky, not a moving target, when inspecting apparent motion.

Core release uses linked/blink comparison with compatible inputs. A quantitative difference layer is an optional enhancement only after the owner reviews evidence that registration, local spectral matching, PSF/background handling, and uncertainties support it. If those conditions fail, explain why rather than fabricate a residual map.

No automatic detection, motion fitting, orbit estimation, novelty certification, or scientific classification is required for version 1. Evidence annotations remain distinguishable from calculated measurements.

## Main views

1. Search and observation results.
2. Comparison viewer with timeline and quality panel.
3. Investigation notes/evidence.
4. Saved investigations and import/export.
5. Source/method/limits page.

## Review output

At the first data checkpoint, Pi returns one known-object/region example with at least two candidate epochs, input metadata, comparable/excluded decisions, aligned cutouts, and actual retrieval/processing costs. This output establishes feasibility, not scientific discovery or whole-sky reliability.

## References

- [IRSA SPHEREx mission and services](https://irsa.ipac.caltech.edu/Missions/spherex.html)
- [Data Explorer overview](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/overview.html)
- [Visualization](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/visualization.html)
- [Archive FAQ](https://irsa.ipac.caltech.edu/onlinehelp/spherex/spherex/faq.html)

Exact query endpoints, release selection, source IDs, and interpretation rules are recorded from the archive documentation and Pi outputs before implementation expands.
