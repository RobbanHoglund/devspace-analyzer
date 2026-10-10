import { describe, expect, it } from 'vitest';
import { pageBounds } from './pagination';

describe('pagination after result-count changes', () => {
  it.each([0, 1, 50, 51, 100, 101])('keeps %i results inside valid bounds', count => {
    for (const requested of [-1, 0, 1, 2, 500, NaN]) {
      const b = pageBounds(requested, count);
      expect(b.page).toBeGreaterThanOrEqual(0);
      expect(b.page).toBeLessThanOrEqual(b.last);
      expect(b.from).toBeLessThanOrEqual(b.end);
      expect(b.end).toBeLessThanOrEqual(count);
      if (count > 0) expect(b.end - b.start).toBeGreaterThan(0);
    }
  });
  it('clamps the 51-to-50 transition before rendering', () => {
    expect(pageBounds(1, 51)).toMatchObject({ page: 1, from: 51, end: 51 });
    expect(pageBounds(1, 50)).toMatchObject({ page: 0, from: 1, end: 50 });
  });
  it('handles empty and replaced reports without reversed ranges', () => {
    expect(pageBounds(2, 0)).toMatchObject({ page: 0, from: 0, end: 0 });
    expect(pageBounds(2, 1)).toMatchObject({ page: 0, from: 1, end: 1 });
  });
});
