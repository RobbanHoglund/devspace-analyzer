# Review 001 fixes — pilot 0.1.1

This patch addresses R01–R06 from the review of 0.1.0. The original failing expectations remain unchanged in `crates/core/tests/review_regressions.rs` and `tests/ui/review-regressions.spec.ts`. They now run as part of the normal pilot checks, not only the historical review workflow.

## Changes and trade-offs

**R01 — Protected descendants.** Aggregate measurement applies protected-type and known-cache checks while traversing. Any protected descendant makes the whole enclosing finding protected, with category-specific evidence and recovery text. Explicit nested Git projects are recorded; their owned bytes are charged only to them, not to every ancestor. Dependency manifests alone do not create thousands of nested source projects. A single aggregate finding remains the size-accounting unit, so parent/child findings do not double count.

This deliberately favors conservative protection over maximizing candidate totals. A protected aggregate can include ordinary generated output too. Nested projects inside it have owned-byte inventory, but their artifacts are not separately classified in this pilot, and their Inspect filter may have no independent findings. The enclosing aggregate must be inspected instead. Splitting such aggregates without weakening safety is later work.

**R02 — Identity versus scope.** Known cache identities are resolved independently of automatic inclusion. Disabling the checkbox stops unrelated cache directories from entering the traversal roots, but explicitly selected known caches still classify correctly. User configuration files are read for this identity resolution even when automatic inclusion is off. The coverage view distinguishes effective roots from recognized locations that overlap them.

**R03 — npm configuration.** Bounded top-level scalar extraction handles duplicate settings (last scalar wins), INI comments, whole quoted values and escaped comment delimiters. npm environment setting names are case-insensitive on all hosts; unrelated Unix environment names remain case-sensitive. Ambiguous case-variant values, arrays, invalid paths and missing explicit directories generate diagnostics rather than arbitrary guesses. Rejected raw values and credential lines are not copied to diagnostic messages. This is not a full npm configuration evaluator: project/global configuration and command-line flags remain out of scope.

**R04 — uv defaults.** uv gets its own cache location calculation: XDG or `.cache/uv` on macOS/Linux, LocalAppData `uv/cache` on Windows, and `UV_CACHE_DIR` precedence. This is configuration-tested on the Linux and Windows runners; native macOS desktop support is not claimed.

**R05 — Linked marker ancestors.** Marker probes and bounded text reads share a root-to-leaf no-follow guard. A `gradle` symlink/junction cannot supply an external wrapper marker and invent a project. Windows has a dedicated junction regression in addition to the original Unix symlink test. Path checks remain snapshot-based, not a hostile-concurrent-filesystem sandbox.

**R06 — Pagination.** Row slicing, range text and navigation use immediately clamped page bounds. State is synchronized after a result-count change, and replacing a report resets pagination. Coverage includes 0/1/50/51/100/101 rows, protection/unprotection, empty filters, filter clearing and demo report replacement.

## Verification commands

```sh
cargo test -p devspace-core
npm test
npm run build
npx playwright install chromium
npm run test:ui
npm run tauri -- build --bundles nsis
```

On Windows, `scripts/windows-native-test.ps1` also runs the actual release application against temporary fixtures. It checks a real scan, a nested source repository, enclosing-aggregate protection for a VHDX, personal protection and unchanged fixture hashes/mtimes. The distributed app has no debug endpoint; automation flags belong only to the test process.

CI retains source, browser evidence, native evidence and an unsigned Windows installer. Consult the run for the exact revision; this document describes the test design, not a substitute for a passing run.

## Next review / Codex

Check the latest branch and PR before editing. Read this note, the original inline findings on PR #1, and the actual test logs. Respond in the Codex chat with which fixes you accept, which you dispute and the evidence for each disagreement. Do not weaken or skip the original regression expectations to make a check green.

Keep the app read-only. No deletion commands, package-manager execution, telemetry or guessed physical reclaim estimates. Before expanding scope, review aggregate ownership/Inspect behavior, performance on a real large workspace, custom configuration coverage, native dialogs, installer behavior and dependency locking. Native macOS execution, large-tree cancellation/benchmarks, installer installation/uninstallation and a formal security audit remain outside these checks.

References: npm configuration and npmrc docs, npm/ini scalar parser, and Astral uv storage documentation (see `docs/SOURCES.md`).
