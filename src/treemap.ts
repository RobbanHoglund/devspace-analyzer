export interface MapEntry {
  id: string; name: string; value: number; kind: 'folder' | 'files' | 'file' | 'remainder' | 'filtered' | 'group';
  path?: string; detail: string; partial?: boolean; children?: MapEntry[];
  preview?: MapEntry[]; files?: number;
}
export interface MapRect { entry: MapEntry; x: number; y: number; width: number; height: number }
export const sumEntries = (entries: MapEntry[]) => entries.reduce((sum, entry) => sum + entry.value, 0);

/** Keep every byte while collecting small entries into an explorable group. */
export function visibleEntries(entries: MapEntry[], narrow: boolean): MapEntry[] {
  const sorted = entries.filter(e => Number.isFinite(e.value) && e.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const total = sumEntries(sorted), limit = narrow ? 8 : 18, minimum = narrow ? .035 : .012;
  // A directory with thousands of similarly sized children needs useful levels,
  // not a giant remainder that reveals only one tiny item on every click.
  if (sorted.length > limit && sorted[0].value / total < minimum) {
    const batch = Math.ceil(sorted.length / limit);
    return Array.from({ length: Math.ceil(sorted.length / batch) }, (_, index) => {
      const children = sorted.slice(index * batch, (index + 1) * batch);
      return { id: `group-${children[0].id}`, name: `Items ${index * batch + 1}–${index * batch + children.length}`, value: sumEntries(children), kind: 'group' as const, detail: `${children.length} items, ordered by size. Open to explore.`, children };
    });
  }
  const kept: MapEntry[] = [], grouped: MapEntry[] = [];
  for (const entry of sorted) {
    if (kept.length < limit && (entry.value / total >= minimum || !kept.length)) kept.push(entry);
    else grouped.push(entry);
  }
  if (grouped.length === 1) kept.push(grouped[0]);
  else if (grouped.length) kept.push({ id: 'smaller-entries', name: `${grouped.length} smaller items`, value: sumEntries(grouped), kind: 'group', detail: 'Open this group to explore its folders and files.', children: grouped });
  return kept;
}

/** Weighted binary partitioning: rectangle area is proportional to measured bytes. */
export function layoutTreemap(entries: MapEntry[], width: number, height: number): MapRect[] {
  if (!(width > 0 && height > 0)) return [];
  const items = entries.filter(e => Number.isFinite(e.value) && e.value > 0).sort((a, b) => b.value - a.value || a.id.localeCompare(b.id));
  const result: MapRect[] = [];
  const split = (items: MapEntry[], x: number, y: number, w: number, h: number) => {
    if (!items.length) return;
    if (items.length === 1) { result.push({ entry: items[0], x, y, width: w, height: h }); return; }
    const total = sumEntries(items); let sum = items[0].value, index = 1;
    while (index < items.length - 1 && Math.abs(sum + items[index].value - total / 2) < Math.abs(sum - total / 2)) sum += items[index++].value;
    const ratio = sum / total;
    if (w >= h) { split(items.slice(0, index), x, y, w * ratio, h); split(items.slice(index), x + w * ratio, y, w * (1 - ratio), h); }
    else { split(items.slice(0, index), x, y, w, h * ratio); split(items.slice(index), x, y + h * ratio, w, h * (1 - ratio)); }
  };
  split(items, 0, 0, width, height); return result;
}

export function mapColor(id: string): number {
  let hash = 0; for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(hash) % 6;
}
export function percentage(value: number, total: number): string {
  if (!total || !value) return '0%';
  const percent = value / total * 100;
  return percent < .1 ? '<0.1%' : `${percent.toLocaleString('en-GB', { maximumFractionDigits: 1 })}%`;
}
