import { useId, useState, type Dispatch, type SetStateAction } from 'react';
import { pathsOverlap, removeProtectionRule, samePath, visiblePath } from './analysis';
import type { Finding } from './types';

interface Props {
  finding: Finding;
  findings: Finding[];
  paths: string[];
  setPaths: Dispatch<SetStateAction<string[]>>;
}

export function ProtectionControls({ finding, findings, paths, setPaths }: Props) {
  const [pendingRule, setPendingRule] = useState<string | null>(null);
  const helpId = useId();
  if (finding.risk === 'protected') return null;
  const matching = paths.filter(path => pathsOverlap(path, finding.path));
  const direct = matching.some(path => samePath(path, finding.path));
  const shared = matching.filter(path => !samePath(path, finding.path));
  const remove = (rule: string) => {
    setPaths(previous => removeProtectionRule(previous, rule));
    setPendingRule(null);
  };

  return <>
    {!matching.length && <button aria-describedby={helpId} onClick={() => setPaths(previous => [...previous, finding.path])}>Exclude from review</button>}
    {direct && <button aria-describedby={helpId} onClick={() => remove(finding.path)}>Remove my exclusion</button>}
    <p id={helpId} className="protection-help">{matching.length ? 'Your preference keeps this finding out of review suggestions. It still appears in scan results and counts as Protected.' : 'Keeps this folder in scan results, but counts it as Protected and excludes it from review suggestions.'} This also applies to findings inside the folder or containing it. It does not lock or back up files.</p>
    {shared.length > 0 && <section className="note" aria-label="Shared protection rules">
      <h3>Excluded by another folder preference</h3>
      <p>A saved preference for a parent or child folder excludes this finding from review. Check that rule before removing it.</p>
      {shared.map(rule => {
        const affected = findings.filter(item => pathsOverlap(rule, item.path)).length;
        return <div key={rule}>
          <div className="path-block">{visiblePath(rule)}</div>
          <p>Applies to {affected} {affected === 1 ? 'finding' : 'findings'} in this report. Paths outside this scan may also be affected.</p>
          {pendingRule === rule ? <>
            <p>Removing this rule affects all paths it covers. Other saved preferences and the scanner’s protected categories still apply.</p>
            <button onClick={() => remove(rule)}>Remove rule for all covered paths</button>
            <button onClick={() => setPendingRule(null)}>Keep exclusion</button>
          </> : <button onClick={() => setPendingRule(rule)}>Review removal</button>}
        </div>;
      })}
    </section>}
  </>;
}
