import { bytes } from './analysis';
import { findingTitle, folderName, reviewCandidates, reviewStep } from './insights';
import type { Finding, Report } from './types';

interface Props {
  report: Report;
  protectedPaths: string[];
  onInspect: (finding: Finding) => void;
  onCoverage: () => void;
}

export function ResultInsights({ report, protectedPaths, onInspect, onCoverage }: Props) {
  const candidates = reviewCandidates(report.findings, protectedPaths);
  const top = candidates.slice(0, 3);
  const total = candidates.reduce((sum, finding) => sum + finding.logicalBytes, 0);
  const location = (f: Finding) => report.projects.find(p => p.id === f.projectId)?.name ?? 'Shared / global';
  return <section className="result-insights" aria-label="What your scan tells you">
    <div className="takeaway-heading"><div><span className="eyebrow">YOUR SCAN, EXPLAINED</span><h2>{candidates.length ? <><strong>{bytes(total)}</strong> in {candidates.length} {candidates.length === 1 ? 'location' : 'locations'} to review</> : 'No complete review candidates in this scan'}</h2>
      <p>{candidates.length ? 'Start with the largest fully measured, unprotected locations. Each needs its own checks before you make changes.' : report.findings.length ? 'The identified data is protected, incomplete or empty. Review the breakdown and scan coverage to understand what was measured.' : 'Files were measured, but none matched a supported developer-storage category. This does not establish that the workspace has nothing worth investigating.'}</p>
    </div>{!report.complete && <button className="coverage-callout" onClick={onCoverage}>{report.cancelled ? 'Scan cancelled' : 'Partial coverage'}<span>Check what is missing →</span></button>}</div>
    {top.length > 0 && <div className="insight-cards">{top.map((f, index) => <article className={`insight-card panel ${index === 0 ? 'first-insight' : ''}`} key={f.id}>
      <div className="insight-topline"><span>{index === 0 ? 'START HERE' : 'ALSO WORTH A LOOK'}</span><strong>{bytes(f.logicalBytes)}</strong></div>
      <h3>{findingTitle(f)}</h3><p className="insight-location" title={f.path}>{location(f)} <span>/ {folderName(f.path)}</span></p>
      <p className="insight-step">{reviewStep(f, protectedPaths)}</p>
      <button className={index === 0 ? 'review-item primary' : 'review-item'} onClick={() => onInspect(f)}>Review {folderName(f.path)} <span aria-hidden="true">→</span></button>
    </article>)}</div>}
  </section>;
}
