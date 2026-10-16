import { describe, expect, it } from 'vitest';
import { layoutTreemap, percentage, sumEntries, visibleEntries, type MapEntry } from './treemap';
const entry = (value: number, index = 0): MapEntry => ({ id: `folder-${index}`, name: `Folder ${index}`, kind: 'folder', detail: 'fixture', value });

describe('storage area accounting', () => {
  it('preserves proportional area without overlaps in wide and narrow views', () => {
    const items = [107900, 59100, 13300, 11000, 9600, 3600, 1300, 752, 473, 1].map(entry), total = sumEntries(items);
    for (const [width, height] of [[1200, 390], [280, 270]]) {
      const rectangles = layoutTreemap(items, width, height);
      expect(rectangles).toHaveLength(items.length);
      for (const r of rectangles) {
        expect(r.width * r.height / (width * height)).toBeCloseTo(r.entry.value / total, 10);
        expect(r.x + r.width).toBeLessThanOrEqual(width + 1e-9); expect(r.y + r.height).toBeLessThanOrEqual(height + 1e-9);
        for (const b of rectangles) if (r !== b) {
          const overlap = Math.max(0, Math.min(r.x + r.width, b.x + b.width) - Math.max(r.x, b.x)) * Math.max(0, Math.min(r.y + r.height, b.y + b.height) - Math.max(r.y, b.y));
          expect(overlap).toBeLessThan(1e-7);
        }
      }
    }
  });
  it('groups thousands of small entries without dropping bytes or making folders inaccessible', () => {
    const source = [entry(1_000_000), ...Array.from({ length: 9999 }, (_, i) => entry(i + 1, i + 1))];
    const seen = new Set<string>();
    const visit = (items: MapEntry[]) => {
      const displayed = visibleEntries(items, true);
      expect(displayed.length).toBeLessThanOrEqual(9); expect(sumEntries(displayed)).toBe(sumEntries(items));
      for (const item of displayed) item.children ? visit(item.children) : seen.add(item.id);
    };
    visit(source); expect(seen.size).toBe(source.length);
  });
  it('does not invent area for zero or invalid values', () => {
    expect(layoutTreemap([entry(0), entry(-1), entry(NaN)], 100, 100)).toEqual([]);
    expect(layoutTreemap([entry(10)], 0, 100)).toEqual([]);
    expect(layoutTreemap([entry(10)], 100, 100)[0]).toMatchObject({ x: 0, y: 0, width: 100, height: 100 });
    expect(percentage(1, 10000)).toBe('<0.1%');
  });
});
