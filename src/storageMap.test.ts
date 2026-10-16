import { describe, expect, it } from 'vitest';
import { createStorageMap } from './storageMap';
import { sumEntries } from './treemap';
import { storageMapReport } from '../tests/storage-fixture';

const mib = 1024 ** 2;
describe('nested storage measurements', () => {
  it('keeps child folders, direct files and omitted bytes inside their measured parent', () => {
    const report = storageMapReport();
    report.storage!.directories = report.storage!.directories.filter(d => d.id !== 7);
    const entries = createStorageMap(report, false)(report.storage!.directories[0], 'build').entries;
    expect(sumEntries(entries)).toBe(100 * mib);
    const build = entries.find(e => e.name === 'build')!;
    expect(sumEntries(build.preview!)).toBe(build.value);
    expect(build.preview!.find(e => e.name === 'classes')!.value).toBe(40 * mib);
    expect(build.preview!.find(e => e.kind === 'remainder')!.value).toBe(20 * mib);
    expect(entries.find(e => e.kind === 'filtered')!.value).toBe(39 * mib);
    expect(entries.find(e => e.kind === 'files')!.value).toBe(mib);
  });
  it('applies the same unclassified metric to both levels without reintroducing classified files', () => {
    const report = storageMapReport();
    const root = createStorageMap(report, true)().entries[0];
    expect(root.value).toBe(10 * mib);
    expect(sumEntries(root.preview!)).toBe(10 * mib);
    expect(root.preview!.filter(e => e.kind === 'folder').map(e => e.name).sort()).toEqual(['assets', 'docs', 'src']);
    expect(root.preview!.find(e => e.kind === 'files')!.children!.map(e => e.value)).toEqual([mib / 2, mib / 2]);
  });
  it('declines inconsistent previews and file samples instead of drawing inflated area', () => {
    const report = storageMapReport();
    report.storage!.directories[6].logicalBytes = 80 * mib;
    let contents = createStorageMap(report, false)(report.storage!.directories[0]);
    expect(contents.consistent).toBe(true);
    expect(contents.entries.find(e => e.name === 'build')!.preview).toBeUndefined();
    report.storage!.directories[0].largestFiles[0].logicalBytes = 2 * mib;
    contents = createStorageMap(report, false)(report.storage!.directories[0]);
    expect(contents.entries.find(e => e.kind === 'files')!.children).toBeUndefined();
    expect(sumEntries(contents.entries)).toBe(100 * mib);
  });
});
