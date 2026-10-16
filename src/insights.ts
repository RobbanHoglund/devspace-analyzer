import { isProtected } from './analysis';
import type { Finding } from './types';

export function folderName(path: string): string {
  return path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path;
}

/** Presentation guidance uses the scanner's category; it never changes its risk. */
export function findingTitle(finding: Finding): string {
  if (finding.kind === 'gradle-project' && finding.risk !== 'protected') {
    const name = folderName(finding.path);
    if (name === 'build') return 'Gradle build output';
    if (name === '.gradle') return 'Gradle project cache';
  }
  return finding.label;
}

export function reviewStep(finding: Finding, protectedPaths: string[]): string {
  if (isProtected(finding, protectedPaths)) {
    if (finding.risk !== 'protected') return 'Your saved folder preference excludes this location from review suggestions. It still counts toward measured storage; no files have been locked or changed.';
    if (finding.protectedDescendantCount) return 'This location contains protected data. Inspect the protected locations below; do not treat the whole folder as disposable.';
    return finding.recovery;
  }
  if (!finding.complete) return 'Review scan coverage first. Some files could not be measured, so this location is excluded from the review total.';
  switch (finding.kind) {
    case 'gradle-project': return folderName(finding.path) === '.gradle'
      ? 'Check the project cache for custom or tracked files and make sure no build is running. Rebuilding may need to recreate local Gradle state.'
      : 'Check the configured build outputs and look for custom or tracked files before considering changes. A build can recreate conventional output.';
    case 'maven-output': return 'Check pom.xml for custom output locations and inspect target for unique or tracked files. Normal build output can be recreated by a build.';
    case 'gradle-cache': return 'Check Gradle retention settings and your need for offline builds. Dependencies or build results may need to be downloaded or rebuilt.';
    case 'gradle-wrapper': return finding.wrapperReferences.length
      ? 'Review the projects listed below before changing this distribution. They reference this Gradle version; a future build may need to download it again.'
      : 'Check projects outside this scan before changing this distribution. No matching wrapper here does not establish that it is unused.';
    case 'node-modules': return 'Check local/file dependencies, manual patches and package availability against the lockfile before considering a reinstall.';
    case 'node-output': return 'Check the package build configuration and look for custom or tracked files. The folder name alone does not prove that its contents can be rebuilt.';
    case 'python-venv': return 'Check the interpreter, editable/local packages and manually installed dependencies against your lockfile or requirements file.';
    case 'python-bytecode': return 'Confirm the matching source files and required Python interpreter are available. The scanner checked filenames, not source contents.';
    case 'python-tool-cache': return 'Check for custom or tracked files and close running jobs. The owning Python tool normally recreates its cache.';
    default: return finding.recovery;
  }
}

export function reviewCandidates(findings: Finding[], protectedPaths: string[]): Finding[] {
  return findings.filter(f => f.complete && !isProtected(f, protectedPaths) && f.logicalBytes > 0)
    .sort((a, b) => b.logicalBytes - a.logicalBytes || a.path.localeCompare(b.path));
}

export function reviewLabel(finding: Finding, protectedPaths: string[]): string {
  if (isProtected(finding, protectedPaths)) return finding.risk === 'protected' ? 'Preserve this location' : 'Excluded by your preference';
  if (!finding.complete) return 'Resolve coverage first';
  switch (finding.kind) {
    case 'gradle-project': return folderName(finding.path) === '.gradle' ? 'Check project cache' : 'Check custom outputs';
    case 'maven-output': case 'node-output': return 'Check custom outputs';
    case 'gradle-cache': return 'Check retention & offline use';
    case 'gradle-wrapper': return 'Check version references';
    case 'node-modules': return 'Verify reinstall sources';
    case 'python-venv': return 'Verify environment sources';
    case 'python-bytecode': return 'Verify source availability';
    default: return 'Read recovery notes';
  }
}
