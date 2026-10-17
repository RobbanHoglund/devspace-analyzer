import { Icon } from './Icon';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { bytes, visiblePath } from './analysis';
import { findingTitle, folderName } from './insights';
import { pathKey } from './storage';
import { createStorageMap } from './storageMap';
import type { Finding, Report } from './types';
import { StorageTreemap } from './StorageTreemap';
import type { MapEntry } from './treemap';
import { StorageBreadcrumbs } from './StorageBreadcrumbs';

export type StorageView = { path: string | null; unclassified: boolean; query?: string; page?: number; groups?: MapEntry[] };
export function StorageBrowser({ report, view, onChange, onInspect, onReveal }: { report: Report; view: StorageView; onChange: (view: StorageView, record?: boolean) => void; onInspect: (finding: Finding) => void; onReveal?: (id: number) => Promise<void> }) {
  const query = view.query ?? '', page = view.page ?? 0, trail = view.groups ?? [];
  const navigation = useRef<HTMLDivElement>(null);
  const upAction = useRef<() => void>(() => {});
  const setPage = (page: number) => onChange({ ...view, page }, false);
  const setQuery = (query: string) => onChange({ ...view, query, page: 0, groups: [] }, false);
  const heading = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    const element = navigation.current; if (!element) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--storage-navigation-height', `${element.getBoundingClientRect().height}px`));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.key !== 'ArrowUp' || event.defaultPrevented) return;
      if ((event.target as Element).closest('input, textarea, select, [contenteditable=true]')) return;
      event.preventDefault(); upAction.current();
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, []);
  const directories = report.storage?.directories ?? [];
  const byId = useMemo(() => new Map(directories.map(d => [d.id, d])), [directories]);
  const current = view.path === null ? undefined : directories.find(d => pathKey(d.path) === pathKey(view.path!));
  const crumbs = []; let ancestor = current;
  while (ancestor && crumbs.length < 130) { crumbs.unshift(ancestor); ancestor = ancestor.parentId === null ? undefined : byId.get(ancestor.parentId); }
  const findingByPath = useMemo(() => new Map(report.findings.map(f => [pathKey(f.path), f])), [report.findings]);
  const contents = useMemo(() => createStorageMap(report, view.unclassified), [report, view.unclassified]);
  const { entries: mapEntries, total: totalMetric, directBytes, samples, unsampledBytes, remainder, consistent } = contents(current, query);
  const focusMap = () => requestAnimationFrame(() => {
    const title = document.getElementById('storage-map-title') ?? heading.current;
    title?.focus({ preventScroll: true }); title?.scrollIntoView({ block: 'start' });
  });
  const go = (path: string | null) => { if (path === view.path && !trail.length && !query) return; onChange({ ...view, path, query: '', page: 0, groups: [] }); focusMap(); };
  const openGroup = (groups: MapEntry[]) => { if (groups.length === trail.length && groups.every((group, index) => group.id === trail[index].id)) return; onChange({ ...view, groups, page: 0 }); focusMap(); };
  const up = () => { if (trail.length) openGroup(trail.slice(0, -1)); else if (current) go(current.parentId === null ? null : byId.get(current.parentId)?.path ?? null); };
  upAction.current = up;
  const breadcrumbs = [
    { key: 'roots', label: 'All locations', title: 'All scanned locations', onSelect: () => go(null) },
    ...crumbs.map(d => ({ key: `folder-${d.id}`, label: folderName(d.path), title: visiblePath(d.path), onSelect: () => go(d.path) })),
    ...trail.map((group, index) => ({ key: `group-${index}-${group.id}`, label: group.name, title: `${group.name} · group within this folder`, onSelect: () => openGroup(trail.slice(0, index + 1)) })),
  ];
  return <section className="storage-browser panel" aria-label="Storage breakdown">
    <div ref={navigation} className="storage-navigation">
      <div className="storage-location-bar"><button className="storage-up" aria-label="Up one level" title="Up to the parent folder or group (Alt+Up)" disabled={!current && !trail.length} onClick={up}><Icon name="up"/>Up</button><StorageBreadcrumbs crumbs={breadcrumbs}/></div>
      <div className="storage-heading"><h2 ref={heading} tabIndex={-1}>{trail.at(-1)?.name ?? (current ? folderName(current.path) : 'All scanned locations')}</h2><strong>{bytes(trail.at(-1)?.value ?? totalMetric)}<small>{trail.length ? 'in this group' : view.unclassified ? 'other measured files' : 'measured here'}</small></strong></div>
    </div>
    {!directories.length ? <div className="storage-empty"><h3>Run a new scan to capture the folder breakdown.</h3><p>{report.storage ? 'No folder detail was captured in this scan. Check scan coverage before trying again.' : 'This older report contains category totals only. No folder sizes have been inferred.'}</p></div> : <>
      {current && <div className="storage-location"><span className="mono" title={visiblePath(current.path)}>{visiblePath(current.path)}</span><button disabled={!onReveal} onClick={() => void onReveal?.(current.id)}><Icon name="folder"/>Show in file manager</button></div>}
      <div className="storage-view-options"><label><input type="checkbox" checked={view.unclassified} onChange={e => { onChange({ ...view, unclassified: e.target.checked, groups: [], page: 0 }); focusMap(); }}/>Other measured files only</label><input aria-label="Filter child folders" placeholder="Filter folders here…" value={query} onChange={e => setQuery(e.target.value)}/></div>
      {view.unclassified && <p className="storage-note">These files did not match a supported developer-storage category. Their contents and recoverability have not been assessed.</p>}
      {current && !current.complete && <p className="storage-note">Partial measurement: unread or skipped files are not included.</p>}
      <StorageTreemap key={`${current?.id ?? 'roots'}-${view.unclassified}-${query}-${trail.map(group => group.id).join('/')}`}
        entries={mapEntries} trail={trail} onTrailChange={openGroup} page={page} onPageChange={setPage} consistent={consistent}
        renderReview={entry => {
          const finding = entry.path ? findingByPath.get(pathKey(entry.path)) : undefined;
          return finding && <button className="storage-review" onClick={() => onInspect(finding)}><Icon name="search"/>Review {findingTitle(finding)}</button>;
        }}
        onOpen={(entry, parent) => {
          if (entry.kind === 'filtered') setQuery('');
          else if (entry.path) go(entry.path);
          else if (parent?.path && entry.children?.length) {
            onChange({ ...view, path: parent.path, query: '', page: 0, groups: [entry] }); focusMap();
          }
        }}/>
      {current && !trail.length && <section className="direct-files" aria-label="Files directly in this folder"><div className="section-heading"><h3>Files directly here</h3><strong>{bytes(directBytes)}</strong></div><p className="muted">{current.directFiles.toLocaleString()} direct files in total · up to five large file samples, captured during the scan.</p>{samples.map(file => <div className="storage-file" key={file.name}><span>{file.name}</span><strong>{bytes(file.logicalBytes)}</strong></div>)}{unsampledBytes > 0 && <div className="storage-file"><span>Other direct files</span><strong>{bytes(unsampledBytes)}</strong></div>}</section>}
      {remainder > 0 && <p className="storage-note"><strong>{bytes(remainder)} in folders without retained detail.</strong> Scan a narrower folder to explore those bytes. They remain included in the measured total.</p>}
      {!!current?.omittedDirectories && <p className="tiny muted">{current.omittedDirectories.toLocaleString()} child folders have no retained breakdown. Choose one as a narrower scan root to capture its detail.</p>}
      {report.storage?.truncated && <p className="tiny muted">Folder or file-sample detail reached the retention limit. The scan still measures the remaining entries; missing detail is included in the totals.</p>}
    </>}
  </section>;
}
