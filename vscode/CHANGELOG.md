# Changelog

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
