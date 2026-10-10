# DevSpace Analyzer

**Understand your development storage before removing anything.**

DevSpace Analyzer is a Windows-first desktop pilot that inventories checked-out projects and shared developer caches. It explains what was found, how it was classified and what recovery would involve. All scanning happens locally.

> Pilot 0.1.0 is read-only. It has no delete, cleanup, package installation or build-execution commands. A review candidate is not a promise that deletion is safe or that its logical size will become free disk space.

## What the pilot does

- A visual overview of developer storage, with a clickable ecosystem map.
- Project discovery from Git markers and Java, Node and Python manifests, including nested projects and worktree markers.
- Gradle cache and wrapper inventory; wrapper versions are cross-referenced against discovered project wrappers.
- Maven repository/output, npm/npx storage, Node dependencies, pnpm/Yarn locations, Python environments and pip/uv caches.
- Searchable findings with evidence, risk classification, recovery notes and personal protection preferences.
- A scan-coverage view with effective roots, cache-location provenance, skipped entries and explicit limitations.
- Cancellable background scanning, logical byte counts and JSON/Markdown export. A redacted summary is the default export.

## Try the desktop application

A successful **Windows x64 desktop** job in GitHub Actions produces the `devspace-windows-x64` artifact. It contains the per-user NSIS installer and the application executable. Pilot builds are unsigned; check the repository and build revision before running an executable. Build artifacts expire after 14 days.

### Build and run from source on Windows

Install Node.js 22.12 or newer, stable Rust with the MSVC toolchain, Microsoft C++ Build Tools and WebView2. See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for the supported Windows setup.

```powershell
git clone --branch feature/pilot git@github.com:RobbanHoglund/devspace-analyzer.git
cd devspace-analyzer
npm install
npm run tauri -- dev
```

For a distributable Windows installer:

```powershell
npm run tauri -- build --bundles nsis
```

The icon is generated locally by the launch/build command. No icon or font downloads are required.

### First scan

1. Add a parent folder containing your repositories, for example `C:\Workspaces` or `C:\ws\git`.
2. Leave **Include known shared caches** enabled to include discovered user-level cache locations.
3. Select **Scan workspace**, then inspect the largest findings. Start with a narrow workspace rather than the entire system drive.
4. Review **Scan coverage** before interpreting totals. Export a redacted report to discuss the findings without exposing your local paths.

Administrative privileges are not required. Inaccessible locations are reported rather than bypassed.

### Browser-only preview

```sh
npm install
npm run dev
```

Open `http://127.0.0.1:1420` and select **Explore demo**. The preview uses explicitly marked synthetic data. **A normal browser cannot run the native filesystem scanner.** No scan starts automatically, and demo protection preferences do not change desktop scan preferences.

## What the numbers mean

| Metric | Meaning |
|---|---|
| Identified developer data | Sum of classified, non-nested finding paths, using logical file lengths |
| Review candidates | Measured complete findings not protected by a rule or your preferences; not guaranteed savings |
| Protected data | Storage that can contain unique data, or a path you personally protected |
| Project owned size | Logical file lengths owned by that project, excluding nested projects to avoid double counting |
| Files measured | Files in the effective scan scope, including files not classified as developer artifacts |

Hardlinks, sparse virtual disks, compression and shared package stores can make logical sizes very different from physically reclaimable space. The pilot does not claim a physical-space estimate. Skipped links and unreadable entries make coverage partial.

## Safety boundaries

- No analyzed project code, build script, package-manager command or Git command is executed.
- Symbolic links, Windows junctions and other reparse points are skipped, including explicitly selected linked roots.
- `.git`, Maven repositories, Java toolchain downloads, Yarn project storage and virtual disks are protected rather than treated as disposable caches.
- A lockfile's presence is evidence, not proof of reproducibility. Local packages, unpublished versions, patches and offline requirements still matter.
- No matching Gradle wrapper means only "not found in this scan", never "unused everywhere".
- File modification timestamps are not interpreted as last-use dates.
- The scanner does not read source contents or arbitrary file contents. Small, allowlisted configuration/manifest fields are read for location and project detection.
- Opening a folder uses the system file manager only after a user action. Report export writes a newly selected report file and refuses to overwrite an existing file.

See [Safety and privacy](docs/SAFETY.md) for important limitations.

## Current scope and omissions

This pilot is an inventory and explanation tool, not a dependency garbage collector. It does **not** resolve complete dependency graphs, inspect all Git branches, determine the dirty/tracked state, prove that a remote package still exists, detect all running tools or clean any files. Containers and VHDX files are protected observations, not a complete Docker/Podman/WSL inventory.

Environment overrides and selected user npm/Maven settings are supported. Project-specific overrides, custom Gradle init scripts, pip.ini, arbitrary Yarn configurations and command-line overrides are not evaluated. Discovered cache locations list their source. Missing or inaccessible default cache paths are omitted from discovery; the list is not a guarantee that all caches were located.

The scan is bounded to 5 million entries, 20,000 findings, 10,000 projects and 128 directory levels. At most 500 warning details are retained. Closing the application does not persist a full scan report: only selected roots and personal protection preferences are saved locally.

## Development and verification

```sh
npm test
npm run build
cargo test -p devspace-core
npx playwright install chromium
npm run test:ui
```

CI is configured to run core tests on Linux and Windows, frontend unit tests, browser interaction tests and a Windows desktop/installer build. Browser tests generate screenshots under `artifacts/`. Consult the checks for the exact revision being used; a configured check is not itself evidence of a passing run.

The dependency ranges in this pilot are resolved by `npm install` and Cargo. CI retains the generated lockfiles alongside test artifacts; locked dependency snapshots should be committed before promoting a release beyond the pilot stage.

## Structure

```text
crates/core/          Read-only scanner, location discovery, rules and filesystem tests
src/                 React interface, report transformations and demo data
src-tauri/           Native commands, cancellation, folder reveal and report export
scripts/             Deterministic local icon generation
tests/ui/            Browser interaction and layout tests
docs/                Safety model, review checklist and next-stage scope
```

The native core and UI communicate through a typed, versioned report model. No network service, database or account is needed for scanning. The development toolchain and an installer that needs WebView2 can require network access; the scanner itself does not make network requests.
