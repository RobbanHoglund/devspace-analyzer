import { bytes, summarize } from './analysis';
import { unclassifiedMeasuredBytes } from './measurement';
import type { Report } from './types';

interface Props {
  report: Report;
  protectedPaths: string[];
  onInspect: (filter: 'candidates' | 'protected' | 'incomplete' | 'coverage') => void;
}

export function ScanSummary({ report, protectedPaths, onInspect }: Props) {
  const totals = summarize(report.findings, protectedPaths);
  const other = unclassifiedMeasuredBytes(report);
  const parts: { key: 'candidates' | 'protected' | 'incomplete' | 'coverage'; name: string; value: number | null; detail: string }[] = [
    { key: 'candidates', name: 'To review', value: totals.candidates, detail: 'Fully measured · not protected' },
    { key: 'protected', name: 'Protected', value: totals.protected, detail: 'Preserve unique or protected data' },
    ...(totals.incomplete ? [{ key: 'incomplete' as const, name: 'Incomplete findings', value: totals.incomplete, detail: 'Resolve coverage before review' }] : []),
    { key: 'coverage', name: 'Other measured files', value: other, detail: 'No supported category · not assessed' },
  ];
  return <section className="scan-summary panel" aria-label="Scan summary">
    <div className="measurement-heading"><strong>{bytes(report.progress.logicalBytes)} measured</strong><span>{bytes(totals.identified)} identified developer data</span></div>
    {other !== null && <div className="measurement-strip" aria-hidden="true">{parts.map(part => <span key={part.key} className={`measure-${part.key}`} style={{ width: `${(part.value ?? 0) / Math.max(report.progress.logicalBytes, 1) * 100}%` }}/>)}</div>}
    <div className="measurement-legend">{parts.map(part => <button key={part.key} className={`measurement-part measure-${part.key}`} onClick={() => onInspect(part.key)} disabled={part.key !== 'coverage' && !part.value}>
      <span><i/>{part.name}</span><strong>{part.value === null ? 'Unknown' : bytes(part.value)}</strong><small>{part.detail}</small>
    </button>)}</div>
    <div className="measurement-explanation" role="region" aria-label="Measurement coverage">
      <span>Logical size · not guaranteed savings</span>
      <details><summary>How these sizes fit together</summary><p><strong>{bytes(report.progress.logicalBytes)} measured</strong> · {bytes(totals.identified)} identified · {other === null ? 'Unclassified amount unavailable: measured totals are inconsistent.' : `${bytes(other)} unclassified measured data`}</p><p>Review candidates, protected data and incomplete findings are parts of identified data. Other measured files did not match a supported category; their safety and recoverability were not assessed.{!report.complete && ' Partial scan: these totals cover measured files only; unread data is not estimated.'} Logical size is not physical allocation or guaranteed savings.</p></details>
    </div>
  </section>;
}
