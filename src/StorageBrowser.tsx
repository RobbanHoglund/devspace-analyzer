import { useMemo, useRef, useState } from 'react';
import { bytes, visiblePath } from './analysis';
import { findingTitle, folderName } from './insights';
import { pathKey, unclassifiedIn } from './storage';
import type { Finding, Report, StorageDirectory } from './types';
import { StorageTreemap } from './StorageTreemap';
import type { MapEntry } from './treemap';

export type StorageView = { path: string | null; unclassified: boolean };
export function StorageBrowser({ report, view, onChange, onInspect, onReveal }: { report: Report; view: StorageView; onChange: (view: StorageView) => void; onInspect: (finding: Finding) => void; onReveal?: (id: number) => Promise<void> }) {
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const directories = report.storage?.directories ?? [];
  const byId = useMemo(() => new Map(directories.map(d => [d.id, d])), [directories]);
  const current = view.path === null ? undefined : directories.find(d => pathKey(d.path) === pathKey(view.path!));
  const crumbs = []; let ancestor = current;
  while (ancestor && crumbs.length < 130) { crumbs.unshift(ancestor); ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId); }
  const findingByPath = useMemo(() => new Map(report.findings.map(f => [pathKey(f.path), f])), [report.findings]);
  const metric = (d: StorageDirectory) => view.unclassified ? Math.max(0, d.logicalBytes - d.classifiedBytes) : d.logicalBytes;
  const children = directories.filter(d => d.parentId === (current?.id ?? null));
  const rows = children.filter(d => (!view.unclassified || metric(d) > 0) && d.path.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => metric(b) - metric(a) || a.path.localeCompare(b.path));
  const shownPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  const total = current?.logicalBytes ?? report.progress.logicalBytes;
  const totalMetric = current ? metric(current) : view.unclassified ? Math.max(0, total - report.findings.reduce((n, f) => n + f.logicalBytes, 0)) : total;
  const directBytes = current ? Math.max(0, current.directFileBytes - (view.unclassified ? current.directClassifiedBytes : 0)) : 0;
  const retainedChildren = children.reduce((n, d) => n + metric(d), 0);
  const remainder = Math.max(0, totalMetric - retainedChildren - directBytes);
  const samples = current?.largestFiles.filter(file => !view.unclassified || unclassifiedIn(`${current.path}/${file.name}`, file.logicalBytes, report.findings) > 0) ?? [];
  const unsampledBytes = Math.max(0, directBytes - samples.reduce((n, file) => n + file.logicalBytes, 0));
  const go = (path: string | null) => { onChange({ ...view, path }); setQuery(''); setPage(0); requestAnimationFrame(() => heading.current?.focus({ preventScroll: true })); };
  const mapEntries: MapEntry[] = rows.filter(d => metric(d) > 0).map(d => ({ id: `folder-${d.id}`, name: folderName(d.path), path: d.path, kind: 'folder', value: metric(d), partial: !d.complete, detail: `${d.files.toLocaleString()} files · open this folder to see its contents.` }));
  const filteredBytes = retainedChildren - rows.reduce((n, d) => n + metric(d), 0);
  if (filteredBytes > 0) mapEntries.push({ id: 'filtered', name: 'Filtered-out folders', value: filteredBytes, kind: 'filtered', detail: 'These bytes belong to folders hidden by your search. Click to clear the filter.' });
  if (directBytes > 0) mapEntries.push({ id: 'direct-files', name: 'Files directly here', value: directBytes, kind: 'files', detail: 'Explore retained file samples. These are files in this folder, not child folders.', children: [
    ...samples.map(file => ({ id: `file-${file.name}`, name: file.name, value: file.logicalBytes, kind: 'file' as const, detail: 'File-size sample from the scan. Contents and recoverability were not assessed.' })),
    ...(unsampledBytes > 0 ? [{ id: 'other-direct-files', name: 'Other direct files', value: unsampledBytes, kind: 'remainder' as const, detail: 'Measured direct-file bytes outside the retained samples. Included in the total.' }] : []),
  ] });
  if (remainder > 0) mapEntries.push({ id: 'unretained', name: 'Folders without detail', value: remainder, kind: 'remainder', detail: 'These bytes were measured, but folder detail was not retained. Scan a narrower folder to explore them.' });
  return <section className="storage-browser panel" aria-label="Storage breakdown">
    <div className="section-heading"><div><h2 ref={heading} tabIndex={-1}>Follow the space</h2><p className="muted">Explore the map, then inspect exact sizes in the folder list.</p></div><label><input type="checkbox" checked={view.unclassified} onChange={e => { onChange({ ...view, unclassified: e.target.checked }); setPage(0); }}/>Other measured files only</label></div>
    {!directories.length ? <div className="storage-empty"><h3>Run a new scan to capture the folder breakdown.</h3><p>{report.storage ? 'No folder detail was captured in this scan. Check scan coverage before trying again.' : 'This older report contains category totals only. No folder sizes have been inferred.'}</p></div> : <>
      <nav className="storage-crumbs" aria-label="Storage path">{current && <button aria-label="Up one folder level" onClick={() => go(current.parentId === null ? null : byId.get(current.parentId)?.path ?? null)}>↑ Up</button>}<button onClick={() => go(null)}>All scanned locations</button>{crumbs.map(d => <button key={d.id} aria-current={current?.id === d.id ? 'location' : undefined} title={visiblePath(d.path)} onClick={() => go(d.path)}>{folderName(d.path)}</button>)}</nav>
      <div className="storage-total"><div><strong>{bytes(totalMetric)}</strong><span>{view.unclassified ? 'Other measured files' : 'Measured in this location'}</span></div><input aria-label="Filter child folders" placeholder="Filter folders here…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div>
      {current && <div className="storage-location"><span className="mono">{visiblePath(current.path)}</span><button disabled={!onReveal} onClick={() => void onReveal?.(current.id)}>Open folder</button></div>}
      {view.unclassified && <p className="storage-note">These files did not match a supported developer-storage category. Their contents and recoverability have not been assessed.</p>}
      {current && !current.complete && <p className="storage-note">Partial measurement: unread or skipped files are not included.</p>}
      {retainedChildren + directBytes <= totalMetric ? <StorageTreemap key={`${current?.id ?? 'roots'}-${view.unclassified}-${query}`} entries={mapEntries} onOpen={entry => { if (entry.kind === 'filtered') { setQuery(''); setPage(0); } else if (entry.path) go(entry.path); }}/> : <p className="storage-note">The retained folder sizes do not match this report’s total. Run a new scan to show a reliable map.</p>}
      <div className="storage-list-heading"><h3>Folder details</h3><span>{rows.length.toLocaleString()} child {rows.length === 1 ? 'folder' : 'folders'} · largest first</span></div>
      <div className="storage-rows">{rows.slice(shownPage * 50, shownPage * 50 + 50).map(d => {
        const value = metric(d);
        const finding = findingByPath.get(pathKey(d.path));
        return <div className="storage-row" key={d.id}><button className="storage-folder" onClick={() => go(d.path)}><span>{folderName(d.path)} <span aria-hidden="true">›</span></span><small>{d.files.toLocaleString()} files{!d.complete ? ' · partial' : ''}</small></button><span className="storage-size">{bytes(value)}<span className="storage-meter" aria-hidden="true"><i style={{ width: `${totalMetric ? Math.min(100, value / totalMetric * 100) : 0}%` }}/></span></span>{finding && <button className="storage-review" onClick={() => onInspect(finding)}>Review {findingTitle(finding)}</button>}</div>;
      })}{!rows.length && <p className="muted">{query ? 'No child folders match.' : 'No retained child folders in this view.'}</p>}</div>
      {rows.length > 50 && <div className="pagination"><span>{shownPage * 50 + 1}–{Math.min(rows.length, (shownPage + 1) * 50)} of {rows.length} folders</span><div><button disabled={!shownPage} onClick={() => setPage(shownPage - 1)}>Previous</button><button disabled={(shownPage + 1) * 50 >= rows.length} onClick={() => setPage(shownPage + 1)}>Next</button></div></div>}
      {current && <section className="direct-files" aria-label="Files directly in this folder"><div className="section-heading"><h3>Files directly here</h3><strong>{bytes(directBytes)}</strong></div><p className="muted">{current.directFiles.toLocaleString()} direct files in total · up to five large file samples, captured during the scan.</p>{samples.map(file => <div className="storage-file" key={file.name}><span>{file.name}</span><strong>{bytes(file.logicalBytes)}</strong></div>)}{unsampledBytes > 0 && <div className="storage-file"><span>Other direct files</span><strong>{bytes(unsampledBytes)}</strong></div>}</section>}
      {remainder > 0 && <p className="storage-note"><strong>{bytes(remainder)} in folders without retained detail.</strong> Scan a narrower folder to explore those bytes. They remain included in the measured total.</p>}
      {!!current?.omittedDirectories && <p className="tiny muted">{current.omittedDirectories.toLocaleString()} child folders have no retained breakdown. Choose one as a narrower scan root to capture its detail.</p>}
      {report.storage?.truncated && <p className="tiny muted">Folder or file-sample detail reached the retention limit. The scan still measures the remaining entries; missing detail is included in the totals.</p>}
    </>}
  </section>;
}
