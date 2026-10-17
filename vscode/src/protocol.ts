import * as path from 'node:path';
import type { Report, Progress } from '../../src/types';

export interface ScanRequest { roots: string[]; includeGlobalCaches: boolean; protectedPaths: string[] }
export function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function paths(value: unknown, max: number): string[] {
  if (!Array.isArray(value) || value.length > max || value.some(p => typeof p !== 'string' || !p || p.length > 32768 || p.includes('\0') || !path.isAbsolute(p))) {
    throw new Error(`Choose up to ${max} absolute local folder paths.`);
  }
  return [...new Set(value)] as string[];
}
export function scanRequest(value: unknown): ScanRequest {
  if (!record(value) || typeof value.includeGlobalCaches !== 'boolean') throw new Error('Invalid scan request.');
  const request = { roots: paths(value.roots, 32), protectedPaths: paths(value.protectedPaths, 20000), includeGlobalCaches: value.includeGlobalCaches };
  if (!request.roots.length && !request.includeGlobalCaches) throw new Error('Choose a folder or include known shared caches.');
  if (Buffer.byteLength(JSON.stringify({ protocolVersion: 1, request })) > 2 * 1024 * 1024 - 1) throw new Error('Scan preferences exceed 2 MiB. Reduce the selected paths.');
  return request;
}
const count = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
export function isProgress(value: unknown): value is Progress {
  return record(value) && ['files', 'directories', 'logicalBytes', 'projects'].every(key => count(value[key])) && typeof value.currentPath === 'string';
}
export function isReport(value: unknown): value is Report {
  return record(value) && (value.schemaVersion === 1 || value.schemaVersion === 2) && isProgress(value.progress)
    && typeof value.complete === 'boolean' && typeof value.cancelled === 'boolean'
    && count(value.startedAt) && count(value.durationMs) && count(value.warningCount)
    && Array.isArray(value.roots) && value.roots.every(p => typeof p === 'string')
    && Array.isArray(value.findings) && value.findings.length <= 20000
    && value.findings.every(f => record(f) && typeof f.id === 'string' && typeof f.path === 'string')
    && Array.isArray(value.projects) && value.projects.length <= 10000
    && Array.isArray(value.warnings) && value.warnings.length <= 500
    && (value.storage === undefined || record(value.storage) && typeof value.storage.truncated === 'boolean' && Array.isArray(value.storage.directories) && value.storage.directories.length <= 10128
      && value.storage.directories.every(d => record(d) && count(d.id) && (d.parentId === null || count(d.parentId)) && typeof d.path === 'string' && ['logicalBytes', 'classifiedBytes', 'directClassifiedBytes', 'directFileBytes', 'files', 'directFiles', 'omittedDirectories'].every(k => count(d[k])) && typeof d.complete === 'boolean' && Array.isArray(d.largestFiles) && d.largestFiles.length <= 5 && d.largestFiles.every(f => record(f) && typeof f.name === 'string' && count(f.logicalBytes))))
    && Array.isArray(value.globalCaches) && Array.isArray(value.limitations);
}
