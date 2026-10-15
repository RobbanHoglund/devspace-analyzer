import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-dialog';
import type { Finding, Progress, Report, Risk } from './types';
import { bytes, effectiveRisk, findingsForProject, isProtected, markdownReport, pathsOverlap, redactedReport, summarize, treemap, visiblePath } from './analysis';
import { demoReport } from './demo';
import { pageBounds } from './pagination';
import { scopeKey, type ScanScope } from './scanScope';
import { ProtectionControls } from './ProtectionControls';

type Tab = 'overview' | 'findings' | 'projects' | 'coverage';
type FindingView = {query: string; eco: string; risk: string; projectFilter: string; sort: string; page: number; selected: string | null};
const labels: Record<Risk, string> = { low: 'Lower risk', review: 'Needs review', protected: 'Protected' };
const native = isTauri();
const zero: Progress = { files: 0, directories: 0, logicalBytes: 0, projects: 0, currentPath: '' };
function readPreference(key: string): string[] {
  try { const value: unknown = JSON.parse(localStorage.getItem(key) ?? '[]'); return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && v.length <= 32768).slice(0, 20000) : []; } catch { return []; }
}
function Icon({ name }: { name: string }) {
  const paths: Record<string, string> = {
    grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1',
    folder: 'M3 7V4h6l3 3h9v13H3z',
    shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
    scan: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 12h10',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
    close: 'M6 6l12 12 M6 18L18 6',
  };
  return <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name] ?? paths.grid}/></svg>;
}
function Badge({ risk }: { risk: Risk }) { return <span className={`badge risk-${risk}`}>{risk === 'protected' ? '◈ ' : '• '}{labels[risk]}</span>; }

