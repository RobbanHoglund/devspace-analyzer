import { visiblePath } from './analysis';
export interface ScanScope { roots: string[]; includeCaches: boolean }
export function scopeKey(scope: ScanScope): string {
  const paths = scope.roots.map(path => {
    const normalized = visiblePath(path).replaceAll('\\', '/').replace(/\/+$/, '');
    return /^[a-z]:/i.test(normalized) ? normalized.toLowerCase() : normalized;
  });
  return JSON.stringify({ roots: [...new Set(paths)].sort(), includeCaches: scope.includeCaches });
}
