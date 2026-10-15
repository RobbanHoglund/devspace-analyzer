# UI/UX review 004

Based on main `c7d8ae4`. Resolves the 18 findings from the visual review. The scanner remains read-only; classification, byte ownership and native filesystem operations are unchanged. A VS Code extension is a separate next step.

| Review item | Change | Verification |
|---|---|---|
| 01 | Readable type scale: 14px detail copy, 12px paths/badges, 13px controls. | Visual inspection at five desktop sizes. |
| 02 | Compact report header, collapsed and bounded next-scan settings, sticky export toolbar, condensed summaries outside Overview. | Small-window content and toolbar regression. |
| 03 | Finding details use a modal drawer at widths up to 1250px, instead of dropping below the results. | 1000×700 drawer visibility and scrolling regression. |
| 04 | Close a selected finding when it leaves the active filters, including after a protection change. | Selection/filter and pagination boundary regressions. |
| 05 | Demo mode snapshots and restores the real report, selections, filters, pagination, export choice and navigation state. | Native report → demo → native report regression. |
| 06 | Keep the completed report's scope separate from pending scan settings; indicate changes awaiting a scan. | Scope normalization unit test and pending-scope regression. |
| 07 | Dismissible action feedback stays visible independently of document scroll and inside the active modal drawer. | Export feedback at the bottom of a report; folder errors remain accessible and dismissible in the drawer. |
| 08 | Reset detail scroll when changing findings; collapse long evidence and protected-path samples while preserving counts. | Switching between long findings; retained evidence count checks. |
| 09 | Replace clipped treemap labels with labelled, keyboard-operable storage bars, including tiny shares. | Tiny ecosystem share remains readable and opens filtered findings. |
| 10 | Project search, ecosystem filter, sort and 50-row pagination; retain state when returning from inspection. | 120-project fixture, filter/navigation checks and table containment at 1000px. |
| 11 | Separate completion/coverage status from artifact risk labels; review totals use neutral blue. | Complete, partial and cancelled scan status cases. |
| 12 | Explain scans with no recognized artifacts separately from filters with no matches. | Empty scan has no meaningless Clear filters action. |
| 13 | Explicit Redacted summary / Full report export options with privacy explanations; keep export actions visible. | Default redaction, full Markdown/JSON payload and partial-report export checks. |
| 14 | Preserve per-view filters, pagination and scroll; offer return from project drillthrough; clear incompatible filters when opening an overview recommendation. | Navigation, project return and overview recommendation regressions. |
| 15 | Focus the detail heading on open, trap modal focus, support Escape and return focus to the source finding. | Keyboard checks at desktop and compact widths. |
| 16 | Entire finding rows activate details; compact navigation provides hover/focus labels and accessible names. | Row action and compact navigation focus checks. |
| 17 | Explain measured, identified and unclassified measured bytes together; never estimate unmeasured partial-scan data. | Measurement boundary unit tests and zero-finding partial report fixture. |
| 18 | Search and group retained warning details, paginate 25 at a time and distinguish retained detail counts from total warnings. | 500 retained / 605 total warning fixture, search and pagination regression. |

## Validation

- Production TypeScript/Vite build.
- 39 unit tests.
- 46 Playwright browser tests, including existing export, protection, pagination and rescan checks.
- Visual inspection of Overview, Findings, details, Projects and Scan coverage at 1000×700, 1100×700, 1366×768, 1440×940 and 1920×1080.
- Stress fixtures include long paths, 120 projects/findings, 500 retained warnings, 605 total warnings and 32 scan roots.
- Browser fixtures simulate native scan responses. Native Windows behavior is additionally covered by the existing Windows build/WebView2 smoke CI job; manual Windows OS interaction was not available in the review environment.

Existing protection/pagination tests now expect the filtered-out detail to close, while retaining the original pagination boundary assertions. The native smoke scenario explicitly clears its project filter when it needs all findings, because switching tabs now intentionally preserves that filter. It also closes finding details and checks restored focus before opening another finding, supporting the modal drawer on smaller Windows test desktops.
