# Final merge and GA readiness review — 1.0.0

Prepared 2026-10-17. This branch prepares the VS Code extension for GA; merge and
publication are separate maintainer actions. The Windows desktop remains preview.

## Final corrections and merge gate

The 0.4.2 baseline (`29a93f29ee2f93d66c35e9e4aae887c5e8defe2e`) passed both CI
workflows on all four extension platforms and Windows desktop. Its final review
fixed mixed-case Pipenv marker discovery, preserved actual filesystem case/link
checks on every platform, and changed the dialog to **Manual cleanup guide**,
**Choose instructions** and **Cleanup commands never run from this window**.
The Mac filesystem fixtures now use canonical temporary paths, preserving the
scanner's rejection of linked scan roots.

The 1.0.0 preparation adds the chosen license, stable extension metadata, durable
release automation and one combined PR against main. Merge only when both workflows
are green on the **final 1.0.0 revision**. The PR description records those exact
runs and the inspected Windows VSIX checksum; earlier green runs do not validate
later changes. After merge, main CI independently gates the draft release.

## Product and functional review

| Area | Result / change |
| --- | --- |
| Product purpose | Read-only storage analysis, evidence-based review plans, manual cleanup guidance and measured same-scope comparison. No native cleanup execution remains. |
| Guidance discoverability | Overview always has How to clean up, including an empty state opening Scan settings. Finding details expose the same guidance. |
| Guidance correctness | Exact recognized cache boundaries, explicit cache arguments, separate effects/recovery, official sources, no predicted savings, protected/partial-cache restrictions. A complete cache remains explainable in a globally partial scan. |
| Navigation | Back/Forward, breadcrumbs, folder drill-down and restoration covered. Fixed a reproduced narrow-view click loss: changing the hover caption height moved the folder row under the pointer. Caption space is now stable. |
| Accessibility/layout | Dialog traps focus, Escape returns to the opener, header/footer remain visible while instructions scroll. Existing keyboard, narrow editor, high-contrast and long-path cases retained. |
| Branding | Original JvmScope publisher portrait reused byte-for-byte. Product mark uses the same blue rounded-tile vocabulary; Activity Bar/editor marks follow its monochrome magnifier convention. Image assets are bundled locally. |
| Packaging | Version 1.0.0 is consistent. The extension Preview flag is removed; desktop remains preview. Icon, Apache LICENSE/NOTICE and dependency notices are included and checked during packaging. Old compiled modules are cleared before build, and package inspection refuses a stale cleanup runner. |
| Host boundaries | Removed execution endpoints rejected even if sent directly. Scanner rejects --cleanup. Official documentation opens through an allowlist. Folder reveal now checks ancestors consistently for both storage folders and findings. |
| Data protection | No scan writes/deletion/tool execution. Existing tests cover protected aggregates, linked ancestors/junctions, scope union, cancellation, partial reports and redacted export. Comparisons preserve the last complete baseline. |
| Dependencies | Fresh root and extension npm audits report zero advisories. Rust dependency resolution is unchanged since the earlier audit, and the current RustSec database HEAD was checked to still be the audited revision below. This is not a newly executed Rust audit. Two existing informational advisories are described below. |

## Validation gates

Local validation includes Rust unit/regression suites, 62 frontend unit tests,
80 browser interaction tests, 9 host/protocol tests, production/typecheck build and
VSIX package inspection. CI builds and tests the installed extension on Windows
x64, Linux x64, macOS x64 and arm64, plus Linux Restricted Mode and the declared
minimum VS Code 1.85.0 (installed activation, real webview startup, read-only scan, all view commands and reopening; the full browser-driven UI suite runs on current VS Code). Evidence is attached to the exact revision's workflow runs
and linked in the pull request. A green compile alone is not the release gate.

The revised installed-extension tests inspect and copy guidance without changing
the fixture cache, then make an explicit test-only external file change and use
Scan again to measure it. The actual publisher image must load in the webview.
All four VS Code themes are exercised.

Windows desktop CI now silently installs the NSIS package in a fresh disposable
folder, runs the actual installed application through WebView2 at normal user
integrity, and uninstalls it. The executable's SHA and installer checks are retained.
No real user cache is touched by these tests.

Paired scanner benchmarks (`node scripts/compare-scanner.mjs CURRENT BASELINE`)
compare complete reports against 0.4.0 on identical flat/deep 100,100-file fixtures,
with warmup and three alternating measured rounds. Verified Windows 0.4.1 medians
were 3,780 → 604 ms for the flat tree and 17,076 → 1,183 ms for the deep tree.
Final 0.4.2 Windows medians were 3,195 → 538 ms (flat) and 14,316 → 1,031 ms (deep). The 1.0.0 CI repeats both comparisons. These are warm synthetic measurements,
not a prediction for a user's SSD. See [PERFORMANCE.md](PERFORMANCE.md).

The complete-rescan Overview fixture at 1440 × 900 shrank from 2,113 to 1,182 px
in page height; its entire distribution chart fits in the first viewport. Narrow
editors still need vertical scrolling. The cleanup dialog was rechecked at
560 × 700 after the wording change, including keyboard focus and visible footer.

RustSec database revision `64f92cdc64401fab47baa10e2e11fe382aa57155` reported no
vulnerability entries. It reported informational advisories for `glib 0.18.5`
(RUSTSEC-2024-0429, an unsound iterator) and `proc-macro-error 1.0.4`
(RUSTSEC-2024-0370, unmaintained) in the wider Tauri dependency graph. These are
not in the standalone scanner bundled in the VSIX. The GTK-based Linux desktop
is not a supported packaged target in this release; do not promote it to GA
without reviewing/updating that dependency chain.

## Release decisions implemented for 1.0.0

| Item | Decision / evidence |
| --- | --- |
| License | Apache-2.0, matching JVMScope; full text at the repository root and inside the VSIX. NOTICE attributes Robert Höglund. Third-party notices retained. |
| Scope and status | VS Code extension 1.0.0, Preview false. Supported local desktop platforms are Windows x64, Linux x64 (glibc), macOS Intel and Apple silicon. |
| Mainline | PR #10 includes all earlier #8/#9 work and targets main directly. No stacked merge sequence is needed. |
| Distribution | GitHub Releases with four platform VSIX files, SHA256SUMS and SOURCE.json. Automation requires both successful main CI workflows for the exact revision and verifies artifact digests, source and metadata before preparing an unpublished draft. |
| Publication | Explicit maintainer action after merge, main CI and final acceptance. No release or Marketplace listing is published by this branch. |
| Desktop | Remains an unsigned preview, labelled in the application and documentation, excluded from the GA release assets. Desktop signing is outside this release. |
| User-machine acceptance | The final package can be installed before merge. Check folder picking, reveal, exports, restart/preferences and manual guidance on a representative local workspace. Only the user can confirm behavior on that machine; automated fixtures are not a claim of that acceptance. |

Release regression tests cover trusted event/source checks, latest CI attempt
selection, artifact completeness and integrity, VSIX metadata, source revision,
draft-only creation, checksums, idempotent retries and refusal to overwrite assets.
The actual release draft is first created after merge; a mocked test cannot prove
repository write permissions or claim a completed publication. See [RELEASING.md](RELEASING.md).

No formal security audit or complete support for remote VS Code, vscode.dev,
network/hostile filesystems, physical allocation or every package-manager override
is claimed. These supported-scope limits are stated in the public product description.
