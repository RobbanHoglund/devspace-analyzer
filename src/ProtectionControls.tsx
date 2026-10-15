import { useState, type Dispatch, type SetStateAction } from 'react';
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
  if (finding.risk === 'protected') return null;
  const matching = paths.filter(path => pathsOverlap(path, finding.path));
  const direct = matching.some(path => samePath(path, finding.path));
  const shared = matching.filter(path => !samePath(path, finding.path));
  const remove = (rule: string) => {
    setPaths(previous => removeProtectionRule(previous, rule));
    setPendingRule(null);
  };

  return <>
    {!matching.length && <button onClick={() => setPaths(previous => [...previous, finding.path])}>Protect this path</button>}
    {direct && <button onClick={() => remove(finding.path)}>Remove personal protection</button>}
    {shared.length > 0 && <section className="note" aria-label="Shared protection rules">
      <h3>Protection from other paths</h3>
      <p>A saved parent or child folder protects this finding. Review that rule before removing it.</p>
      {shared.map(rule => {
        const affected = findings.filter(item => pathsOverlap(rule, item.path)).length;
        return <div key={rule}>
          <div className="path-block">{visiblePath(rule)}</div>
          <p>Applies to {affected} {affected === 1 ? 'finding' : 'findings'} in this report. Paths outside this scan may also be affected.</p>
          {pendingRule === rule ? <>
            <p>Removing this rule affects all paths it covers. Other saved rules and intrinsic protection remain.</p>
            <button onClick={() => remove(rule)}>Remove rule for all covered paths</button>
            <button onClick={() => setPendingRule(null)}>Keep protection</button>
          </> : <button onClick={() => setPendingRule(rule)}>Review removal</button>}
        </div>;
      })}
    </section>}
  </>;
}
