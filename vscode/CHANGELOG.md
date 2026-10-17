# Changelog

## 1.0.0

- Consistent compact SVG action icons across all views, including folder breakdown, review exclusions, manual guidance, copy, export and navigation. Labels and keyboard access are retained.
- First stable release scope: VS Code in local desktop windows on Windows x64, Linux x64 and macOS Intel/Apple silicon. Desktop remains an unsigned preview.
- Adopt Apache-2.0, matching JVMScope, with LICENSE, NOTICE and dependency notices bundled and verified.
- Remove the extension Preview flag and align source/package versions.
- Prepare versioned GitHub Release drafts from all four tested main CI packages, with SHA-256 checksums and source provenance. Publication remains explicit.
- Retain read-only scanning, compact navigation, storage maps, faster scanning and copy-only manual cleanup guidance from the preview.

## 0.4.2

- Fix case-normalized marker lookups so Windows recognizes Pipfile and Pipfile.lock after the scanning optimization.
- Keep directory-name hints conservative on both case-sensitive and case-insensitive volumes, including macOS, and verify marker discovery on all supported platforms.
- Clarify that the manual cleanup guide only shows and copies instructions; choosing an option never runs a cleanup command.
- Refresh the final merge/GA review and distinguish code readiness from the remaining license, Preview and distribution decisions.

## 0.4.1

- Make Overview compact by default: use the editor width, show summary and scan comparison side by side, condense distribution rows and expand recommendation reasons on demand.
- Reuse Windows directory-entry metadata instead of reopening each file for its size. Recheck directories before traversal and retain link/reparse-point exclusions.
- Skip missing project/Git marker probes using a bounded directory-name lookahead; wide or unreadable listings retain the original checks.
- Avoid per-file progress-path allocation and duplicate aggregate metadata lookups.
- Compare complete reports and scan times against 0.4.0 on the same flat/deep 100,100-file fixtures in Windows/Linux CI.

## 0.4.0

- Replace native cache execution with **How to clean up**: copy-only npm/pnpm/pip instructions, exact cache paths, effects, official documentation and explicit same-scope rescan comparison.
- Remove all cleanup execution handlers, subprocess adapters and the scanner's `--cleanup` mode. Obsolete compiled host modules are removed before packaging.
- Keep guidance discoverable with an empty state that opens Scan settings. Explain protected/partial cache restrictions, and allow guidance for complete caches when unrelated scan coverage is partial.
- Reuse the original JvmScope author portrait in package/native icons and the app header; align product and navigation icon conventions.
- Open only allowlisted documentation pages through the host, keep the guidance dialog header/footer accessible, and verify assets in the installed VSIX.
- Update test dependencies to patched Vitest 4.1.11. The npm dependency audits are clean as of this review; build/test tools are not bundled into the extension runtime.
- Keep this release labelled Preview while GA publication and license decisions are outstanding.


## 0.3.0

- Native cache maintenance: npm verify/clean, pnpm store prune and pip cache purge, with an explicit preview and Run step.
- Exact command, tool version, target path, effects and copy-command option; bounded live log, cancellation and honest success/failure results.
- Fresh before/after logical-size measurement and automatic rescan of the original scope.
- Host-side protection, complete-scan gating, exact cache identity, no links/junctions, path revalidation, isolated configuration and single-use expiring plans.
- npm 8–11, pnpm 8–10 and pip 21–26 direct installations supported. Gradle/Maven build operations remain guidance only.

## 0.2.3

- Large folder tiles show a clickable preview of their immediate contents, preserving measured totals and explicitly accounting for missing detail.
- One exact-value list sits beside the map in wide editors and below it in narrow editors. Hover and keyboard focus link the matching rows and map areas.
- Map groups show their own list; folder review links, list pagination, Back/Forward and Up work with direct subfolder navigation.

## 0.2.2

- One Back/Forward history for views, folders and map groups, restoring filters, focus and scroll position. New scans start a new history; demo history stays separate.
- Sticky Up and folder breadcrumbs, a compact parent-folder menu for deep paths, and Alt+Left/Right/Up shortcuts.
- Explore all folders directly from Overview, return directly from finding drawers, and distinguish the file-manager action from navigation within DevSpace.

## 0.2.1

- Interactive folder treemap in Storage: click into folders, explore smaller-item groups and file samples, and navigate back with breadcrumbs or Up.
- Overview distribution donut includes unclassified measured files and opens the matching findings or folder view.
- Charts preserve measured totals through filters and missing detail, adapt to editor width and theme, and support keyboard navigation.

## 0.1.1

- Explain each scan with a clear takeaway and concrete checks for its largest review candidates.
- Show how review candidates, protected data, incomplete findings and unclassified files add up to the measured total.
- Distinguish Gradle build output from the project's local cache and put review steps beside folder actions.
- Use the native sidebar as the single navigation surface, with selection following the active analysis view.
- Compact scan/export controls and improve wide detail panels and narrow editor layouts.

## 0.1.0

- First installable VS Code pilot, reusing the DevSpace Rust scanner and React analysis views.
- Activity Bar navigation, workspace and folder commands, progress/cancellation, explicit export and local preferences.
- Light/dark/high-contrast themes and layouts for narrow editor groups.
- Bundled scanner packages for Windows x64, Linux x64 and macOS x64/arm64.
- Local trusted workspaces only; demo remains available in Restricted Mode.
