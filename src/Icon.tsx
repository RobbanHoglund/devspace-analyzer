const paths = {
  grid: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
  list: 'M8 5h13 M8 12h13 M8 19h13 M3 5h1 M3 12h1 M3 19h1',
  folder: 'M3 7V4h6l3 3h9v13H3z',
  treemap: 'M3 4h18v16H3z M11 4v16 M11 11h10',
  shield: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6z M8 12l3 3 5-6',
  scan: 'M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M7 12h10',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  back: 'M19 12H5 M11 6l-6 6 6 6',
  up: 'M12 19V5 M6 11l6-6 6 6',
  previous: 'M15 6l-6 6 6 6',
  next: 'M9 6l6 6-6 6',
  down: 'M6 9l6 6 6-6',
  download: 'M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5',
  close: 'M6 6l12 12 M6 18L18 6',
  plus: 'M12 5v14 M5 12h14',
  settings: 'M4 7h8 M16 7h4 M4 17h4 M12 17h8 M12 4v6 M8 14v6',
  guide: 'M12 5v16 M12 5C9 3 5 3 2 4v15c3-1 7-1 10 2 3-3 7-3 10-2V4c-3-1-7-1-10 1z',
  copy: 'M9 8h11v13H9z M15 8V3H4v13h5',
  external: 'M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7',
  refresh: 'M20 7a9 9 0 0 0-15-1L3 9 M3 3v6h6 M4 17a9 9 0 0 0 15 1l2-3 M21 21v-6h-6',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  eyeOff: 'M3 3l18 18 M10 5.2A12 12 0 0 1 12 5c6.5 0 10 7 10 7a20 20 0 0 1-3 4 M6 6.5A20 20 0 0 0 2 12s3.5 7 10 7a12 12 0 0 0 5-1 M10 10a3 3 0 0 0 4 4',
  search: 'M16 16l5 5 M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0',
  filterClear: 'M3 4h18l-7 8v8l-4-2v-6z M17 15l5 5 M22 15l-5 5',
  check: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M8 12l3 3 5-6',
  warning: 'M12 3 2 21h20L12 3z M12 9v5 M12 17v1',
  stop: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0 M8 8h8v8H8z',
  demo: 'M9 6v12l9-6-9-6z',
  exit: 'M9 3H3v18h6 M9 12h12 M16 7l5 5-5 5',
  home: 'm3 10 9-7 9 7v11h-6v-7H9v7H3z',
} as const;

export type IconName = keyof typeof paths;

/** Decorative: the adjacent label or the control's aria-label names the action. */
export function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={`ui-icon ${className}`} viewBox="0 0 24 24" width="16" height="16"
    fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false"><path d={paths[name]}/></svg>;
}
