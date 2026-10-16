import { bytes, visiblePath } from './analysis';
import { comparisonUnavailable, findingChanges, type ScanSnapshot } from './scanComparison';
import { unclassifiedMeasuredBytes } from './measurement';
import type { ScanScope } from './scanScope';
import type { Finding, Report } from './types';

const change = (delta: number) => `${delta < 0 ? '−' : '+'}${bytes(Math.abs(delta))}`;
export function ScanComparison({ report, scope, previous, demo, disabled, onRescan, onInspect }: { report: Report; scope: ScanScope | null; previous: ScanSnapshot | null; demo: boolean; disabled: boolean; onRescan: () => void; onInspect: (finding: Finding) => void }) {
  const unavailable = demo ? 'Demo figures are illustrative. Scan a real folder to start measuring changes.' : comparisonUnavailable(report, scope, previous);
  const delta = previous ? report.progress.logicalBytes - previous.logicalBytes : 0;
  const rows = !unavailable && previous ? findingChanges(report, previous) : [];
  const unknownDelta = previous ? (unclassifiedMeasuredBytes(report) ?? 0) - previous.unclassifiedBytes : 0;
  return <section className="scan-comparison panel" aria-label="Changes since previous scan"><div className="section-heading"><div><span className="eyebrow">MEASURE THE RESULT</span><h2>{unavailable ? 'Compare after your next scan' : delta === 0 ? 'Measured size is unchanged' : `${bytes(Math.abs(delta))} ${delta < 0 ? 'less' : 'more'} measured`}</h2></div><button disabled={disabled || demo || !scope} onClick={onRescan}>Rescan the same scope</button></div>
    {unavailable ? <p className="muted">{unavailable}</p> : <><div className="comparison-totals"><span>Before <strong>{bytes(previous!.logicalBytes)}</strong></span><span>Now <strong>{bytes(report.progress.logicalBytes)}</strong></span><span className={delta < 0 ? 'change-down' : delta > 0 ? 'change-up' : ''}>Net change <strong>{change(delta)}</strong></span></div><p className="tiny muted">Compared with {new Date(previous!.startedAt * 1000).toLocaleString('en-GB')} · same scan scope. Logical file sizes; this does not measure physical disk space reclaimed or establish the cause.</p>
      {!!rows.length && <details className="comparison-details"><summary>{rows.length} changed classified {rows.length === 1 ? 'location' : 'locations'}</summary>{rows.slice(0, 20).map(row => <div className="comparison-row" key={row.path}><div>{row.current ? <button className="text-button" onClick={() => onInspect(row.current!)}>{visiblePath(row.path)}</button> : <span className="mono">{visiblePath(row.path)}</span>}<small>{row.status}</small></div><strong className={row.delta < 0 ? 'change-down' : 'change-up'}>{change(row.delta)}</strong></div>)}{rows.length > 20 && <p className="muted">Showing the 20 largest changes.</p>}<p className="tiny muted">A missing finding can also mean a rename or changed classification. It is not proof of deletion.</p></details>}
      {unknownDelta !== 0 && <p className="unclassified-change">Other measured files changed by <strong>{change(unknownDelta)}</strong>.</p>}
      {!previous!.allFindings && <p className="tiny muted">The saved baseline retains the largest 5,000 findings within its size limit. Individual changes are shown only for retained baseline locations; the net total covers the full scan.</p>}
    </>}
  </section>;
}
