import { folderName } from './insights';
import { unclassifiedIn } from './storage';
import { sumEntries, type MapEntry } from './treemap';
import type { Report, StorageDirectory, StorageFile } from './types';

interface FolderContents {
  entries: MapEntry[]; total: number; directBytes: number; samples: StorageFile[];
  unsampledBytes: number; remainder: number; consistent: boolean;
}

/** Index once; only retain one extra directory level for the visual preview. */
export function createStorageMap(report: Report, unclassified: boolean) {
  const byParent = new Map<number | null, StorageDirectory[]>();
  for (const directory of report.storage?.directories ?? []) {
    const siblings = byParent.get(directory.parentId) ?? [];
    siblings.push(directory); byParent.set(directory.parentId, siblings);
  }
  const metric = (d: StorageDirectory) => unclassified ? Math.max(0, d.logicalBytes - d.classifiedBytes) : d.logicalBytes;
  const contents = (current?: StorageDirectory, query = '', preview = true): FolderContents => {
    const total = current ? metric(current) : Math.max(0, report.progress.logicalBytes - (unclassified ? report.findings.reduce((n, f) => n + f.logicalBytes, 0) : 0));
    const children = byParent.get(current?.id ?? null) ?? [];
    const rows = children.filter(d => (!unclassified || metric(d) > 0) && d.path.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => metric(b) - metric(a) || a.path.localeCompare(b.path));
    const directBytes = current ? Math.max(0, current.directFileBytes - (unclassified ? current.directClassifiedBytes : 0)) : 0;
    const retained = children.reduce((n, d) => n + metric(d), 0);
    const remainder = Math.max(0, total - retained - directBytes);
    const samples = current?.largestFiles.flatMap(file => {
      const value = unclassified ? unclassifiedIn(`${current.path}/${file.name}`, file.logicalBytes, report.findings) : file.logicalBytes;
      return value > 0 ? [{ ...file, logicalBytes: value }] : [];
    }) ?? [];
    const sampledBytes = samples.reduce((n, f) => n + f.logicalBytes, 0);
    const unsampledBytes = Math.max(0, directBytes - sampledBytes);
    const entries: MapEntry[] = rows.map((d, index) => {
      const child = preview && index < 20 && metric(d) > 0 ? contents(d, '', false) : undefined;
      return { id: `folder-${d.id}`, name: folderName(d.path), path: d.path, kind: 'folder', value: metric(d), files: d.files, partial: !d.complete,
        detail: `${d.files.toLocaleString()} files · open this folder to see its contents.`,
        preview: child?.consistent ? child.entries : undefined };
    });
    const filtered = retained - rows.reduce((n, d) => n + metric(d), 0);
    if (filtered > 0) entries.push({ id: 'filtered', name: 'Filtered-out folders', value: filtered, kind: 'filtered', detail: 'These bytes belong to folders hidden by your search. Click to clear the filter.' });
    if (directBytes > 0) entries.push({ id: 'direct-files', name: 'Files directly here', value: directBytes, kind: 'files', detail: 'Explore retained file samples. These are files in this folder, not child folders.', children: sampledBytes <= directBytes ? [
      ...samples.map(file => ({ id: `file-${file.name}`, name: file.name, value: file.logicalBytes, kind: 'file' as const, detail: 'File-size sample from the scan. Contents and recoverability were not assessed.' })),
      ...(unsampledBytes > 0 ? [{ id: 'other-direct-files', name: 'Other direct files', value: unsampledBytes, kind: 'remainder' as const, detail: 'Measured direct-file bytes outside the retained samples. Included in the total.' }] : []),
    ] : undefined });
    if (remainder > 0) entries.push({ id: 'unretained', name: 'Folders without detail', value: remainder, kind: 'remainder', detail: 'These bytes were measured, but folder detail was not retained. Scan a narrower folder to explore them.' });
    return { entries, total, directBytes, samples, unsampledBytes, remainder, consistent: retained + directBytes <= total && sumEntries(entries) === total };
  };
  return contents;
}
