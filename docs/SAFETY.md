# Safety and privacy

## Read-only means no cleanup capability

The scanner uses directory enumeration, metadata and a bounded set of configuration reads. It does not remove, rename, overwrite, compress or move scanned files. There is no shell plugin, arbitrary filesystem plugin, HTTP plugin, cleanup endpoint or hidden deletion action.

The desktop shell stores its own local preferences. Scanner validation of personal protection accepts existing local directories. Files, missing paths, links and other rejected inputs produce `invalid-protection` coverage warnings without dropping valid protection entries or blocking the scan. The UI retains saved preferences conservatively; these warnings do not remove preferences or override intrinsic protection. **Open folder** starts the operating system file manager for a finding or retained directory in the latest native scan. Folder IDs are resolved against that scan; arbitrary paths are not accepted by the reveal endpoint. **Export** opens a native save dialog and creates a new `.json` or `.md` file; existing files are never overwritten. An interrupted export may leave an incomplete newly created report. These explicit actions are separate from scanning.

Removing a finding's personal protection removes only its exact saved path rule. Protection inherited from a saved parent, or caused by a protected child, is shown separately with the saved path and the number of affected findings in the current report. Removing such a rule requires reviewing its scope and explicitly choosing to remove it for all covered paths; independent rules and intrinsic protection remain. Paths outside the current report may also be covered by the rule.

Operating-system access timestamps and external software can still change while files are read. The read-only claim does not mean the complete operating system remains bit-for-bit unchanged.

## Classification is conservative

Protected aggregate findings retain up to 20 sorted protected-location paths and a total boundary count, exposed in finding details and full JSON reports. Nested locations already covered by a protected parent are omitted from this list. The aggregate is still counted once. Redacted reports withhold these paths and labels while retaining the count.

There are three assessments:

- **Lower risk:** stronger, narrow recovery evidence. Currently used only for recognized CPython tagged bytecode filenames where each observed `.pyc` has its exact corresponding source filename and no unrelated entry was found. Dotted source stems are preserved, including optional optimization tags. Unknown, legacy or malformed cache names remain protected. This is not an unconditional deletion approval.
- **Needs review:** conventional build/dependency/cache data with unresolved recovery conditions.
- **Protected:** possibly unique data, unknown storage under a known root, or a personal protection preference.

A directory called `build` or `node_modules` outside a detected project is not enough to create a cleanup recommendation. Within a detected project, names still do not prove that every contained file is disposable. The scanner does not establish Git tracking/dirty state or validate lockfile contents.

Maven local repositories can contain locally installed artifacts. Python virtual environments can contain editable or manually installed dependencies. Yarn project directories can include tracked Zero-Install data, patches, plugins and releases. Virtual disks can contain persistent data. These distinctions are reflected in the findings and warnings.

Yarn `.yarn` directories, unrecognized `venv`/`.venv` directories and `__pycache__` directories without complete source evidence are conservative protection boundaries even without a discovered project. These boundaries also protect an enclosing build/cache aggregate. This can protect an unrelated directory with one of these names; it never makes a name alone sufficient evidence for a cleanup candidate. Dependency manifests inside an aggregate still do not create additional project inventory or duplicate byte accounting.

## Filesystem scope

Selecting a subtree preserves intrinsic protection from enclosing storage, including Yarn, Git metadata, unrecognized environments and protected shared-cache categories. Ancestor context is checked up to 128 levels without measuring siblings. Selecting a descendant of a policy-excluded directory still excludes it; unresolved ancestor depth stops that root with a coverage warning.

Bounded allowlisted ancestor markers also preserve project and storage context for directly selected artifact directories and their subtrees. The first enclosing storage boundary takes precedence over installed-package manifests. A parent project used only for context is marked `contextOnly`; its owned/artifact totals include only files measured inside effective roots. Context probes never add sibling files to the scan or execute project code.

Overlapping selected roots and shared-cache locations are collapsed to an effective union. Aggregate findings stop further classification below that finding, preventing parent/child finding sums from double counting. Nested projects own their own bytes rather than charging them to every ancestor project.

The scanner does not follow symbolic links, Windows junctions or reparse points. A selected root containing a linked ancestor is rejected. Some cloud-placeholder files are therefore skipped. Sensitive directories such as `.ssh` and `.gnupg`, and major Windows system directories at the drive root, are excluded by default.

Checks are snapshot-based path checks, not a race-free sandbox. A concurrently changed directory can invalidate a previous check. Do not scan actively hostile trees. This pilot does not use handle-relative traversal with operating-system no-follow guarantees. No writes or code execution are performed even when metadata changes unexpectedly.

