# Final merge and GA readiness review — 0.4.2

Reviewed 2026-10-17. This is a preview and a release-readiness assessment, not a
publication or merge. The feature branch remains stacked on the earlier storage
and insights work. Release the reviewed combined source, not an older main build.

## Verdict and final corrections

**Merge candidate after the final 0.4.2 CI is green; not yet a GA package.**
The final review started from `2e626ac1e60530305d0b9565c32439a80d8f1479`
(0.4.1). Both workflows were green, and its Windows VSIX was inspected directly.
The PR merge tree matched the feature-head source tree. Review threads were empty.

The review found and fixed a scanner regression introduced in 0.4.1: Windows
directory hints were lowercased, but the `Pipfile` and `Pipfile.lock` lookup keys
were not. Small-directory scans could therefore miss Pipenv projects or their
lockfile evidence. A focused test failed before the fix. Hints and lookup keys
now both fold ASCII case on every platform, while the existing filesystem probe
still decides whether the marker actually exists and rejects links. This also
preserves discovery on case-insensitive macOS volumes without treating differently
cased files as markers on case-sensitive volumes. Filesystem regression fixtures
cover mixed-case Pipenv markers and the volume's actual case behavior; Mac CI now
runs these fixtures too.

The cleanup dialog now says **Manual cleanup guide**, **Choose instructions**
and **Cleanup commands never run from this window**. Choosing an option only
changes the displayed command. Copying and scanning remain separate actions.

The PR description records the final commit, workflow runs and package checksum.
Use those final results for merge; the earlier green 0.4.1 build does not validate
the later correction. The release decisions below remain deliberately unchanged.

## Product and functional review

| Area | Result / change |
| --- | --- |
| Product purpose | Read-only storage analysis, evidence-based review plans, manual cleanup guidance and measured same-scope comparison. No native cleanup execution remains. |
| Guidance discoverability | Overview always has How to clean up, including an empty state opening Scan settings. Finding details expose the same guidance. |
| Guidance correctness | Exact recognized cache boundaries, explicit cache arguments, separate effects/recovery, official sources, no predicted savings, protected/partial-cache restrictions. A complete cache remains explainable in a globally partial scan. |
| Navigation | Back/Forward, breadcrumbs, folder drill-down and restoration covered. Fixed a reproduced narrow-view click loss: changing the hover caption height moved the folder row under the pointer. Caption space is now stable. |
| Accessibility/layout | Dialog traps focus, Escape returns to the opener, header/footer remain visible while instructions scroll. Existing keyboard, narrow editor, high-contrast and long-path cases retained. |
| Branding | Original JvmScope publisher portrait reused byte-for-byte. Product mark uses the same blue rounded-tile vocabulary; Activity Bar/editor marks follow its monochrome magnifier convention. Image assets are bundled locally. |
| Packaging | Version 0.4.2 is consistent. Icon is declared and included. Both VSIX and desktop build package dependency license notices. Old compiled modules are cleared before build, and package inspection refuses a stale cleanup runner. |
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
Final 0.4.2 CI repeats both comparisons. These are warm synthetic measurements,
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

## Decisions before GA

| Item | Status / required action |
| --- | --- |
| License and permitted use | **Open.** The package license is UNLICENSED and explicitly evaluation-only. Choose the terms for general use. No license was changed implicitly by the branding request. JvmScope uses Apache-2.0; that is a separate decision for this repository. |
| Mainline/release source | **Open.** PR #8 targets main; #9 targets #8's branch; #10 targets #9's branch. Merge #8 → #9 → #10, checking/retargeting each remaining base to main after its dependency is merged. Verify final combined main CI before building/publishing the GA package. This work does not merge or publish. |
| Public distribution | **Open.** No GitHub release existed when checked on 2026-10-17. Actions artifacts expire after 14 days. Publish a versioned, durable GitHub release and/or Marketplace listing. Verify publisher ownership if using Marketplace. |
| Version/status | **Open.** Promote to the chosen GA version (normally 1.0.0 for the first stable release) and remove Preview only after the chosen release scope passes its gates. |
| Desktop signing | **Open for the desktop distribution.** The Windows installer/executable are unsigned. Decide the signing/distribution policy before promising a friction-free public Windows install. This does not stop testing the VSIX. |
| User-machine acceptance | **Still needed.** Exercise the final Windows VSIX on a representative real workspace and confirm folder picking, Explorer reveal, exports, restart/preferences and manual guidance. Automated fixtures do not certify every package-manager setup, filesystem or antivirus policy. |

No formal security audit or complete support for remote VS Code, vscode.dev,
network/hostile filesystems, physical allocation or every package-manager override
is claimed. These supported-scope limits belong in the public product description.

For a VSIX-only GA, desktop signing and unsupported Linux desktop dependencies
are outside that release's scope. Do not make them blockers for the extension,
and do not describe the separate desktop preview as GA implicitly.
