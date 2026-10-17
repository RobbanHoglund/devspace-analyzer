# Cache maintenance — 0.3.0

Scan first, including known shared caches if needed. Use **Maintain your caches** on Overview or **Review cleanup** in a cache finding. Choose an action and prepare a preview. Preparing probes the installed tool version, resolves pnpm's active store when applicable and measures the target; it does not run maintenance. Inspect the target, exact argument list, effects and recovery cost, then explicitly choose **Run**.

| Action | Scope | Consequence |
| --- | --- | --- |
| npm cache verify | `_cacache` under the configured npm cache | Integrity verification and garbage collection change the cache; this is not a dry run. |
| npm cache clean --force | The same `_cacache` | Cached packages must be downloaded again. Existing npx environments, diagnostic logs and node_modules are outside this action. |
| pnpm store prune | The active version directory resolved inside the configured store | The package manager removes unreferenced packages. Later installs or branch changes can require downloads. Other store versions remain. |
| python -I -m pip cache purge | The explicitly selected pip cache | Removes cached HTTP downloads and wheels; installed environments remain. |

The Run screen shows output, exit status and a fresh before/after logical-size measurement. The original scan scope then refreshes automatically. Failed, cancelled and timed-out commands can have made partial changes and are labelled accordingly. After-measurement failure is reported as unavailable, never zero. Stop is not undo. Concurrent tools can affect the measured change. Hardlinks and allocation mean fewer logical bytes do not establish physical disk savings.

## Supported installations

This release accepts npm 8–11, pnpm 8–10 and pip 21–26. It requires direct installed tools on the host PATH. npm/pnpm use an absolute Node executable and the installed npm-cli.js/pnpm.cjs, including standard Windows global installations. Python uses its absolute interpreter with `-I -m pip`. Relative PATH entries and project `.bin` launchers are not used. Corepack, shell wrappers, standalone pnpm executables and Python launchers without a directly discoverable interpreter are not executed; unsupported installations get an explanation. No tool is downloaded by DevSpace.

Newer tool versions require adapter review and fixture coverage before they are enabled. pnpm 12 changes store traversal/retention semantics and is deliberately outside this release. Gradle and Maven commands remain copy-only guidance because they can run project build logic and affect configured outputs elsewhere.

## Execution boundary

- The host requires a complete latest native report, resolves the selected finding and obtains its current protection preferences. Demo data and caller-supplied commands cannot execute.
- The Rust adapter rechecks cache identity against current configuration, exact full finding scope, intrinsic/personal protection, and installed-tool metadata. npm logs/npx and cache subtrees cannot masquerade as the entire supported target.
- Preparation and execution each traverse the target without following links, junctions or reparse points. Protected names, special files, inaccessible entries and validation limits block execution. Missing protection paths are retained conservatively. The walk is bounded to two million entries, 128 levels and 30 seconds.
- The plan lives in the host/worker, expires after five minutes and is consumed by one attempt. Size/file-count changes invalidate the preview. A scan, another cleanup or protection changes cannot race an active plan through the application.
- Commands use a fixed argument allowlist and absolute executables, never a shell. The app supplies a temporary working directory/home/configuration, clears inherited Node/Python/npm/pip overrides, disables project hooks/version switching for pnpm and disables pip configuration loading. npm is invoked in global mode with diagnostic log creation disabled.
- Probe commands time out after 20 seconds; maintenance after ten minutes. Output is drained and retained up to 128 KiB. Cancelling/closing the session signals the native worker to stop its command. Temporary working data is discarded afterward; logs/results remain only in memory.

The displayed command can also be copied. Manual execution uses the user's shell environment, rather than the app's isolated configuration; run it outside a project and review its scope. The app itself never executes the displayed shell string.

These are snapshot checks, not a race-free operating-system sandbox. The application trusts the installed package managers and interpreter and cannot establish that every cached package remains downloadable. Close builds/package managers and do not use maintenance against actively hostile or concurrently modified directories.

## Verification

Native fixture tests exercise all four real commands against disposable caches, with spaces and metacharacters in their paths. They verify preview/cancel without deletion, wrong-token rejection, stale plans, newly inserted links/junctions, protection, complete findings, exact npm scope and active pnpm store scope. Host tests cover Restricted Mode, remote windows, report lookup and operation serialization. Browser tests cover explicit Run, copying, cancellation, errors, rescan, keyboard dismissal and narrow layout. Existing scan read-only regression tests remain.

Tool references: [npm cache](https://docs.npmjs.com/cli/v11/commands/npm-cache/), [pnpm store](https://pnpm.io/cli/store), [pip cache](https://pip.pypa.io/en/stable/cli/pip_cache/).