Read errors, skipped entries, depth limits, entry limits and cancellation reduce coverage. The UI exposes this; findings with incomplete subtree measurements are excluded from the review-candidate total. Other complete findings can still be shown in a globally partial report.

Markdown exports retain this distinction per finding: measurement status, a partial-size label when needed, effective risk and review-candidate eligibility. Both full and redacted exports exclude incomplete or protected findings from candidate eligibility. A completed finding can remain a candidate in a globally partial or cancelled report; this is still a request for further review, never deletion approval.

## Byte accounting

All sizes are **logical file lengths**. A hardlinked file encountered at two different paths contributes at each path. Compression, sparse files, filesystem metadata, allocation unit rounding and reflinks are not measured. Deleting one hardlink may release no storage; deleting an internal virtual-disk cache may not shrink the host file. Do not interpret a candidate total as a promise of freed SSD space.

## Configuration reads

Gradle settings support bounded, literal top-level `include 'api', ':lib:core'` and `include("api", ":lib:core")` declarations, including intermediate projects. This identifies conventional output for modules whose build rules are in the root project. Comments and strings are lexed without execution. Dynamic declarations produce `gradle-settings` warnings; directory/build-file remapping and applied settings scripts disable inferred paths. Names containing traversal, separators or interpolation are rejected. Only existing in-scope directories are visited, and the normal link and protection checks still apply.

The scanner may read bounded, known configuration files for specific fields: npm user cache/store settings, Maven user `localRepository`, Gradle wrapper `distributionUrl`, Git `HEAD` when `.git` is a directory, and allowlisted package.json recovery evidence (workspace marker, package-manager name, script names, local/non-registry dependency names and patch/lifecycle flags). Dependency locations, versions, URLs and script bodies are not retained as recovery evidence. Raw configuration contents are not copied into reports. Secrets on unrelated lines of a configuration file are not intentionally extracted or displayed.

No source file contents, `.env` values, wrapper executables, virtual-disk contents or arbitrary file previews are opened. Package script bodies may be encountered while parsing the bounded manifest, but are neither retained nor executed. Wrapper presence and recognized script names can enable copy-only command suggestions; these require manual review and execution outside DevSpace. Most project markers and lockfiles are detected by filename and metadata only. Variable substitution is bounded to avoid cyclic expansion.

## Report privacy

Full Markdown exports include scope, project ownership in scope, per-finding reasons/evidence/recovery/caveats, retained protected locations, wrapper context and coverage-warning details. The default redacted Markdown remains a restricted summary and applies redaction at the formatting boundary as well as in the UI. Partial measurements and effective personal protection remain explicit in both formats.

A previous report remains inspectable and exportable while a new scan runs or fails, with an explicit previous-report notice. Its native/demo provenance is preserved. Successful scans, including cancelled scans with partial results, replace it. Folder reveal is disabled during scanning to avoid mixing finding IDs between native reports.

Full reports contain absolute paths, project names, branch names, timestamps and configuration-location provenance. Those can reveal usernames, customer names or internal project details. Treat a full export as potentially sensitive.

The default redacted export is a deliberately restricted summary. It replaces paths, names, branch/version text, raw evidence, warning text and other free-form content with fixed descriptions and anonymous identifiers. Counts, sizes, category labels and timestamps remain. It is not a claim that all statistical information is anonymous in every context.

Full scan reports remain in memory until explicitly exported. The application does not upload them. Selected root paths and personal protection paths are saved locally for convenience. A compact snapshot of the most recent complete scan is also saved locally: scope, effective root paths, timestamp, logical totals and up to 5,000 finding paths/sizes, within 1.5 million characters. VS Code uses workspace storage; the desktop uses its local webview storage. Partial or cancelled scans never replace this baseline. Changes are compared only with matching requested/effective scope and report format; fewer logical bytes do not prove deletion or physical savings. The browser preview has separate local storage and synthetic demo data; demo reports never replace a native baseline.

Full JSON reports include the bounded folder inventory and recovery evidence. Folder detail retains at most 10,000 directories plus remaining roots within an approximate 4 MiB budget and up to five file samples per directory. Missing detail is disclosed without subtracting its bytes from totals. The redacted export omits folder paths, file samples and project recovery metadata.

## Native security surface

The application loads bundled local content. Its content-security policy rejects external scripts, frames and objects. The only enabled plugin capability is the directory picker plus Tauri's core window/event facilities. Custom native commands expose scan, cancellation, current-report folder reveal and user-dialog-mediated report export.

The pilot has not undergone a formal security audit. Signed release binaries, large-scale performance measurements, stronger hostile-filesystem hardening and additional native UI tests are release-hardening work, not claims of this version.
