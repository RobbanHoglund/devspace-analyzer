import { useState } from 'react';
import { bytes } from './analysis';
import { unclassifiedMeasuredBytes } from './measurement';
import { percentage } from './treemap';
import type { Report } from './types';

const point = (angle: number, radius: number) => [150 + Math.sin(angle) * radius, 150 - Math.cos(angle) * radius];
export function ringSegment(start: number, end: number): string {
  // Two arcs handle a single category occupying the entire ring as well.
  const middle = (start + end) / 2;
  const [a, b, c] = [start, middle, end].map(angle => point(angle, 130));
  const [d, e, f] = [end, middle, start].map(angle => point(angle, 94));
  return `M ${a} A 130 130 0 0 1 ${b} A 130 130 0 0 1 ${c} L ${d} A 94 94 0 0 0 ${e} A 94 94 0 0 0 ${f} Z`;
}
export function StorageDistribution({ report, groups, onEcosystem, onOther, onAllStorage }: { report: Report; groups: { name: string; value: number }[]; onEcosystem: (name: string) => void; onOther: () => void; onAllStorage: () => void }) {
  const other = unclassifiedMeasuredBytes(report);
  const entries = [...groups.map(g => ({ ...g, key: g.name, ecosystem: g.name })), ...(other !== null && other > 0 ? [{ name: 'Other measured files', key: 'unclassified', value: other, ecosystem: null }] : [])].sort((a, b) => b.value - a.value);
  const total = entries.reduce((n, e) => n + e.value, 0);
  const [active, setActive] = useState<string | null>(null);
  const selected = entries.find(e => e.key === active);
  const activate = (entry: typeof entries[number]) => entry.ecosystem ? onEcosystem(entry.ecosystem) : onOther();
  let angle = 0;
  return <section className="panel chart-panel ecosystem-overview distribution-panel" aria-label="Storage distribution">
    <div className="section-heading"><div><h2>Storage distribution</h2><p className="muted">Select a segment to inspect its findings or explore unclassified files.</p></div><div className="distribution-actions"><button onClick={onAllStorage}>Explore all folders →</button><span className="distribution-basis">{report.complete ? 'Measured within scope' : 'Partial scan · measured bytes only'}</span></div></div>
    <div className="distribution-content"><div className="donut-shell">
      <svg viewBox="0 0 300 300" className="distribution-ring" role="group" aria-label="Storage share by category">
        {!total && <circle cx="150" cy="150" r="112" fill="none" stroke="var(--border)" strokeWidth="36"/>}
        {entries.filter(e => e.value > 0).map(entry => { const start = angle; angle += entry.value / total * Math.PI * 2;
          return <path key={entry.key} data-navigation-id={`distribution-${entry.key}`} className={`donut-segment eco-${entry.ecosystem ?? 'Other'} ${active === entry.key ? 'donut-active' : ''}`} d={ringSegment(start, angle)} role="button" tabIndex={0}
            aria-label={`${entry.name}, ${bytes(entry.value)}, ${percentage(entry.value, total)}. ${entry.ecosystem ? 'Inspect findings' : 'Explore files'}`} onClick={() => activate(entry)} onMouseEnter={() => setActive(entry.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(entry.key)} onBlur={() => setActive(null)}
            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate(entry); } }}><title>{entry.name}: {bytes(entry.value)} ({percentage(entry.value, total)})</title></path>;
        })}
      </svg><div className="donut-center" aria-hidden="true"><span>{selected?.name ?? (other === null ? 'Identified data' : 'Total measured')}</span><strong>{bytes(selected?.value ?? total)}</strong><small>{selected ? percentage(selected.value, total) : `${entries.length} ${entries.length === 1 ? 'category' : 'categories'}`}</small></div>
    </div><div className="storage-bars distribution-legend" aria-label="Storage by ecosystem">{entries.map(entry => <button className={`storage-bar eco-${entry.ecosystem ?? 'Other'}`} key={entry.key} data-navigation-id={`distribution-legend-${entry.key}`} onClick={() => activate(entry)} onMouseEnter={() => setActive(entry.key)} onMouseLeave={() => setActive(null)} onFocus={() => setActive(entry.key)} onBlur={() => setActive(null)}>
      <span className="storage-bar-label"><span><i className={`dot eco-${entry.ecosystem ?? 'Other'}`}/>{entry.name}</span><strong>{bytes(entry.value)}</strong></span><span className="distribution-share">{percentage(entry.value, total)}<span>{entry.ecosystem ? 'Inspect findings →' : 'Explore folders →'}</span></span><span className="storage-track" aria-hidden="true"><span style={{ width: `${entry.value / Math.max(total, 1) * 100}%` }}/></span>
    </button>)}{!entries.length && <p>No measured storage in this scan.</p>}</div></div>
    {other === null && <p className="tiny muted">Measured and classified totals are inconsistent. This chart shows identified data only.</p>}
    <p className="tiny muted distribution-note">Logical file sizes. Category colors do not indicate what can be deleted.</p>
  </section>;
}
