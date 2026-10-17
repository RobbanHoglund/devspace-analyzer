# DevSpace Analyzer for VS Code

Understand the storage used by your developer projects and shared caches before removing anything.

DevSpace provides **local, read-only storage analysis and practical cleanup guidance** for Gradle/Maven, Node/npm and Python. It explains findings, protection rules, evidence and recovery limits. Sizes are logical file lengths, not guaranteed disk savings.

## Install and open

1. Download the ZIP named `devspace-vscode-win32-x64` from a successful **VS Code extension** GitHub Actions run. Extract the `.vsix` file. Choose the matching Linux or Mac artifact on those platforms.
2. In VS Code, open **Extensions → … → Install from VSIX…** and select the file.
3. Click the **DevSpace** icon in the Activity Bar, or run **DevSpace: Open Analyzer** in the Command Palette. You can also use **View → Open View… → DevSpace Analyzer**.
4. Choose **Scan workspace** or **Choose folder to scan…**. You can right-click a local folder in Explorer and choose **DevSpace: Scan Folder…**.

The Rust scanner is included in the VSIX. Scanning needs no Rust, Node, Java, Python or separate desktop installation. If you choose to follow cleanup guidance, run its command yourself using your installed package manager.

## What you get

- **How to clean up** in Overview and cache details: measured size and path, copyable npm/pnpm/pip commands, consequences, recovery notes and official documentation. DevSpace does not execute commands or remove files.
- Click **Scan again** after making your own changes to compare complete scans. No predicted savings or automatic rescan after copying.
- Your author icon matches JvmScope; Activity Bar and editor-tab marks share its visual conventions and follow VS Code themes.

- Overview, searchable Findings, folder-level Storage, Projects and Scan coverage in a reusable analysis tab.
- Follow unclassified space into child folders and large file samples, with complete byte totals even when retained detail is limited.
- Project-specific review plans show recovery evidence, missing prerequisites, next steps and tradeoffs. Suitable commands can be copied for manual review; DevSpace never executes them.
- Rescan the same scope to compare measured totals and finding paths. Partial scans cannot overwrite the last complete comparison baseline.
- A scan takeaway with concrete review checks, plus a breakdown connecting review candidates, protected data, incomplete findings and other measured files to the total.
- Native sidebar navigation that follows the active result view, and explicit workspace/folder scanning.
- Progress and cancellation, with partial results when the scanner can stop gracefully.
- Evidence, protected locations and local personal protection preferences.
- JSON/Markdown export from the compact **Export** menu through a save dialog; a redacted summary is selected by default. Existing files are never overwritten.
- VS Code dark, light and high-contrast colors, keyboard navigation and detail drawers in narrow editor groups.
- Clearly labelled synthetic demo data. Demo mode restores your real report when you exit it.

Shared caches are **off by default** in the extension. Enable them explicitly in Scan settings when you want a wider scan. Scan roots/cache inclusion and a compact comparison baseline (paths, sizes, scope and timestamp) are remembered for the workspace; personal protection preferences stay in this VS Code profile. Full reports remain in memory until you export them. Closing and reopening the analysis tab keeps the latest native report for this VS Code session; filters return to their initial values when the tab is closed. Switching views or temporarily hiding the tab preserves the active view.

Review suggestions use project recovery evidence first, then logical size, and exclude protected, empty and incompletely measured locations. They do not establish that data can be deleted or how much physical disk space would be recovered. **Other measured files** opens Storage with an unclassified-only filter; their contents and recoverability have not been assessed. Run a fresh scan after upgrading to capture this new detail. After a real scan, **Explore demo** is available inside **Scan settings**.

## Supported environments

Preview packages: Windows x64, Linux x64 (glibc), macOS x64 and macOS arm64. VS Code 1.85 or later. This release supports **local desktop windows**. Remote SSH, WSL, Dev Containers, virtual workspaces and vscode.dev scanning are outside this release. Open a local VS Code window to scan local folders.

Restricted Mode permits the demo but blocks real scanning and folder access. No scan starts when the extension activates. The scanner executes no project code, shell command, build, package manager or Git command and makes no network requests. It retains the desktop scanner's conservative protection, link handling, coverage limits and byte accounting.

## Build and verify

From the repository root, with Node 22.12+ and Rust installed:

```sh
npm ci
npm ci --prefix vscode
npm run package --prefix vscode
npm test --prefix vscode
npm run test:integration --prefix vscode
```

On headless Linux use `xvfb-run -a npm run test:integration --prefix vscode`. Integration tests install the generated VSIX into an isolated VS Code profile, scan a disposable fixture, inspect the real webview and capture all four built-in theme categories. They do not use your normal editor profile.

The `.vsix` appears under `artifacts/`. Packaging is platform-specific and uses the current machine's architecture. GitHub Actions builds all four variants and retains successful packages for 14 days. The existing desktop build remains available separately.

Marketplace publication is a later step. The publisher identifier must be owned by the account that publishes it. This repository has no open-source license declaration; the pilot package retains the author's rights. Packaged third-party license notices are included.

## Finding cleanup guidance

Open **Overview → How to clean up**, or choose an npm, pnpm or pip cache in **Findings**. If no cache appears, open **Scan settings**, select **Include known shared caches**, then scan again. A custom cache can be selected as a scan folder. The scanner does not run installed tools to resolve every possible configuration.

Review the target and consequences, choose **Copy command**, and use your own terminal. **Scan again** reuses the report’s original scope. A complete scan is needed for before/after comparison. Protected and partly measured caches do not offer cleanup commands. Demo paths are examples and cannot be copied from cache guidance.

Version 0.4.0 remains a preview pending the release decisions recorded in `docs/GA_REVIEW.md` in the source repository.
