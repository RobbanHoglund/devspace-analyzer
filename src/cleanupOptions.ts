import { isProtected, pathsOverlap } from './analysis';
import { pathKey } from './storage';
import type { Finding, Report } from './types';
import type { CleanupAction } from './cleanupTypes';
export const cleanupLabels: Record<CleanupAction, string> = {
  'npm-verify': 'Verify npm cache', 'npm-clean': 'Clear npm package cache', 'pnpm-prune': 'Prune pnpm store', 'pip-purge': 'Purge pip cache',
};
export function cleanupActions(finding: Finding, report: Report): CleanupAction[] {
  const cache = report.globalCaches.find(c => c.kind === finding.kind && pathsOverlap(c.path, finding.path));
  if (!cache) return [];
  if (finding.kind === 'npm-cache' && pathKey(finding.path) === pathKey(`${cache.path}/_cacache`)) return ['npm-verify','npm-clean'];
  if (pathKey(finding.path) !== pathKey(cache.path)) return [];
  return finding.kind === 'pnpm-store' ? ['pnpm-prune'] : finding.kind === 'pip-cache' ? ['pip-purge'] : [];
}
export function cleanupBlocked(finding: Finding, report: Report, protectedPaths: string[]): string {
  if (!report.complete || report.cancelled || !finding.complete) return 'Complete the scan before cleaning a cache.';
  if (isProtected(finding, protectedPaths) || finding.userProtected || finding.protectedDescendantCount || finding.protectedDescendants?.length) return 'Protected locations cannot be cleaned.';
  const cache = report.globalCaches.find(c => c.kind === finding.kind && pathsOverlap(c.path, finding.path));
  if (cache && protectedPaths.some(p => pathsOverlap(p, cache.path))) return 'This cache overlaps a protected location.';
  if (cache && report.projects.some(p => pathsOverlap(p.path, cache.path))) return 'This cache overlaps a project. Use manual review.';
  return '';
}
