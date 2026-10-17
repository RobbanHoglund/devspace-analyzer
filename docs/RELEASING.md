# Releasing the VS Code extension

The first stable version is 1.0.0. Source code uses Apache-2.0, matching JVMScope.
The supported GA product is the local VS Code extension on Windows x64, Linux
x64 (glibc), macOS Intel and Apple silicon. The unsigned desktop remains preview.

## Merge

PR #10 contains the complete insights, storage, navigation, manual guidance,
branding, scanner optimization and release changes from the earlier stacked PRs.
Review and merge #10 directly into `main` after both required workflows are green
on its final revision: **Core and desktop checks** and **VS Code extension**.
PRs #8 and #9 are superseded; they do not need separate merges.

## Prepare the versioned packages

The **Prepare VSIX release draft** workflow runs after either main CI workflow
completes. It waits until both latest runs for the **same main commit** have
succeeded. It downloads the four already-tested VSIX artifacts, verifies their
GitHub SHA-256 digests, package metadata, source revision and license contents,
and creates an **unpublished draft** named `v1.0.0` with the packages, `SHA256SUMS`
and `SOURCE.json`. It never publishes or overwrites a published release.

No extra secret or Marketplace credential is required: the job uses the
repository's scoped `GITHUB_TOKEN`. Only trusted main source is checked out;
PR runs and artifacts cannot trigger release creation. Artifact data is inspected
without executing its contents or extracting it into the checkout.

If needed, run **Prepare VSIX release draft → Run workflow → main** to retry.
Retries fill missing identical assets only. A draft from another commit, a
conflicting tag, changed asset or failed/pending latest CI attempt stops release
preparation. Review conflicting drafts manually; the workflow never deletes them.
Main artifacts must still exist (CI retains them for 14 days); rerun main CI if
they expired. Uploaded GitHub Release assets have no Actions retention deadline.

## Publish

1. Open the draft under [GitHub Releases](https://github.com/RobbanHoglund/devspace-analyzer/releases).
2. Check that all four platform VSIXs, `SOURCE.json` and `SHA256SUMS` are attached
   and the release draft workflow succeeded. Match the source revision to main.
3. Install the final Windows VSIX into a local VS Code window and scan a small
   representative workspace. Check folder picking, folder reveal, redacted export,
   restart/preferences and the **Manual cleanup guide**. The copy action must only
   copy text. Automated CI covers disposable fixtures; this check covers your setup.
4. Use **Publish release** when ready. This is the explicit public GA step and
   makes the versioned packages available from the installation links in the README.

This branch prepares publication; it does not claim that a draft already exists
before merge. Marketplace publishing and Windows desktop signing are separate work.

## Later releases

Update the root/extension npm manifests and locks, both local Cargo packages and
Cargo.lock, and Tauri version together. Add `docs/releases/VERSION.md` and a
changelog entry. Keep the two copies of LICENSE/NOTICE identical. Release tests
run with `python -m unittest discover -s scripts -p 'test_release.py' -v`.
The draft workflow refuses a reused published version; bump semver first.
