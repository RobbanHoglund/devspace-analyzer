import type { Finding, Report, StorageDirectory } from './types';

export function pathKey(path: string): string {
  const value = path.replaceAll('\\', '/').replace(/^\/\/\?\//, '').replace(/\/+$/, '') || '/';
  return /^[a-z]:\//i.test(value) ? value.toLowerCase() : value;
}
export function inside(path: string, root: string): boolean {
  const p = pathKey(path), r = pathKey(root);
  return p === r || p.startsWith(r.endsWith('/') ? r : `${r}/`);
}
export function unclassifiedIn(path: string, size: number, findings: Finding[]): number {
  if (findings.some(f => inside(path, f.path))) return 0;
  return Math.max(0, size - findings.filter(f => inside(f.path, path)).reduce((sum, f) => sum + f.logicalBytes, 0));
}
export function directoryFor(report: Report, path: string): StorageDirectory | undefined {
  const key = pathKey(path);
  return report.storage?.directories.find(d => pathKey(d.path) === key);
}
