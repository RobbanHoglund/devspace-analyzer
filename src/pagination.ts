export const PAGE_SIZE = 50;

/** Render from a clamped page immediately; do not wait for an effect to repair
 * state after a filter/protection/report change. */
export function pageBounds(requested: number, count: number) {
  const total = Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
  const last = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1);
  const page = Math.min(last, Number.isFinite(requested) ? Math.max(0, Math.floor(requested)) : 0);
  const start = page * PAGE_SIZE;
  return { page, last, start, end: Math.min(total, start + PAGE_SIZE), from: total ? start + 1 : 0, total };
}
