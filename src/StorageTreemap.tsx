import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { bytes, visiblePath } from './analysis';
import { layoutTreemap, mapColor, percentage, sumEntries, visibleEntries, type MapEntry, type MapRect } from './treemap';

type Selection = { entry: MapEntry; parent?: MapEntry };
interface Props {
  entries: MapEntry[]; trail: MapEntry[]; onTrailChange: (trail: MapEntry[]) => void;
  onOpen: (entry: MapEntry, parent?: MapEntry) => void;
  page: number; onPageChange: (page: number) => void; consistent: boolean;
  renderReview: (entry: MapEntry) => ReactNode;
}
const pageSize = 10;
const bounds = ({ x, y, width, height }: MapRect): CSSProperties => ({ left: x, top: y, width, height });
const contains = (container: MapEntry, id: string): boolean => container.id === id || !!container.children?.some(child => contains(child, id));

export function StorageTreemap({ entries, trail, onTrailChange, onOpen, page, onPageChange, consistent, renderReview }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const [hovered, setHovered] = useState<Selection | null>(null);
  const [focused, setFocused] = useState<Selection | null>(null);
  const selected = hovered ?? focused;
  const group = trail.at(-1), source = group?.children ?? entries;
  const total = sumEntries(source), height = Math.min(440, Math.max(300, width * .6));
  const displayed = visibleEntries(source, width < 520);
  const rectangles = layoutTreemap(displayed, width, height);
  const rows = [...source].sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const shownPage = Math.min(page, Math.max(0, Math.ceil(rows.length / pageSize) - 1));
  const selectedRoot = selected?.parent ?? selected?.entry;
  const matches = (entry: MapEntry) => !!selectedRoot && (contains(entry, selectedRoot.id) || contains(selectedRoot, entry.id));
  useLayoutEffect(() => {
    const element = surface.current; if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(1, entry.contentRect.width)));
    observer.observe(element); return () => observer.disconnect();
  }, []);
  const activate = (entry: MapEntry, parent?: MapEntry) => {
    if (entry.kind === 'folder' || entry.kind === 'filtered' || parent && entry.children?.length) onOpen(entry, parent);
    else if (entry.children?.length) onTrailChange([...trail, entry]);
    else setFocused({ entry, parent });
  };
  const interaction = (entry: MapEntry, parent?: MapEntry) => ({
    onClick: () => activate(entry, parent), onFocus: () => { setHovered(null); setFocused({ entry, parent }); }, onBlur: () => setFocused(null),
    onMouseEnter: () => setHovered({ entry, parent }), onMouseLeave: () => setHovered(null),
  });
  const tile = (rect: MapRect, parent?: MapEntry, header = false) => {
    const { entry, width: w, height: h } = rect;
    const compact = w < 160 || h < 120, short = h < 78, tiny = w < 65 || h < 44;
    const action = entry.kind === 'folder' ? parent ? 'Open subfolder' : 'Open folder' : entry.children?.length ? parent ? 'Explore contents' : 'Explore group' : entry.kind === 'filtered' ? 'Clear filter' : parent ? 'Show contents details' : 'Show size details';
    const active = parent ? selected?.parent?.id === parent.id && selected.entry.id === entry.id : matches(entry);
    return <button key={entry.id} data-navigation-id={parent ? `preview-${parent.id}-${entry.id}` : `map-${entry.id}`}
      className={`map-block ${parent ? 'map-child' : 'map-tile'} map-color-${mapColor(entry.path ?? entry.id)} map-kind-${entry.kind} ${compact ? 'map-compact' : ''} ${short ? 'map-short' : ''} ${tiny ? 'map-tiny' : ''} ${header ? 'map-parent' : ''} ${active ? 'map-active' : ''}`}
      data-value={entry.value} style={bounds(rect)}
      aria-label={`${action}: ${entry.name}, ${bytes(entry.value)}, ${percentage(entry.value, parent?.value ?? total)}${parent ? ` of ${parent.name}` : ''}${entry.partial ? ', partial measurement' : ''}`}
      title={`${entry.path ? visiblePath(entry.path) : entry.name}\n${bytes(entry.value)} · ${percentage(entry.value, parent?.value ?? total)}${parent ? ` of ${parent.name}` : ''}\n${entry.detail}`}
      {...interaction(entry, parent)}>
      <span className="map-tile-name">{entry.name}</span><strong>{bytes(entry.value)}</strong>
      <span className="map-tile-share">{percentage(entry.value, parent?.value ?? total)}{entry.partial ? ' · partial' : ''}</span>
      {!compact && !header && <span className="map-tile-action">{entry.kind === 'folder' ? 'Explore folder →' : entry.children?.length ? 'Explore group →' : entry.kind === 'filtered' ? 'Clear filter →' : 'Size details'}</span>}
    </button>;
  };
  return <section className="folder-map" aria-label="Interactive folder map">
    <div className="storage-explorer">
      <div className="storage-map-column">
        <div className="map-heading"><div><h3 id="storage-map-title" tabIndex={-1}>{group ? 'Items in this group' : 'Folder map'}</h3><p>Click a folder to explore. Large tiles preview one level inside.</p></div></div>
        <div ref={surface} className="treemap-surface" style={{ height: consistent && total > 0 ? height : 110 }}>
          {consistent && rectangles.map(rect => {
            const { entry, width: w, height: h } = rect;
            const nested = w >= 190 && h >= 155 && entry.preview?.some(child => child.kind === 'folder' && child.value > 0) && sumEntries(entry.preview) === entry.value;
            if (!nested) return tile(rect);
            const inset = 5, header = 42, innerW = w - inset * 2, innerH = h - header - inset;
            return <div key={entry.id} className={`map-branch map-color-${mapColor(entry.path ?? entry.id)} ${matches(entry) ? 'map-branch-active' : ''}`} style={bounds(rect)}>
              {tile({ ...rect, x: 0, y: 0, height: header }, undefined, true)}
              <div className="map-preview" role="group" aria-label={`Inside ${entry.name}`} style={{ left: inset, top: header, width: innerW, height: innerH }}>
                {layoutTreemap(visibleEntries(entry.preview!, innerW < 520), innerW, innerH).map(child => tile(child, entry))}
              </div>
            </div>;
          })}
          {!consistent ? <p className="map-empty">The retained folder sizes do not match this report’s total. Run a new scan to show a reliable map.</p> : !total && <p className="map-empty">No measured bytes to map in this location.</p>}
        </div>
        <div className="map-caption" aria-live="polite">{selected ? <><strong>{selected.parent ? `${selected.parent.name} / ` : ''}{selected.entry.name}</strong><span>{bytes(selected.entry.value)} · {percentage(selected.entry.value, total)} of this {group ? 'group' : 'location'}{selected.entry.partial ? ' · partial measurement' : ''}</span><small>{selected.entry.detail}</small></> : <><strong>Follow the space</strong><span>Hover or focus an item to match it in the map and list.</span><small>Area shows measured size. Inner tiles show the contents of their parent folder. Colors distinguish items.</small></>}</div>
      </div>
      <section className="storage-detail-list" aria-label="Map details">
        <div className="storage-list-heading"><h3>{group ? 'Group contents' : 'Folder details'}</h3><span>{rows.length.toLocaleString()} {rows.length === 1 ? 'item' : 'items'} · largest first</span></div>
        <div className="storage-rows">{rows.slice(shownPage * pageSize, (shownPage + 1) * pageSize).map(entry => <div key={entry.id}
          className={`${entry.kind === 'folder' ? 'storage-row' : 'storage-item'} storage-map-row map-color-${mapColor(entry.path ?? entry.id)} ${matches(entry) ? 'storage-row-active' : ''}`}
          data-map-id={entry.id} onMouseEnter={() => setHovered({ entry })} onMouseLeave={() => setHovered(null)}>
          <button className={`storage-entry ${entry.kind === 'folder' ? 'storage-folder' : ''}`} data-navigation-id={entry.kind === 'folder' ? `storage-row-${entry.id.slice(7)}` : `legend-${entry.id}`} title={entry.path ? visiblePath(entry.path) : entry.detail}
            onClick={() => activate(entry)} onFocus={() => { setHovered(null); setFocused({ entry }); }} onBlur={() => setFocused(null)}>
            <i className="map-swatch" aria-hidden="true"/><span className="storage-entry-name">{entry.name}<small>{entry.files !== undefined ? `${entry.files.toLocaleString()} files` : entry.kind === 'files' || entry.kind === 'group' ? 'Explore group' : entry.kind === 'file' ? 'File sample' : 'Measured bytes'}{entry.partial ? ' · partial' : ''}</small></span>
            <span className="storage-size">{bytes(entry.value)}<small>{percentage(entry.value, total)}</small></span><span className="storage-entry-arrow" aria-hidden="true">{entry.kind === 'folder' || entry.children?.length || entry.kind === 'filtered' ? '›' : ''}</span>
          </button>
          {renderReview(entry)}
        </div>)}{!rows.length && <p className="muted">No retained items in this view.</p>}</div>
        {rows.length > pageSize && <div className="pagination"><span>{shownPage * pageSize + 1}–{Math.min(rows.length, (shownPage + 1) * pageSize)} of {rows.length} items</span><div><button disabled={!shownPage} onClick={() => onPageChange(shownPage - 1)}>Previous</button><button disabled={(shownPage + 1) * pageSize >= rows.length} onClick={() => onPageChange(shownPage + 1)}>Next</button></div></div>}
      </section>
    </div>
  </section>;
}
