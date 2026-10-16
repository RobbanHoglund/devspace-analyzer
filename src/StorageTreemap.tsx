import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { bytes, visiblePath } from './analysis';
import { layoutTreemap, mapColor, percentage, sumEntries, visibleEntries, type MapEntry } from './treemap';

export function StorageTreemap({ entries, onOpen }: { entries: MapEntry[]; onOpen: (entry: MapEntry) => void }) {
  const surface = useRef<HTMLDivElement>(null), title = useRef<HTMLHeadingElement>(null);
  const [width, setWidth] = useState(800);
  const [trail, setTrail] = useState<MapEntry[]>([]);
  const [selected, setSelected] = useState<MapEntry | null>(null);
  const group = trail.at(-1), source = group?.children ?? entries;
  const total = sumEntries(source), height = Math.min(390, Math.max(270, width * .43));
  const displayed = visibleEntries(source, width < 520);
  const rectangles = layoutTreemap(displayed, width, height);
  useLayoutEffect(() => {
    const element = surface.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  useEffect(() => { if (trail.length) title.current?.focus({ preventScroll: true }); }, [trail]);
  const activate = (entry: MapEntry) => {
    if (entry.children?.length) { setTrail(old => [...old, entry]); setSelected(null); }
    else if (entry.kind === 'folder' || entry.kind === 'filtered') onOpen(entry);
    else setSelected(entry);
  };
  return <section className="folder-map" aria-label="Interactive folder map">
    <div className="map-heading"><div><h3 ref={title} tabIndex={-1}>{group?.name ?? 'Where the space goes'}</h3><p>{group ? `${bytes(total)} in this group` : 'Click a folder to explore it. Area represents measured size.'}</p></div>{trail.length > 0 && <button onClick={() => { setTrail(old => old.slice(0, -1)); setSelected(null); requestAnimationFrame(() => title.current?.focus()); }}>← Back to {trail.length === 1 ? 'folder map' : 'previous group'}</button>}</div>
    <div ref={surface} className="treemap-surface" style={{ height: total > 0 ? height : 110 }}>
      {rectangles.map(({ entry, x, y, width: w, height: h }) => {
        const compact = w < 160 || h < 120, short = h < 78, tiny = w < 65 || h < 44;
        const action = entry.kind === 'folder' ? 'Open folder' : entry.children?.length ? 'Explore group' : entry.kind === 'filtered' ? 'Clear filter' : 'Show size details';
        return <button key={entry.id} className={`map-tile map-color-${mapColor(entry.path ?? entry.id)} map-kind-${entry.kind} ${compact ? 'map-compact' : ''} ${short ? 'map-short' : ''} ${tiny ? 'map-tiny' : ''}`} data-value={entry.value}
          style={{ left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${w / width * 100}%`, height: `${h / height * 100}%` } as CSSProperties}
          aria-label={`${action}: ${entry.name}, ${bytes(entry.value)}, ${percentage(entry.value, total)}${entry.partial ? ', partial measurement' : ''}`} title={`${entry.path ? visiblePath(entry.path) : entry.name}\n${bytes(entry.value)} · ${percentage(entry.value, total)}\n${entry.detail}`}
          onClick={() => activate(entry)} onFocus={() => setSelected(entry)} onMouseEnter={() => setSelected(entry)}>
          <span className="map-tile-name">{entry.name}</span><strong>{bytes(entry.value)}</strong><span className="map-tile-share">{percentage(entry.value, total)}{entry.partial ? ' · partial' : ''}</span>
          {!compact && <span className="map-tile-action">{entry.kind === 'folder' ? 'Open folder ↗' : entry.children?.length ? 'Explore group ↗' : entry.kind === 'filtered' ? 'Clear filter ↗' : 'Size details'}</span>}
        </button>;
      })}
      {!total && <p className="map-empty">No measured bytes to map in this location.</p>}
    </div>
    <div className="map-caption" aria-live="polite">{selected ? <><strong>{selected.name}</strong><span>{bytes(selected.value)} · {percentage(selected.value, total)} of this {group ? 'group' : 'location'}{selected.partial ? ' · partial measurement' : ''}</span><small>{selected.detail}</small></> : <><strong>Explore the largest areas first</strong><span>Colors distinguish items; they do not indicate deletion safety.</span></>}</div>
    <div className="map-legend" aria-label="Map items">{displayed.map(entry => <button key={entry.id} onClick={() => activate(entry)} onFocus={() => setSelected(entry)} title={entry.path ? visiblePath(entry.path) : entry.detail}><i className={`map-swatch map-color-${mapColor(entry.path ?? entry.id)}`}/><span>{entry.name}</span><strong>{bytes(entry.value)}</strong><small>{percentage(entry.value, total)}</small></button>)}</div>
  </section>;
}
