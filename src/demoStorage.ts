import { inside, pathKey } from './storage';
import type { Finding, Report, StorageDirectory } from './types';

/** Synthetic hierarchy for the explicitly labelled demo; never used for real reports. */
export function demoStorage(roots: string[], findings: Finding[], otherPath: string, otherBytes: number): NonNullable<Report['storage']> {
  const directories: StorageDirectory[] = [];
  const index = new Map<string, StorageDirectory>();
  const add = (path: string): StorageDirectory => {
    const normalized = path.replaceAll('\\', '/');
    const existing = index.get(pathKey(path)); if (existing) return existing;
    const parentPath = normalized.slice(0, normalized.lastIndexOf('/'));
    const parent = roots.some(r => pathKey(r) === pathKey(path)) ? null : add(parentPath);
    const node: StorageDirectory = { id: directories.length, parentId: parent?.id ?? null, path: normalized, logicalBytes: 0, classifiedBytes: 0, directClassifiedBytes: 0, files: 0, directFileBytes: 0, directFiles: 0, largestFiles: [], complete: true, omittedDirectories: 0 };
    directories.push(node); index.set(pathKey(path), node); return node;
  };
  roots.forEach(add);
  for (const entry of [...findings.map(f => ({ path: f.path, bytes: f.logicalBytes, files: f.files, classified: true })), { path: otherPath, bytes: otherBytes, files: 3, classified: false }]) {
    if (!roots.some(r => inside(entry.path, r))) continue;
    const node = add(entry.path);
    node.directFileBytes = entry.bytes; node.directFiles = entry.files; node.directClassifiedBytes = entry.classified ? entry.bytes : 0;
    node.largestFiles = [{ name: entry.classified ? 'example-output.bin' : 'application.log', logicalBytes: Math.floor(entry.bytes * .6) }, { name: entry.classified ? 'example-data.bin' : 'previous-run.log', logicalBytes: Math.floor(entry.bytes * .3) }];
    let cursor: StorageDirectory | undefined = node;
    while (cursor) { cursor.logicalBytes += entry.bytes; cursor.files += entry.files; if (entry.classified) cursor.classifiedBytes += entry.bytes; cursor = cursor.parentId === null ? undefined : directories[cursor.parentId]; }
  }
  return { directories, truncated: false };
}
