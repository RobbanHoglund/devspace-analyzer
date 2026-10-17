# Scanner and layout follow-up — 0.4.1

The reported Windows scan measured 144,110 files in 73.5 seconds. That observation
does not identify SSD throughput as the bottleneck: scanning is mainly directory
enumeration and metadata/marker lookups, not reading all file contents.

## Scanner changes

- Use `DirEntry::metadata()` for enumerated files. On Windows the standard library
  reuses information returned by directory enumeration, avoiding a separate
  metadata call for each file. See the [Rust platform documentation](https://doc.rust-lang.org/std/fs/struct.DirEntry.html#method.metadata).
- Revalidate directories before descending, including Windows reparse-point
  checks. Marker/configuration reads retain their full no-follow ancestor checks.
- Inspect at most 256 directory entries ahead. A complete small listing can rule
  out absent project/Git markers without repeatedly querying every ancestor for
  each absent filename. Wider, errored or cancelled listings fall back to the
  original probes and stream the remaining entries. Nothing is omitted from
  byte accounting, and a marker beyond the lookahead limit is still discovered.
- Reuse an aggregate's already validated metadata and format the live progress
  path only when publishing progress, not for every file.

Traversal remains **single-threaded**. This patch removes demonstrated redundant
work; it does not claim a measured benefit from parallel traversal. A future
bounded worker implementation must preserve cancellation, global limits,
exclusive ownership, protected aggregates and deterministic accounting. Measure
the new Windows build on the same real scope before deciding whether remaining
latency justifies that complexity.

## Paired benchmark

`node scripts/compare-scanner.mjs CURRENT_BINARY BASELINE_BINARY` creates two
disposable fixtures, each with 100,100 files and 100 Node projects:

| Profile | Directories | Purpose |
| --- | ---: | --- |
| Flat dependencies | 1,201 | Many files per directory |
| Mixed deep source/dependencies | 7,401 | Many nested source and package directories |

Both binaries use the same files. After explicit warm-up, three measured rounds
alternate binary order. Every result must match the complete baseline report,
including warnings, projects, findings and retained storage detail; only scan
timestamps, duration and the transient progress path are excluded. The report
comparison is an acceptance check, not merely a byte-total check.

An initial local Linux measurement reduced median scanner time from 247 to
209 ms (flat) and 528 to 289 ms (mixed deep). These warm synthetic results are
not a prediction for Robert's SSD, cold caches, antivirus or real filesystem.
Windows and Linux CI retain exact-revision `scanner-comparison-*.json` evidence
against 0.4.0 commit `eec50f9df34a6c9ed7621e9670edff50371cc092`, compiled with the
same toolchain as the new binary. Timings are reported, not a flaky CI threshold.

## Compact overview

The overview uses the available editor width, smaller recommendation cards and
an expandable reason for each suggestion. Summary and comparison share a row in
wide editors; distribution values and percentages share one compact row per
category. Details remain keyboard accessible and expand without clipping.

Layout tests cover 1440, 1100 and 600 px editor widths after a complete rescan,
including a changed finding. At 1440 × 900 the complete distribution panel must
fit in the first viewport; narrow layouts may scroll vertically and must not
overflow horizontally. Existing theme, navigation and narrow-layout tests remain.