export default function App() {
  const findingButtons = useRef(new Map<string, HTMLButtonElement>());
  const detailTitleRef = useRef<HTMLHeadingElement>(null);
  const drawerRef = useRef<HTMLDialogElement>(null);
  const [compactDetails, setCompactDetails] = useState(() => window.matchMedia('(max-width:1250px)').matches);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [scopeExpanded, setScopeExpanded] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const [roots, setRoots] = useState<string[]>(() => readPreference('devspace.roots').slice(0, 32));
  const [protectedPaths, setProtectedPaths] = useState<string[]>(() => readPreference('devspace.protected'));
  const [demoProtected, setDemoProtected] = useState<string[]>([]);
  const [includeCaches, setIncludeCaches] = useState(true);
  const [manualRoot, setManualRoot] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [reportScope, setReportScope] = useState<ScanScope | null>(null);
  const [previousReport, setPreviousReport] = useState(false);
  const [origin, setOrigin] = useState<'native' | 'demo'>('native');
  const [tab, setTab] = useState<Tab>('overview');
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [progress, setProgress] = useState<Progress>(zero);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQueryValue] = useState('');
  const [eco, setEcoValue] = useState('all');
  const [risk, setRiskValue] = useState('all');
  const [projectFilter, setProjectFilterValue] = useState('all');
  const [sort, setSortValue] = useState('size');
  const [requestedPage, setPage] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [redact, setRedact] = useState(true);
  const [exporting, setExporting] = useState(false);
  const scrollPositions = useRef<Partial<Record<Tab, number>>>({});
  const previousFindings = useRef<FindingView | null>(null);
  const [canReturnToFindings, setCanReturnToFindings] = useState(false);
  const setQuery = (value: string) => { setQueryValue(value); setPage(0); };
  const setEco = (value: string) => { setEcoValue(value); setPage(0); };
  const setRisk = (value: string) => { setRiskValue(value); setPage(0); };
  const setProjectFilter = (value: string) => { setProjectFilterValue(value); setPage(0); };
  const setSort = (value: string) => { setSortValue(value); setPage(0); };
  const restoreFindingView = (view: FindingView) => {
    setQueryValue(view.query); setEcoValue(view.eco); setRiskValue(view.risk);
    setProjectFilterValue(view.projectFilter); setSortValue(view.sort); setPage(view.page); setSelected(view.selected);
  };
  const savedSession = useRef<{ report: Report; reportScope: ScanScope | null; previousReport: boolean; tab: Tab; query: string; eco: string; risk: string; projectFilter: string; sort: string; page: number; selected: string | null; redact: boolean; scroll: Partial<Record<Tab, number>>; previousFindings: FindingView | null } | null>(null);
  const activeProtected = origin === 'demo' ? demoProtected : protectedPaths;

  useEffect(() => {
    if (!native) return;
    let off: UnlistenFn | undefined; let disposed = false;
    listen<Progress>('scan-progress', e => setProgress(e.payload)).then(fn => { if (disposed) fn(); else off = fn; }).catch(e => setError(String(e)));
    return () => { disposed = true; off?.(); };
  }, []);
  useEffect(() => {
    try { localStorage.setItem('devspace.roots', JSON.stringify(roots)); localStorage.setItem('devspace.protected', JSON.stringify(protectedPaths)); }
    catch { setError('Preferences could not be saved. This session still works, but choices will not survive a restart.'); }
  }, [roots, protectedPaths]);
  useEffect(() => {
    const frame = requestAnimationFrame(() => window.scrollTo({top: scrollPositions.current[tab] ?? 0}));
    return () => cancelAnimationFrame(frame);
  }, [tab]);

  useEffect(() => {
    const element = toolbarRef.current; if (!element) return;
    const observer = new ResizeObserver(() => document.documentElement.style.setProperty('--report-toolbar-height', `${element.getBoundingClientRect().height}px`));
    observer.observe(element); return () => observer.disconnect();
  }, [report]);
  const scopeChanged = origin === 'native' && !!reportScope && scopeKey(reportScope) !== scopeKey({roots, includeCaches});
  const findings = report?.findings ?? [];
  const summary = useMemo(() => summarize(findings, activeProtected), [findings, activeProtected]);
  const groups = useMemo(() => {
    const sizes = new Map<string, number>(); findings.forEach(f => sizes.set(f.ecosystem, (sizes.get(f.ecosystem) ?? 0) + f.logicalBytes));
    return [...sizes].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [findings]);
  const selectedProject = report?.projects.find(p => p.id === projectFilter);
  const projectFindings = useMemo(() => selectedProject ? findingsForProject(findings, selectedProject) : [], [findings, selectedProject]);
  const projectFindingIds = useMemo(() => new Set(projectFindings.map(f => f.id)), [projectFindings]);
  const hasEnclosingFinding = projectFindings.some(f => f.projectId !== selectedProject?.id);
  const filtered = useMemo(() => {
    const term = query.toLocaleLowerCase();
    return findings.filter(f => (eco === 'all' || f.ecosystem === eco) && (risk === 'all' || effectiveRisk(f, activeProtected) === risk)
      && (projectFilter === 'all' || (projectFilter === 'global' ? !f.projectId : projectFindingIds.has(f.id)))
      && `${f.label} ${f.path} ${f.reason} ${f.ecosystem}`.toLocaleLowerCase().includes(term))
      .sort((a, b) => sort === 'name' ? a.path.localeCompare(b.path) : sort === 'risk' ? effectiveRisk(a, activeProtected).localeCompare(effectiveRisk(b, activeProtected)) || b.logicalBytes - a.logicalBytes : b.logicalBytes - a.logicalBytes);
  }, [findings, eco, risk, projectFilter, projectFindingIds, query, sort, activeProtected]);
  const bounds = pageBounds(requestedPage, filtered.length);
  const page = bounds.page;
  useEffect(() => { if (requestedPage !== page) setPage(page); }, [page, requestedPage]);
  useEffect(() => { detailRef.current?.scrollTo({top: 0}); drawerRef.current?.scrollTo({top: 0}); }, [selected]);
  const closeFinding = () => {
    const id = selected; setSelected(null);
    requestAnimationFrame(() => { if (id) findingButtons.current.get(id)?.focus(); });
  };
  const current = filtered.find(f => f.id === selected);
  useEffect(() => {
    const media = window.matchMedia('(max-width:1250px)');
    const changed = () => setCompactDetails(media.matches);
    media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    const drawer = drawerRef.current;
    if (compactDetails && current && tab === 'findings') {
      if (drawer && !drawer.open) drawer.showModal();
      const previousOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
      return () => { drawer?.close(); document.body.style.overflow = previousOverflow; };
    }
    drawer?.close();
  }, [compactDetails, current?.id, tab]);
  useEffect(() => {
    if (!current || tab !== 'findings') return;
    const frame = requestAnimationFrame(() => detailTitleRef.current?.focus({preventScroll: true}));
    return () => cancelAnimationFrame(frame);
  }, [current?.id, tab, compactDetails]);
  useEffect(() => { if (selected && !current) setSelected(null); }, [selected, current]);
  const top = findings.filter(f => !isProtected(f, activeProtected) && f.complete).sort((a, b) => b.logicalBytes - a.logicalBytes).slice(0, 3);
  const projectName = (id: string | null) => report?.projects.find(p => p.id === id)?.name ?? 'Shared / global';
  const hasFilters = !!query || eco !== 'all' || risk !== 'all' || projectFilter !== 'all';
  const clearFilters = () => { setQuery(''); setEco('all'); setRisk('all'); setProjectFilter('all'); };
  const navigate = (next: Tab) => { scrollPositions.current[tab] = window.scrollY; setTab(next); };
  const inspectProject = (id: string) => {
    previousFindings.current = {query, eco, risk, projectFilter, sort, page, selected}; setCanReturnToFindings(true);
    clearFilters(); setProjectFilter(id); setSelected(null); navigate('findings');
  };
  const returnToFindings = () => { if (previousFindings.current) restoreFindingView(previousFindings.current); previousFindings.current = null; setCanReturnToFindings(false); };
  const inspect = (f: Finding) => { clearFilters(); setSelected(f.id); navigate('findings'); };

  async function chooseFolders() {
    try {
      const result = await open({ directory: true, multiple: true, title: 'Choose developer workspace folders' });
      if (result) setRoots(old => [...new Set([...old, ...(Array.isArray(result) ? result : [result])])].slice(0, 32));
    } catch (e) { setError(String(e)); }
  }
  function addManual() {
    if (!manualRoot.trim()) return;
    if (roots.length >= 32) { setError('A scan supports at most 32 project roots.'); return; }
    setRoots(old => [...new Set([...old, manualRoot.trim()])]); setManualRoot('');
  }
  async function startScan() {
    if (!native || busy) return;
    setBusy(true); setCancelling(false); setPreviousReport(!!report); setProgress(zero); setError(''); setNotice('');
    try {
      const result = await invoke<Report>('scan', { request: { roots, includeGlobalCaches: includeCaches, protectedPaths } });
      savedSession.current = null; previousFindings.current = null; setCanReturnToFindings(false); scrollPositions.current = {}; setPage(0);
      setScopeExpanded(false);
      setReportScope({roots: [...roots], includeCaches});
      requestAnimationFrame(() => window.scrollTo({top:0}));
      setReport(result); setOrigin('native'); setPreviousReport(false); setSelected(null); clearFilters(); setTab('overview');
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); setCancelling(false); }
  }
  async function cancel() {
    setCancelling(true);
    try { await invoke('cancel_scan'); } catch (e) { setError(String(e)); setCancelling(false); }
  }
  function loadDemo() {
    if (report && origin === 'native') savedSession.current = { report, reportScope, previousReport, tab, query, eco, risk, projectFilter, sort, page, selected, redact, scroll: {...scrollPositions.current, [tab]:window.scrollY}, previousFindings:previousFindings.current };
    setPage(0); setCanReturnToFindings(false); previousFindings.current = null; scrollPositions.current = {};
    requestAnimationFrame(() => window.scrollTo({top:0}));
    setReportScope(null);
    setReport(demoReport()); setOrigin('demo'); setPreviousReport(false); setDemoProtected([]); setSelected(null); setTab('overview'); setError(''); setNotice(''); clearFilters();
  }
  function exitDemo() {
    const saved = savedSession.current; savedSession.current = null;
    setOrigin('native'); setError(''); setNotice('');
    scrollPositions.current = saved?.scroll ?? {}; previousFindings.current = saved?.previousFindings ?? null; setCanReturnToFindings(!!previousFindings.current);
    requestAnimationFrame(() => window.scrollTo({top:saved?.scroll[saved.tab] ?? 0}));
    setReportScope(saved?.reportScope ?? null);
    setReport(saved?.report ?? null); setPreviousReport(saved?.previousReport ?? false);
    setTab(saved?.tab ?? 'overview');
    restoreFindingView(saved ?? {query:'',eco:'all',risk:'all',projectFilter:'all',sort:'size',page:0,selected:null});
    setRedact(saved?.redact ?? true);
  }
  async function reveal(f: Finding) {
    if (busy) return;
    try { await invoke('reveal_finding', { id: f.id }); } catch (e) { setError(String(e)); }
  }
  async function exportReport(extension: 'json' | 'md') {
    if (!report) return;
    setExporting(true); setNotice(''); setError('');
    const adjusted = { ...report, findings: report.findings.map(f => ({ ...f, userProtected: activeProtected.some(p => pathsOverlap(p, f.path)) })) };
    const data = redact ? redactedReport(adjusted) : adjusted;
    const content = extension === 'json' ? JSON.stringify({ origin, redacted: redact, report: data }, null, 2) : markdownReport(data, origin, redact);
    try {
      if (native) {
        const saved = await invoke<string | null>('save_export', { content, extension });
        if (saved) setNotice(`Report saved: ${visiblePath(saved)}`);
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: extension === 'json' ? 'application/json' : 'text/markdown' }));
        const a = document.createElement('a'); a.href = url; a.download = `devspace-${origin}-${redact ? 'redacted' : 'full'}.${extension}`;
        a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('Demo report exported.');
      }
    } catch (e) { setError(String(e)); }
    finally { setExporting(false); }
  }

  const drawerActive = compactDetails && !!current && tab === 'findings';
  const feedback = (error || notice) && <div className="feedback-region" aria-label="Notifications">
        {error && <div className="error-banner" role="alert"><span>{error}</span><button aria-label="Dismiss error" onClick={() => setError('')}>×</button></div>}
        {notice && <div className="notice-banner" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}>×</button></div>}
      </div>;

  const detailPanel = <aside id={compactDetails ? undefined : "finding-detail-content"} ref={detailRef} className="detail panel" aria-label="Finding details" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeFinding(); } }}>
    {current ? <>
      <div className="section-heading"><span className="eyebrow">FINDING DETAILS</span><button className="icon-button" aria-label="Close finding details" onClick={closeFinding}><Icon name="close"/></button></div>
      <span className={`eco-label eco-${current.ecosystem}`}>{current.ecosystem}</span>
      <h2 ref={detailTitleRef} tabIndex={-1}>{current.label}</h2><div className="detail-size">{bytes(current.logicalBytes)}</div>
      <p className="muted">Logical size · {current.files.toLocaleString()} files{!current.complete ? ' · incomplete measurement' : ''}</p>
      <Badge risk={effectiveRisk(current, activeProtected)}/>
      <div className="path-block">{visiblePath(current.path)}</div>
      <h3>What this means</h3><p>{current.reason}</p>
      <details key={`evidence-${current.id}`} open={current.evidence.length <= 6}><summary>Evidence, not assumptions ({current.evidence.length})</summary><ul>{current.evidence.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
      {!!current.protectedDescendantCount && <section aria-label="Protected locations">
        <h3>Protected locations</h3>
        <p>Showing {current.protectedDescendants?.length ?? 0} of {current.protectedDescendantCount} protected locations. Nested locations covered by a protected parent are omitted.</p>
        <details key={`locations-${current.id}`} open={(current.protectedDescendants?.length ?? 0) <= 5}><summary>View protected locations</summary><ul>{current.protectedDescendants?.map(location => <li key={location.path}><strong>{location.label}</strong><div className="path-block">{visiblePath(location.path)}</div></li>)}</ul></details>
      </section>}
      {current.wrapperVersion && <div className="note"><strong>Gradle {current.wrapperVersion}</strong><p>{current.wrapperReferences.length ? `Found in: ${current.wrapperReferences.map(projectName).join(', ')}` : 'No matching wrapper in this scan. This does not mean unused.'}</p></div>}
      <h3>Recovery & trade-offs</h3><p>{current.recovery}</p>
      {current.latestModified !== null && <p className="muted">Latest file modification: {new Date(current.latestModified * 1000).toLocaleDateString('en-GB')}. Not a last-use date.</p>}
      <details><summary>Limits of this recommendation</summary><ul>{current.caveats.map((s, i) => <li key={i}>{s}</li>)}</ul></details>
      <div className="detail-actions">
        <button disabled={!native || origin === 'demo' || busy} onClick={() => reveal(current)}><Icon name="folder"/>Open folder</button>
        <ProtectionControls key={current.id} finding={current} findings={findings} paths={activeProtected} setPaths={origin === 'demo' ? setDemoProtected : setProtectedPaths}/>
      </div>
      <p className="tiny muted">Protection is a saved review preference, not a filesystem permission. No cleanup commands are available in this pilot.</p>
    </> : !findings.length ? <>
      <h2>No classified findings</h2><p>Files may have been measured without matching a supported developer-storage category. Review scan coverage or choose another workspace.</p>
      <button onClick={() => setTab('coverage')}>Review scan coverage</button>
    </> : <>
      <div className="detail-symbol"><Icon name="shield"/></div><h2>Understand it before removing it.</h2>
      <p>Select a finding to see why it was classified, what recovery would involve and what the scanner cannot verify.</p>
      <div className="legend-row"><Badge risk="low"/><span>Stronger recovery evidence. Still review first.</span></div>
      <div className="legend-row"><Badge risk="review"/><span>Potential candidate with unresolved conditions.</span></div>
      <div className="legend-row"><Badge risk="protected"/><span>Could contain unique data. Not a cleanup candidate.</span></div>
      <div className="note">This is an inventory, not a deletion plan. Every byte shown is logical size.</div>
    </>}
  </aside>;

  return <div className={`app-shell ${report ? "report-present" : ""} tab-${tab}`}>
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark"><Icon name="grid"/></span><div>DevSpace<small>ANALYZER</small></div></div>
      <div className="nav-label">WORKSPACE INTELLIGENCE</div>
      <nav aria-label="Main navigation">{([['overview', 'grid', 'Overview'], ['findings', 'list', 'Findings'], ['projects', 'folder', 'Projects'], ['coverage', 'shield', 'Scan coverage']] as const).map(([id, icon, text]) => <button key={id} aria-label={text} className={tab === id ? 'active' : ''} aria-current={tab === id ? 'page' : undefined} onClick={() => navigate(id)}><Icon name={icon}/><span className="nav-text">{text}</span><span className="nav-tooltip" aria-hidden="true">{text}</span>{id === 'findings' && report && <span className="nav-count">{findings.length}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-indicator">Local only</div><p>No account. No telemetry.<br/>No automatic cleanup.</p><span className="version">PILOT 0.1.1</span></div>
    </aside>
    <main>
      <header className="topbar"><div><div className="eyebrow">DEVELOPER STORAGE / {tab.toUpperCase()}</div><h1>{report ? ({overview:'Overview',findings:'Findings',projects:'Projects',coverage:'Scan coverage'}[tab]) : tab === 'overview' ? 'Know what takes your space.' : tab === 'findings' ? 'Inspect your development data.' : tab === 'projects' ? 'Your projects, in context.' : 'A clear view of the scan scope.'}</h1></div><span className="readonly"><Icon name="shield"/>Read-only pilot</span></header>
      {!native && <div className="browser-note">Browser preview · Real filesystem scanning is available only in the desktop application.</div>}
      {origin === 'demo' && report && <div className="demo-banner" role="status"><strong>DEMO · SYNTHETIC DATA</strong><span>These figures are illustrative. This computer has not been scanned.</span><button disabled={busy} onClick={exitDemo}>Exit demo</button></div>}
      {previousReport && report && <div className="notice-banner" role="status">{busy ? 'Showing the previous report while a new scan runs.' : 'The new scan failed. The previous report is still available for inspection and export.'}</div>}
      <section className="scope panel" aria-label="Scan configuration">
        {report ? <div className="scope-top"><div><strong>Next scan</strong><span className="muted">{roots.length} workspace {roots.length === 1 ? 'folder' : 'folders'} · Shared caches {includeCaches ? 'included' : 'excluded'}</span></div><div className="scope-actions"><button aria-expanded={scopeExpanded} aria-controls="scan-settings" onClick={() => setScopeExpanded(value => !value)}>Scan settings</button><button className="primary" disabled={!native || busy || (!roots.length && !includeCaches)} onClick={startScan}><Icon name="scan"/>{busy ? 'Scanning…' : 'Scan workspace'}</button><button className="text-button" onClick={loadDemo} disabled={busy}>Explore demo</button></div></div> : <div className="scope-top"><div><strong>Scan scope</strong><span className="muted">Choose workspace folders. Known shared caches are optional.</span></div><div className="scope-actions"><button onClick={chooseFolders} disabled={!native || busy}><Icon name="folder"/>Choose folders</button><button className="primary" disabled={!native || busy || (!roots.length && !includeCaches)} onClick={startScan}><Icon name="scan"/>{busy ? 'Scanning…' : 'Scan workspace'}</button></div></div>}
        <div id="scan-settings" hidden={!!report && !scopeExpanded}>
        {report && <button onClick={chooseFolders} disabled={!native || busy}><Icon name="folder"/>Choose folders</button>}
        <div className="root-list">{roots.map(root => <span className="root-chip" key={root} title={root}><Icon name="folder"/><span>{visiblePath(root)}</span><button disabled={busy} aria-label={`Remove ${root}`} onClick={() => setRoots(old => old.filter(p => p !== root))}>×</button></span>)}</div>
        <div className="scope-options"><form onSubmit={e => { e.preventDefault(); addManual(); }}><input aria-label="Add folder path" value={manualRoot} onChange={e => setManualRoot(e.target.value)} placeholder="Or enter a folder path, e.g. C:\\Workspaces" disabled={busy}/><button disabled={busy || !manualRoot.trim()} type="submit">Add</button></form><label><input type="checkbox" checked={includeCaches} disabled={busy} onChange={e => setIncludeCaches(e.target.checked)}/>Include known shared caches</label>{!report && <button className="text-button" onClick={loadDemo} disabled={busy}>Explore demo</button>}</div>
        </div>
        {scopeChanged && <p className="scope-change" role="status">Settings changed — scan again to update results. The current report still describes its original scope.</p>}
        {busy && <div className="scan-progress" role="status"><div className="progress-track"><span/></div><div><strong>{cancelling ? 'Cancelling at the next filesystem boundary…' : `Scanning · ${progress.files.toLocaleString()} files · ${bytes(progress.logicalBytes)}`}</strong><button onClick={cancel} disabled={cancelling}>Cancel scan</button></div><span className="mono muted">{visiblePath(progress.currentPath)}</span></div>}
      </section>

      {!report ? <section className="welcome panel"><div className="welcome-icon"><Icon name="scan"/></div><span className="eyebrow">LESS GUESSWORK. MORE CONTEXT.</span><h2>Find the weight in your development workspace.</h2><p>Understand Gradle and Maven storage, Node dependencies and Python environments — with explicit evidence, recovery notes and protected data.</p><div className="welcome-steps"><div><b>01</b><strong>Choose your scope</strong><span>Start with your checked-out repositories and shared caches.</span></div><div><b>02</b><strong>Inspect the findings</strong><span>Compare categories, projects and likely recovery costs.</span></div><div><b>03</b><strong>Make an informed decision</strong><span>Export your analysis. This pilot cannot delete anything.</span></div></div><button onClick={loadDemo} disabled={busy}>Explore demo data<Icon name="arrow"/></button></section> : <>
        <div ref={toolbarRef} className="report-toolbar"><div className="report-bar"><span>{origin === 'demo' ? 'Synthetic example' : new Date(report.startedAt * 1000).toLocaleString('en-GB')} · {report.progress.files.toLocaleString()} files · {bytes(report.progress.logicalBytes)} measured · {(report.durationMs / 1000).toFixed(1)} s</span><button className="text-button" onClick={() => setTab('coverage')}>{report.cancelled ? 'Cancelled · partial results' : report.complete ? 'Completed within scope' : `${report.warningCount} coverage warning${report.warningCount === 1 ? '' : 's'}`}</button></div><footer className="export-bar panel"><div><strong>Your analysis stays local.</strong><span>No cleanup has been performed. Exports can contain sensitive path metadata.</span></div><label><input type="checkbox" checked={redact} onChange={e => setRedact(e.target.checked)}/>Redacted summary</label><button onClick={() => exportReport('md')} disabled={exporting}><Icon name="download"/>Markdown</button><button onClick={() => exportReport('json')} disabled={exporting}><Icon name="download"/>Export JSON</button></footer></div>
        <section className="metrics" aria-label="Scan summary"><div className="metric panel"><span>Identified developer data</span><strong>{bytes(summary.identified)}</strong><small>{findings.length.toLocaleString()} classified findings</small></div><div className="metric panel accent"><span>Review candidates</span><strong>{bytes(summary.candidates)}</strong><small>Logical size · not guaranteed savings</small></div><div className="metric panel"><span>Protected data</span><strong>{bytes(summary.protected)}</strong><small>Unique data or personal protection</small></div><div className="metric panel"><span>Projects in scope</span><strong>{report.projects.length}</strong><small>{report.roots.length} effective scan roots</small></div></section>


        {tab === 'overview' && <>
          <div className="overview-grid"><section className="panel chart-panel"><div className="section-heading"><h2>Where the space is</h2><span className="muted">Classified logical bytes</span></div><div className="treemap" aria-label="Storage by ecosystem">{treemap(groups).map(tile => <button key={tile.name} className={`tile eco-${tile.name}`} title={`${tile.name}: ${bytes(tile.value)}`} style={{ left: `${tile.x / 9.6}%`, top: `${tile.y / 2.4}%`, width: `${tile.w / 9.6}%`, height: `${tile.h / 2.4}%` }} onClick={() => { clearFilters(); setEco(tile.name); setTab('findings'); }}><strong>{tile.name}</strong>{tile.w > 110 && tile.h > 65 && <><span>{bytes(tile.value)}</span><small>{(tile.value / Math.max(summary.identified, 1) * 100).toFixed(1)}%</small></>}</button>)}{groups.length === 0 && <p>No recognized developer data found in this scope.</p>}</div><div className="chart-legend">{groups.map(g => <span key={g.name}><i className={`dot eco-${g.name}`}/>{g.name}</span>)}</div></section>
          <section className="panel inspect-panel"><div className="section-heading"><h2>Start your review here</h2><span className="eyebrow">LARGEST FIRST</span></div>{top.length ? top.map((f, i) => <button className="review-item" key={f.id} onClick={() => inspect(f)}><span className="rank">0{i + 1}</span><div><strong>{f.label}</strong><small>{projectName(f.projectId)}</small><Badge risk={effectiveRisk(f, activeProtected)}/></div><b>{bytes(f.logicalBytes)}</b></button>) : <p>No complete, unprotected review candidates in this scan.</p>}<p className="tiny muted">Prioritized by size, not by a claim that deletion is safe.</p></section></div>
          <section className="panel ecosystem-strip">{groups.map(group => <button key={group.name} onClick={() => { clearFilters(); setEco(group.name); setTab('findings'); }}><span className={`eco-label eco-${group.name}`}>{group.name}</span><strong>{bytes(group.value)}</strong><small>{findings.filter(f => f.ecosystem === group.name).length} findings<Icon name="arrow"/></small></button>)}</section>
        </>}

        {tab === 'findings' && <div className="workspace-grid"><section className="panel results-panel"><div className="section-heading"><h2>Findings <span className="count">{filtered.length.toLocaleString()}</span></h2>{hasFilters && <button className="text-button" onClick={clearFilters}>Clear filters</button>}</div>{canReturnToFindings && <button className="text-button return-findings" onClick={returnToFindings}>Back to previous findings</button>}{hasEnclosingFinding && <p className="note project-context" role="status">This project is inside protected storage. Inspect the enclosing findings below; its contents are not listed separately.</p>}<div className="filters"><input aria-label="Search findings" placeholder="Search folders, projects or categories…" value={query} onChange={e => setQuery(e.target.value)}/><select aria-label="Ecosystem filter" value={eco} onChange={e => setEco(e.target.value)}><option value="all">All ecosystems</option>{groups.map(g => <option key={g.name}>{g.name}</option>)}</select><select aria-label="Risk filter" value={risk} onChange={e => setRisk(e.target.value)}><option value="all">All risks</option>{Object.entries(labels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select aria-label="Project filter" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}><option value="all">All locations</option><option value="global">Shared / global</option>{report.projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><select aria-label="Sort findings" value={sort} onChange={e => setSort(e.target.value)}><option value="size">Largest first</option><option value="name">Path A–Z</option><option value="risk">Risk</option></select></div><div className="table-scroll"><table><thead><tr><th>Finding / location</th><th>Project</th><th className="number">Logical size</th><th>Assessment</th></tr></thead><tbody>{filtered.slice(bounds.start, bounds.end).map(f => <tr key={f.id} onClick={event => { if (!(event.target as HTMLElement).closest("button")) setSelected(f.id); }} className={selected === f.id ? 'selected' : ''}><td><button ref={element => { if (element) findingButtons.current.set(f.id, element); else findingButtons.current.delete(f.id); }} aria-controls="finding-detail-content" className="finding-button" onClick={() => setSelected(f.id)}><strong><i className={`dot eco-${f.ecosystem}`}/>{f.label}</strong><span title={f.path}>{visiblePath(f.path)}</span></button></td><td><span className="project-cell">{projectName(f.projectId)}</span></td><td className="number"><strong>{bytes(f.logicalBytes)}</strong><small>{f.files.toLocaleString()} files{!f.complete && ' · partial'}</small></td><td><Badge risk={effectiveRisk(f, activeProtected)}/></td></tr>)}</tbody></table>{filtered.length === 0 && <div className="empty-results"><h3>{findings.length ? "No findings match these filters." : "No recognized developer data in this scan."}</h3><p>{findings.length ? "Try another category or clear the filters." : "Measured files may not match a supported category. Check coverage or change the scan scope."}</p>{findings.length ? <button onClick={clearFilters}>Clear filters</button> : <button onClick={() => setTab('coverage')}>Review coverage</button>}</div>}</div><div className="pagination"><span>{bounds.total ? `${bounds.from}–${bounds.end} of ${bounds.total}` : '0 findings'}</span><div><button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button><button disabled={page >= bounds.last} onClick={() => setPage(page + 1)}>Next</button></div></div></section>{compactDetails ? <dialog id="finding-detail-content" ref={drawerRef} className="finding-drawer" aria-label="Finding details" onCancel={event => { event.preventDefault(); closeFinding(); }}>{current && detailPanel}{drawerActive && feedback}</dialog> : detailPanel}</div>}

        {tab === 'projects' && <section className="panel projects-panel"><div className="section-heading"><h2>Project inventory</h2><span className="muted">Owned bytes exclude nested projects</span></div><p className="muted">Manifests and Git markers are detected statically. The working tree and other branches are not evaluated.</p><div className="table-scroll"><table><thead><tr><th>Project / path</th><th>Build context</th><th>Dependency evidence</th><th className="number">Owned logical size</th><th></th></tr></thead><tbody>{report.projects.slice().sort((a, b) => b.ownedLogicalBytes - a.ownedLogicalBytes).map(p => <tr key={p.id}><td><strong>{p.name}</strong><small className="mono wrap">{visiblePath(p.path)}</small><small>{p.gitKind ?? 'No Git marker'}{p.branch ? ` · ${p.branch}` : ''}{p.workspace ? ' · workspace' : ''}</small></td><td><div className="tags">{p.ecosystems.map(e => <span key={e} className={`eco-label eco-${e}`}>{e}</span>)}</div>{p.wrapperVersion && <small>Gradle wrapper {p.wrapperVersion}</small>}</td><td>{p.lockfiles.length ? <><strong>{p.lockfiles.length} lockfile marker(s)</strong><small>{p.lockfiles.join(', ')}</small></> : <span className="muted">No recognized lockfile</span>}<small>Reproducibility not verified</small></td><td className="number"><strong>{bytes(p.ownedLogicalBytes)}</strong><small>{bytes(p.artifactBytes)} identified artifacts</small>{p.contextOnly && <small>Context from parent · sizes within selected scope only</small>}</td><td><button onClick={() => inspectProject(p.id)}>Inspect<Icon name="arrow"/></button></td></tr>)}</tbody></table></div>{!report.projects.length && <div className="empty-results">No project markers found. Shared-cache-only scans may have no projects.</div>}</section>}

        {tab === 'coverage' && <div className="coverage-grid"><section className="panel"><div className="section-heading"><h2>What was scanned</h2><Badge risk={report.complete ? 'low' : 'review'}/></div><h3>Effective roots</h3><ul className="path-list">{report.roots.map(p => <li key={p} className="mono">{visiblePath(p)}</li>)}</ul><h3>Recognized cache locations overlapping scope</h3>{report.globalCaches.map((c, i) => <div className="cache-location" key={i}><strong>{c.ecosystem} · {c.kind}</strong><span className="mono">{visiblePath(c.path)}</span><small>{c.source}</small></div>)}<p className="tiny muted">Only effective roots above were traversed. A recognized cache may enclose a selected subdirectory. Defaults are not verified by running a package manager; custom/project configurations may place data elsewhere.</p></section><section className="panel"><h2>Limits & skipped entries</h2><ul className="limitations">{report.limitations.map((s, i) => <li key={i}>{s}</li>)}</ul><h3>Warnings ({report.warningCount.toLocaleString()})</h3><div className="warning-list">{report.warnings.map((w, i) => <div className="warning-item" key={i}><strong>{w.code}</strong><span className="mono">{visiblePath(w.path)}</span><p>{w.message}</p></div>)}{!report.warnings.length && <p>No skipped-entry warnings were recorded.</p>}</div>{report.warningCount > report.warnings.length && <p>Only the first {report.warnings.length} warning details are retained.</p>}</section></div>}


      </>}
      {!drawerActive && feedback}
    </main>
  </div>;
}
