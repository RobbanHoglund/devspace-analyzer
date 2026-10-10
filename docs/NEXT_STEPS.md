# Pilot review and next steps

## First native validation

Use a small known workspace before scanning a whole user profile. Keep ordinary developer tools closed for the comparison.

1. Confirm that a real scan produces actual paths, not the demo banner or example data.
2. Compare a few ordinary, non-linked finding folders against an independent logical-size measurement. Do not compare a sparse disk or hardlinked store to Explorer's allocated-size number.
3. Exercise cancellation during a larger scan, then start a fresh scan.
4. Verify Windows junctions, inaccessible folders, long paths and project names containing non-ASCII characters.
5. Open a finding's folder and confirm that the file manager opens the directory, not an executable.
6. Export redacted JSON and Markdown. Confirm that real paths, repository names and branch names do not appear. Try exporting to an existing filename and confirm that it is refused.
7. Restart and confirm that selected roots and protection preferences persist while a full scan report does not.

Record the build SHA, platform, Node/Rust versions for source builds, scan scope and observed results. Do not include full private reports in a public issue.

## Review priorities

Evaluate the implementation critically rather than accepting the proposed rules as authoritative. For each concern, state the evidence, user impact, proposed change and any disagreement with the current design. Distinguish a reproduced defect from an unverified hypothesis.

The most important review areas are scope coverage, false confidence in cleanup recommendations, logical-versus-physical accounting, link handling, native export behavior and responsiveness on a workspace containing hundreds of thousands of files.

## Next-stage features

1. Commit resolved dependency lockfiles and add signed, reproducible release packaging.
2. Add per-cache discovery diagnostics and more configuration resolution without executing project code.
3. Add a strictly opt-in, bounded Git-status adapter before making tracked-file or uncommitted-change claims. Keep worktrees and branch scope explicit.
4. Add better dependency-origin checks for local/file/editable packages, lockfile validation and recovery evidence. No absence-of-reference proof based only on the scanned projects.
5. Measure allocated size separately where the operating system supports it, and identify shared hardlinks without presenting false reclaim guarantees.
6. Add snapshot comparison, custom output directories and performance benchmarks with representative Java/Node/Python workspaces.
7. Treat any future cleanup capability as a separate design and security review: dry-run plans, explicit approval, path revalidation and versioned recovery notes are mandatory. Do not add broad recursive deletion to the current pilot.
