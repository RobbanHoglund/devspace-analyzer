import { useRef, useState } from 'react';

export type HistoryState<T> = { past: T[]; future: T[] };

/** Session-only history. A new report starts a new history. */
export function useNavigationHistory<T>() {
  const state = useRef<HistoryState<T>>({ past: [], future: [] });
  const [, render] = useState(0);
  const update = (next: HistoryState<T>) => { state.current = next; render(value => value + 1); };
  return {
    previous: state.current.past.at(-1), next: state.current.future.at(-1),
    save: () => state.current,
    reset: (saved: HistoryState<T> = { past: [], future: [] }) => update(saved),
    push: (current: T) => update({ past: [...state.current.past, current].slice(-100), future: [] }),
    move: (direction: 'back' | 'forward', current: T): T | undefined => {
      const { past, future } = state.current;
      const target = (direction === 'back' ? past : future).at(-1);
      if (target === undefined) return;
      update(direction === 'back'
        ? { past: past.slice(0, -1), future: [...future, current] }
        : { past: [...past, current], future: future.slice(0, -1) });
      return target;
    },
  };
}
