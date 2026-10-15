# DevSpace Analyzer

**Understand your development storage before removing anything.**

Windows-first desktop pilot for local inventory of checked-out projects and shared developer caches. The interface explains what was found, its risk classification and what recovery would involve.

> Pilot 0.1.1 is read-only. There are no cleanup, dependency-installation or project build-execution commands. Candidate sizes are logical bytes, not guaranteed physical space savings.

## Pilot 0.1.1

Fixes six reviewed issues: protected descendants inside aggregates; explicit-cache recognition with automatic inclusion off; npm configuration parsing; the macOS uv cache default; linked wrapper-marker ancestors; and pagination after protection changes. See [review fixes and trade-offs](docs/REVIEW_001_FIXES.md).

## Features

- Clickable ecosystem storage map, searchable findings, project inventory and scan coverage.
- Gradle caches/wrappers, Maven repositories/output, npm/npx storage, Node dependencies, known pnpm/Yarn locations, Python environments and pip/uv caches.
- Project discovery from Java/Node/Python manifests and Git markers; scoped Gradle wrapper references.
- Evidence, recovery notes, conservative protection and saved personal protection preferences.
- Cancellable native scanning, folder reveal and JSON/Markdown export; redacted summary by default.
- Explicitly marked synthetic demo data for the browser preview.

## Windows

A successful **Windows x64 desktop** job publishes `devspace-windows-x64`, containing the unsigned NSIS installer and executable. Artifacts expire after 14 days. Check the source revision and test result before running a pilot binary.

To build from source, install Node.js 22.12+, stable Rust/MSVC, Microsoft C++ Build Tools and WebView2 as described in the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/).

```powershell
git clone --branch main git@github.com:RobbanHoglund/devspace-analyzer.git
cd devspace-analyzer
npm ci
npm run tauri -- dev
```

Build the installer with `npm run tauri -- build --bundles nsis -- --locked`. Icons are generated locally; no icon or font downloads are needed.

For the first scan, choose a repository parent folder such as `C:\ws\git`. Add shared caches through the optional checkbox, then inspect Findings and Scan coverage. Administrator privileges are not required; inaccessible areas are reported, not bypassed.

## Browser preview

Run `npm ci` and `npm run dev`, open `http://127.0.0.1:1420`, then select **Explore demo**. The preview does not scan the filesystem and never claims that synthetic figures came from this computer.

## Interpreting results

| Metric | Meaning |
|---|---|
| Identified developer data | Logical file lengths in classified aggregate findings |
| Review candidates | Complete findings not protected by a rule or personal preference; not deletion approval |
| Protected data | Potentially unique data or personal protection, including an aggregate containing protected descendants |
| Owned project size | File lengths charged exclusively to that project, excluding nested source projects |
| Measured files | Files in the effective traversal roots, including unclassified data |

Hardlinks, sparse disks, compression and shared stores can make these numbers differ from allocated or reclaimable disk space. Skipped entries reduce coverage. A protected aggregate is counted once; its nested projects retain exclusive owned bytes but do not have independently classified artifact findings in this pilot. Their Inspect view includes the existing enclosing protected finding with an explanation, without adding findings or reassigning bytes.

## Safety and scope

The scanner executes no project code, build script, package-manager command or Git command. It rejects symlinks/junctions/reparse points, including linked marker ancestors. Git metadata, Maven storage, Java toolchains, Yarn project storage and virtual disks are protected. The presence of a lockfile or absence of wrapper matches does not prove that anything can be recovered or is unused.

Only selected roots plus optionally included caches are traversed. Configuration discovery reads bounded user settings for identity even with automatic inclusion off; unrelated cache contents are not scanned. The coverage view lists effective roots separately from recognized overlapping cache identities. Invalid explicit configuration produces redacted diagnostics, not silent fallback guesses.

Only known bounded manifest/configuration fields are read. No arbitrary source contents, `.env` values or executable contents are exported. Opening a folder and exporting a new report are explicit actions; exports refuse to overwrite existing files. Full reports contain potentially sensitive metadata; the default redacted summary withholds free-text paths, names, branches and evidence. Scan reports remain in memory unless exported. Preferences stay local.

The pilot does not resolve complete dependency graphs, all Git branches, dirty/tracked state, remote availability, every running tool, physical allocation or complete container inventories. Project/CLI overrides, pip.ini and arbitrary Yarn/Gradle configuration are not evaluated. The scan is bounded to 5 million entries, 20,000 findings, 10,000 projects and 128 levels; at most 500 warning details are retained.

See [Safety and privacy](docs/SAFETY.md), [native verification](docs/NATIVE_TESTING.md) and [next steps](docs/NEXT_STEPS.md). Snapshot path guards are not race-free protection against hostile concurrent filesystem changes. No formal security audit is claimed.

## Development

```sh
cargo test --locked -p devspace-core
npm test
npm run build
npx playwright install chromium
npm run test:ui
```

Normal CI runs original and review regression tests on Linux/Windows, frontend tests/build, browser interaction tests, Windows packaging and a real native scan. `scripts/windows-native-test.ps1` exercises the release executable at normal user integrity. Large-workspace benchmarks/cancellation, native file-dialog interaction and installer installation/uninstallation remain separate validation tasks.

Dependency snapshots in `package-lock.json` and `Cargo.lock` come from the verified main CI run [38050353533](https://github.com/RobbanHoglund/devspace-analyzer/actions/runs/38050353533). Use `npm ci` and Cargo `--locked`; CI enforces both, including native packaging. Lockfiles pin dependency resolution, not compiler versions, installer signatures or byte-identical binaries. Update them explicitly and verify on Linux and Windows.

```text
crates/core/    Read-only scanner, cache discovery, rules and regression fixtures
src/           React UI, report transforms, pagination and synthetic demo
src-tauri/     Native commands, cancellation, folder reveal and report export
scripts/       Local icon generation and native test support
tests/ui/      Browser baseline and regression tests
docs/          Safety, review fixes and validation limits
```

No server, account or database is needed for scanning. The development toolchain and WebView2 installation may require network access; the scanner itself makes no network requests.

## VS Code extension

An installable VS Code pilot lives in [`vscode/`](vscode/README.md). It reuses the Rust scanner and analysis UI, adds an Activity Bar view and workspace/folder commands, and includes its own scanner binary. Download the matching `devspace-vscode-*` artifact from a successful **VS Code extension** workflow, extract the VSIX, then use **Extensions → … → Install from VSIX…**. Local trusted desktop windows are supported; shared cache scanning is opt-in. See the extension README for installation, platform limits and development checks.
