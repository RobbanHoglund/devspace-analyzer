type Crumb = { key: string; label: string; title: string; onSelect: () => void };

export function StorageBreadcrumbs({ crumbs }: { crumbs: Crumb[] }) {
  const hidden = crumbs.length > 4 ? crumbs.slice(1, -2) : [];
  const item = (crumb: Crumb, current: boolean) => <li key={crumb.key}>
    <button title={crumb.title} aria-label={crumb.key === 'roots' ? 'All scanned locations' : undefined} aria-current={current ? 'location' : undefined} onClick={crumb.onSelect}>{crumb.key === 'roots' && <svg className="crumb-home" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="m3 10 9-7 9 7v11h-6v-7H9v7H3z"/></svg>}<span>{crumb.label}</span></button>
  </li>;
  return <nav className="storage-crumbs" aria-label="Storage path"><ol>
    {item(crumbs[0], crumbs.length === 1)}
    {hidden.length > 0 && <li className="crumb-menu"><details onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}>
      <summary aria-label="Show parent folders" title="Jump to a parent folder">…</summary>
      <div className="ancestor-menu">{hidden.map(crumb => <button key={crumb.key} title={crumb.title} onClick={event => { event.currentTarget.closest('details')?.removeAttribute('open'); crumb.onSelect(); }}>{crumb.label}<small>{crumb.title}</small></button>)}</div>
    </details></li>}
    {(hidden.length ? crumbs.slice(-2) : crumbs.slice(1)).map(crumb => item(crumb, crumb.key === crumbs.at(-1)?.key))}
  </ol></nav>;
}
