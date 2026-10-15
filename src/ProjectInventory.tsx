import { useMemo } from 'react';
import type { Project } from './types';
import { bytes, visiblePath } from './analysis';
import { pageBounds } from './pagination';

export interface ProjectView { query: string; ecosystem: string; sort: string; page: number }
export const emptyProjectView: ProjectView = {query: '', ecosystem: 'all', sort: 'size', page: 0};
interface Props { projects: Project[]; view: ProjectView; onChange: (view: ProjectView) => void; onInspect: (id: string) => void }
export function ProjectInventory({projects, view, onChange, onInspect}: Props) {
  const ecosystems = useMemo(() => [...new Set(projects.flatMap(p => p.ecosystems))].sort(), [projects]);
  const filtered = useMemo(() => projects.filter(p => (view.ecosystem === 'all' || p.ecosystems.includes(view.ecosystem)) &&
    `${p.name} ${p.path}`.toLocaleLowerCase().includes(view.query.toLocaleLowerCase())).sort((a,b) =>
    view.sort === 'name' ? a.name.localeCompare(b.name) || a.path.localeCompare(b.path) :
    (view.sort === 'artifacts' ? b.artifactBytes - a.artifactBytes : b.ownedLogicalBytes - a.ownedLogicalBytes) || a.name.localeCompare(b.name)), [projects, view]);
  const bounds = pageBounds(view.page, filtered.length);
  const change = (update: Partial<ProjectView>) => onChange({...view, ...update, page: 0});
  return <section className="panel projects-panel">
    <div className="section-heading"><h2>Project inventory <span className="count">{filtered.length.toLocaleString()}</span></h2><span className="muted">Owned bytes exclude nested projects</span></div>
    <p className="muted">Manifests and Git markers are detected statically. The working tree and other branches are not evaluated.</p>
    <div className="filters project-filters">
      <input aria-label="Search projects" placeholder="Search project names or paths…" value={view.query} onChange={e => change({query:e.target.value})}/>
      <select aria-label="Project ecosystem" value={view.ecosystem} onChange={e => change({ecosystem:e.target.value})}><option value="all">All ecosystems</option>{ecosystems.map(eco => <option key={eco}>{eco}</option>)}</select>
      <select aria-label="Sort projects" value={view.sort} onChange={e => change({sort:e.target.value})}><option value="size">Largest owned size</option><option value="artifacts">Largest artifacts</option><option value="name">Name A–Z</option></select>
      {(view.query || view.ecosystem !== 'all') && <button className="text-button" onClick={() => onChange({...emptyProjectView, sort:view.sort})}>Clear project filters</button>}
    </div>
    <div className="table-scroll"><table><thead><tr><th>Project / path</th><th>Build context</th><th>Dependency evidence</th><th className="number">Owned logical size</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>
      {filtered.slice(bounds.start,bounds.end).map(p => <tr key={p.id}>
        <td><strong className="wrap">{p.name}</strong><small className="mono wrap">{visiblePath(p.path)}</small><small>{p.gitKind ?? 'No Git marker'}{p.branch ? ` · ${p.branch}` : ''}{p.workspace ? ' · workspace' : ''}</small></td>
        <td><div className="tags">{p.ecosystems.map(e => <span key={e} className={`eco-label eco-${e}`}>{e}</span>)}</div>{p.wrapperVersion && <small>Gradle wrapper {p.wrapperVersion}</small>}</td>
        <td>{p.lockfiles.length ? <><strong>{p.lockfiles.length} lockfile marker(s)</strong><small className="wrap">{p.lockfiles.join(', ')}</small></> : <span className="muted">No recognized lockfile</span>}<small>Reproducibility not verified</small></td>
        <td className="number project-size"><strong>{bytes(p.ownedLogicalBytes)}</strong><small>{bytes(p.artifactBytes)} identified artifacts</small>{p.contextOnly && <small className="wrap">Context from parent · sizes within selected scope only</small>}</td>
        <td><button onClick={() => onInspect(p.id)}>Inspect<span aria-hidden="true">→</span></button></td>
      </tr>)}
    </tbody></table></div>
    {!filtered.length && <div className="empty-results">{projects.length ? 'No projects match these filters.' : 'No project markers found. Shared-cache-only scans may have no projects.'}</div>}
    <div className="pagination"><span>{bounds.total ? `${bounds.from}–${bounds.end} of ${bounds.total} projects` : '0 projects'}</span><div><button disabled={bounds.page === 0} onClick={() => onChange({...view,page:bounds.page-1})}>Previous</button><button disabled={bounds.page >= bounds.last} onClick={() => onChange({...view,page:bounds.page+1})}>Next</button></div></div>
  </section>;
}
