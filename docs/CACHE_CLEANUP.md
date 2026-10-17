# Manual cache cleanup guidance — 0.4.0

DevSpace never runs cleanup commands. The native adapters, version probes,
prepare/run/cancel handlers and scanner `--cleanup` protocol from 0.3.0 are removed.
Scanning, viewing instructions and copying a command do not modify cache contents.

## User flow

1. Scan your folders. Shared caches are opt-in under Scan settings in VS Code.
2. Open **Overview → How to clean up**, or the same action in a cache finding.
3. Review the measured folder, its logical size, the configured cache path and effects.
4. Check the tool target if needed; copy and run the command yourself in a terminal.
5. Select **Scan again**. The original report scope is rescanned and the existing
   complete-scan comparison shows the measured change. Copying does not rescan.

The overview section remains visible if no supported cache was found and opens
Scan settings. Gradle, Maven and project folders retain their individual manual
review/recovery plans in Findings.

## Scope and commands

| Cache finding | Copy-only guidance | Consequences |
| --- | --- | --- |
| npm configured-cache/_cacache | `npm cache verify` or `npm cache clean --force`, with explicit `--cache` | Verification also removes unneeded data. Clearing requires future downloads. `_npx` and `_logs` are not treated as the package cache. |
| Exact pnpm store root | `pnpm store prune`, with explicit `--store-dir` | The installed pnpm version determines its store layout and pruning behavior. Hardlinks and global virtual stores affect savings and scope. |
| Exact pip cache root | `python -m pip cache purge`, with explicit `--cache-dir` (`python3` on POSIX) | Removes cached HTTP responses and wheels; future installs may download/build again. |

Commands are generated from scan data, not from executing tool discovery. A user
must use the intended installed tool/version and inspect the path printed by the
optional check command. Run outside a project, with other package jobs stopped.
Copied commands use the user's environment and configuration. These instructions
are not a live validation, dry run, guarantee of recoverability or deletion approval.

Windows instructions target PowerShell with the conventional npm.cmd/pnpm.cmd
launchers. POSIX instructions use literal single-quoted arguments. Control
characters, roots, relative/traversal paths, UNC paths and ambiguous Windows
launcher metacharacters do not receive copyable commands. The UI explains the
manual-review requirement and retains the exact path and documentation link.

No command is offered for protected caches, protection intersecting the wider
command scope, project overlap or incompletely measured cache findings. An
unrelated partial scan does not suppress instructions for a completely measured
cache, but cannot establish a comparison baseline. Demo commands cannot be copied.

## Measurement

The prior complete same-scope scan is compared with the new complete scan.
Changes are logical byte differences, not proof that cleanup occurred or physical
space was reclaimed. Other processes may have changed data. The application does
not claim that the copied command succeeded. A failed/partial scan retains the
existing baseline and reports its limitations.

## Official sources checked for this revision

- [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache/)
- [pnpm store](https://pnpm.io/cli/store)
- [pip cache](https://pip.pypa.io/en/stable/cli/pip_cache/)

## Verification

Unit tests cover path matching, command quoting, unsupported paths and protected
scope. Browser tests cover copy-only behavior, original-scope rescan, partial and
protected findings, missing caches, narrow layout and keyboard focus. Host tests
reject removed execution commands. The scanner rejects `--cleanup`. Installed
VSIX and Windows desktop fixtures verify instructions without modifying cache
contents; a separate test-only file edit then verifies manual rescan comparison.
