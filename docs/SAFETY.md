# Safety and privacy

## Read-only means no cleanup capability

The scanner uses directory enumeration, metadata and a bounded set of configuration reads. It does not remove, rename, overwrite, compress or move scanned files. There is no shell plugin, arbitrary filesystem plugin, HTTP plugin, cleanup endpoint or hidden deletion action.

The desktop shell stores its own local preferences. Scanner validation of personal protection accepts existing local directories. Files, missing paths, links and other rejected inputs produce `invalid-protection` coverage warnings without dropping valid protection entries or blocking the scan. The UI retains saved preferences conservatively; these warnings do not remove preferences or override intrinsic protection. **Open folder** starts the operating system file manager for a finding in the latest native scan. **Export** opens a native save dialog and creates a new `.json` or `.md` file; existing files are never overwritten. An interrupted export may leave an incomplete newly created report. These explicit actions are separate from scanning.

Operating-system access timestamps and external software can still change while files are read. The read-only claim does not mean the complete operating system remains bit-for-bit unchanged.

## Classification is conservative

There are three assessments:

- **Lower risk:** stronger, narrow recovery evidence. Currently used only for Python bytecode where each observed `.pyc` has a corresponding source filename and no unrelated entry was found. This is not an unconditional deletion approval.
- **Needs review:** conventional build/dependency/cache data with unresolved recovery conditions.
- **Protected:** possibly unique data, unknown storage under a known root, or a personal protection preference.

A directory called `build` or `node_modules` outside a detected project is not enough to create a cleanup recommendation. Within a detected project, names still do not prove that every contained file is disposable. The scanner does not establish Git tracking/dirty state or validate lockfile contents.

Maven local repositories can contain locally installed artifacts. Python virtual environments can contain editable or manually installed dependencies. Yarn project directories can include tracked Zero-Install data, patches, plugins and releases. Virtual disks can contain persistent data. These distinctions are reflected in the findings and warnings.

Yarn `.yarn` directories, unrecognized `venv`/`.venv` directories and `__pycache__` directories without complete source evidence are conservative protection boundaries even without a discovered project. These boundaries also protect an enclosing build/cache aggregate. This can protect an unrelated directory with one of these names; it never makes a name alone sufficient evidence for a cleanup candidate. Dependency manifests inside an aggregate still do not create additional project inventory or duplicate byte accounting.

## Filesystem scope

Overlapping selected roots and shared-cache locations are collapsed to an effective union. Aggregate findings stop further classification below that finding, preventing parent/child finding sums from double counting. Nested projects own their own bytes rather than charging them to every ancestor project.

The scanner does not follow symbolic links, Windows junctions or reparse points. A selected root containing a linked ancestor is rejected. Some cloud-placeholder files are therefore skipped. Sensitive directories such as `.ssh` and `.gnupg`, and major Windows system directories at the drive root, are excluded by default.

Checks are snapshot-based path checks, not a race-free sandbox. A concurrently changed directory can invalidate a previous check. Do not scan actively hostile trees. This pilot does not use handle-relative traversal with operating-system no-follow guarantees. No writes or code execution are performed even when metadata changes unexpectedly.

Read errors, skipped entries, depth limits, entry limits and cancellation reduce coverage. The UI exposes this; findings with incomplete subtree measurements are excluded from the review-candidate total. Other complete findings can still be shown in a globally partial report.

## Byte accounting

All sizes are **logical file lengths**. A hardlinked file encountered at two different paths contributes at each path. Compression, sparse files, filesystem metadata, allocation unit rounding and reflinks are not measured. Deleting one hardlink may release no storage; deleting an internal virtual-disk cache may not shrink the host file. Do not interpret a candidate total as a promise of freed SSD space.

## Configuration reads

The scanner may read bounded, known configuration files for specific fields: npm user cache/store settings, Maven user `localRepository`, Gradle wrapper `distributionUrl`, Git `HEAD` when `.git` is a directory, and the package.json workspace marker. Raw configuration contents are not copied into reports. Secrets on unrelated lines of a configuration file are not intentionally extracted or displayed.

No source file contents, `.env` values, package scripts, wrapper executables, virtual-disk contents or arbitrary file previews are opened. Most project markers and lockfiles are detected by filename and metadata only. Variable substitution is bounded to avoid cyclic expansion.

## Report privacy

Full reports contain absolute paths, project names, branch names, timestamps and configuration-location provenance. Those can reveal usernames, customer names or internal project details. Treat a full export as potentially sensitive.

The default redacted export is a deliberately restricted summary. It replaces paths, names, branch/version text, raw evidence, warning text and other free-form content with fixed descriptions and anonymous identifiers. Counts, sizes, category labels and timestamps remain. It is not a claim that all statistical information is anonymous in every context.

Scan reports remain in memory until explicitly exported. The application does not upload them. Selected root paths and personal protection paths are saved locally for convenience. The browser preview has separate local storage and synthetic demo data.

## Native security surface

The application loads bundled local content. Its content-security policy rejects external scripts, frames and objects. The only enabled plugin capability is the directory picker plus Tauri's core window/event facilities. Custom native commands expose scan, cancellation, finding-based folder reveal and user-dialog-mediated report export.

The pilot has not undergone a formal security audit. Signed release binaries, large-scale performance measurements, stronger hostile-filesystem hardening and additional native UI tests are release-hardening work, not claims of this version.
