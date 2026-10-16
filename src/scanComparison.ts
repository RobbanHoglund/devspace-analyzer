import { scopeKey, type ScanScope } from './scanScope';
import { pathKey } from './storage';
import type { Report } from './types';

export interface ScanSnapshot {
  format: 1; reportVersion: number; startedAt: number; logicalBytes: number; unclassifiedBytes: number;
  scope: ScanScope; effectiveRoots: string[]; allFindings: boolean;
  findings: { path: string; logicalBytes: number }[];
}
const MAX_SNAPSHOT = 1_500_000;
const MAX_FINDINGS = 5000;
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const paths = (value: unknown): value is string[] => Array.isArray(value) && value.length <= 128 && value.every(p => typeof p === 'string' && p.length <= 32768);

export function readSnapshot(value: unknown): ScanSnapshot | null {
  if (!record(value) || value.format !== 1 || !count(value.reportVersion) || !count(value.startedAt) || !count(value.logicalBytes) || !count(value.unclassifiedBytes) || value.unclassifiedBytes > value.logicalBytes
    || !record(value.scope) || !paths(value.scope.roots) || typeof value.scope.includeCaches !== 'boolean' || !paths(value.effectiveRoots)
    || typeof value.allFindings !== 'boolean' || !Array.isArray(value.findings) || value.findings.length > MAX_FINDINGS
    || !value.findings.every(f => record(f) && typeof f.path === 'string' && f.path.length <= 32768 && count(f.logicalBytes))) return null;
  if (JSON.stringify(value).length > MAX_SNAPSHOT) return null;
  const entries = value.findings as { path: string; logicalBytes: number }[];
  if (new Set(entries.map(f => pathKey(f.path))).size !== entries.length || entries.reduce((n, f) => n + f.logicalBytes, 0) > value.logicalBytes) return null;
  return value as unknown as ScanSnapshot;
}
export function makeSnapshot(report: Report, scope: ScanScope): ScanSnapshot | null {
  if (!report.complete || report.cancelled || !count(report.progress.logicalBytes)) return null;
  const identified = report.findings.reduce((n, f) => n + f.logicalBytes, 0);
  if (!count(identified) || identified > report.progress.logicalBytes) return null;
  const result: ScanSnapshot = { format: 1, reportVersion: report.schemaVersion, startedAt: report.startedAt, logicalBytes: report.progress.logicalBytes,
    unclassifiedBytes: report.progress.logicalBytes - identified, scope: { roots: [...scope.roots], includeCaches: scope.includeCaches }, effectiveRoots: [...report.roots], allFindings: true, findings: [] };
  let length = JSON.stringify(result).length;
  for (const f of [...report.findings].sort((a, b) => b.logicalBytes - a.logicalBytes || a.path.localeCompare(b.path))) {
    const entry = { path: f.path, logicalBytes: f.logicalBytes };
    const cost = JSON.stringify(entry).length + 1;
    if (result.findings.length >= MAX_FINDINGS || length + cost > MAX_SNAPSHOT - 32) { result.allFindings = false; break; }
    result.findings.push(entry); length += cost;
  }
  return readSnapshot(result);
}
export function comparisonUnavailable(report: Report, scope: ScanScope | null, previous: ScanSnapshot | null): string | null {
  if (!report.complete || report.cancelled) return 'This scan is incomplete. Complete the same scope before comparing sizes; unread files must not appear as savings.';
  if (!previous) return 'Baseline captured. Make a reviewed change, then scan the same folders again to measure the difference.';
  if (!scope || scopeKey(scope) !== scopeKey(previous.scope) || scopeKey({ roots: report.roots, includeCaches: scope.includeCaches }) !== scopeKey({ roots: previous.effectiveRoots, includeCaches: previous.scope.includeCaches })) return 'The scan scope changed. A comparison needs the same folders and shared-cache setting. This complete scan becomes the next baseline.';
  if (previous.reportVersion !== report.schemaVersion) return 'The scanner report format changed. This complete scan becomes a fresh baseline for the next comparison.';
  if (!makeSnapshot(report, scope)) return 'These totals cannot be compared reliably. Run another complete scan.';
  return null;
}
export function findingChanges(report: Report, previous: ScanSnapshot) {
  const before = new Map(previous.findings.map(f => [pathKey(f.path), f]));
  const after = new Map(report.findings.map(f => [pathKey(f.path), f]));
  return [...new Set([...before.keys(), ...after.keys()])].flatMap(key => {
    const old = before.get(key), current = after.get(key);
    if (!old && !previous.allFindings) return [];
    const delta = (current?.logicalBytes ?? 0) - (old?.logicalBytes ?? 0);
    return delta ? [{ path: current?.path ?? old!.path, delta, current, status: !current ? 'No longer classified here' : !old ? 'Newly classified here' : 'Size changed' }] : [];
  }).sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.path.localeCompare(b.path));
}
