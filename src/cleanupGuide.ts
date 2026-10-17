import { isProtected, pathsOverlap, visiblePath } from './analysis';
import { pathKey } from './storage';
import type { Finding, Report } from './types';

export type CacheAction = 'npm-verify' | 'npm-clean' | 'pnpm-prune' | 'pip-purge';
export const cacheActions: Record<CacheAction, { title: string; effect: string; recovery: string; documentation: string }> = {
  'npm-verify': { title: 'Verify and compact npm cache', effect: 'Checks cache integrity and removes unneeded data. This changes the cache; it is not a dry run.', recovery: 'npm can download missing packages again. Verification usually keeps reusable package data.', documentation: 'https://docs.npmjs.com/cli/v11/commands/npm-cache/' },
  'npm-clean': { title: 'Clear npm package cache', effect: 'Removes cached package data in _cacache. Use this when you need disk space; routine npm troubleshooting rarely needs a full clear.', recovery: 'Future installs need to download packages again. Offline installs may fail until the cache has been rebuilt.', documentation: 'https://docs.npmjs.com/cli/v11/commands/npm-cache/' },
  'pnpm-prune': { title: 'Prune pnpm store', effect: 'Asks pnpm to remove data it considers unreferenced. The installed pnpm version determines which store version and shared store data it maintains.', recovery: 'Later installs or branch changes may need to download removed packages again. Hardlinks mean logical size is not a promise of freed disk space.', documentation: 'https://pnpm.io/cli/store' },
  'pip-purge': { title: 'Purge pip cache', effect: 'Removes cached HTTP downloads and built wheels from this cache. Installed Python environments are separate.', recovery: 'Future installs need downloads and may need to build wheels again. Offline installs can be affected.', documentation: 'https://pip.pypa.io/en/stable/cli/pip_cache/' },
};

export function cacheFor(finding: Finding, report: Report) {
  return report.globalCaches.find(c => c.kind === finding.kind && pathKey(finding.path) === pathKey(finding.kind === 'npm-cache' ? `${c.path}/_cacache` : c.path));
}
export function guidanceActions(finding: Finding, report: Report): CacheAction[] {
  if (!cacheFor(finding, report)) return [];
  return finding.kind === 'npm-cache' ? ['npm-verify', 'npm-clean'] : finding.kind === 'pnpm-store' ? ['pnpm-prune'] : finding.kind === 'pip-cache' ? ['pip-purge'] : [];
}
export function guidanceBlocked(finding: Finding, report: Report, protectedPaths: string[]): string {
  if (isProtected(finding, protectedPaths) || finding.userProtected || finding.protectedDescendantCount || finding.protectedDescendants?.length) return 'This location is protected. Preserve its contents; no cleanup command is suggested.';
  if (!finding.complete) return 'This cache was only partly measured. Resolve its coverage warnings and scan again before considering cleanup.';
  const cache = cacheFor(finding, report);
  if (!cache) return 'The complete cache location was not identified. Inspect the tool’s configuration first.';
  if (protectedPaths.some(p => pathsOverlap(p, cache.path)) || report.findings.some(f => isProtected(f, protectedPaths) && pathsOverlap(f.path, cache.path))) return 'The command’s cache scope overlaps protected data. No cleanup command is suggested.';
  if (report.projects.some(p => pathsOverlap(p.path, cache.path))) return 'This cache overlaps a project. Inspect its configuration and preserve project files first.';
  return '';
}

/** Copy-only shell text. No subprocess, tool discovery or host execution endpoint. */
export function cacheCommand(action: CacheAction, rawPath: string): { text: string; shell: string; check: string } | null {
  const path = visiblePath(rawPath);
  const windows = /^[a-z]:[/\\]/i.test(path);
  // cmd launchers reparse arguments on Windows. Do not offer commands for paths
  // whose metacharacters could be expanded even after PowerShell quoting.
  if (/[\u0000-\u001f\u007f]/.test(path) || (windows && /["%!*?^&|<>`]/.test(path))) return null;
  if (!(windows ? /^[a-z]:[/\\].+/i : /^\/[^/]/).test(path) || path.split(/[/\\]/).some(p => p === '..' || p === '.')) return null;
  const quote = (value: string) => `'${value.replaceAll("'", windows ? "''" : "'\"'\"'")}'`;
  const render = (tool: string, args: string[]) => `${tool} ${args.map(arg => /^[a-zA-Z0-9_.=-]+$/.test(arg) ? arg : quote(arg)).join(' ')}`;
  const shell = windows ? 'PowerShell' : 'POSIX shell (bash / zsh)';
  if (action.startsWith('npm-')) {
    const tool = windows ? 'npm.cmd' : 'npm';
    const options = [`--cache=${path}`, '--logs-max=0'];
    return { shell, text: render(tool, [...options, 'cache', action === 'npm-verify' ? 'verify' : 'clean', ...(action === 'npm-clean' ? ['--force'] : [])]), check: render(tool, [options[0], 'config', 'get', 'cache']) };
  }
  if (action === 'pnpm-prune') {
    const tool = windows ? 'pnpm.cmd' : 'pnpm';
    const options = [`--store-dir=${path}`];
    return { shell, text: render(tool, [...options, 'store', 'prune']), check: render(tool, [...options, 'store', 'path']) };
  }
  const tool = windows ? 'python' : 'python3';
  const options = ['-m', 'pip', `--cache-dir=${path}`];
  return { shell, text: render(tool, [...options, 'cache', 'purge']), check: render(tool, [...options, 'cache', 'dir']) };
}
