import { useState } from 'react';
import { reviewPlan } from './reviewPlan';
import { visiblePath } from './analysis';
import { inVSCode, invoke } from './host';
import type { Finding, Project } from './types';

export function ReviewPlan({ finding, projects, protectedPaths, demo }: { finding: Finding; projects: Project[]; protectedPaths: string[]; demo: boolean }) {
  const plan = reviewPlan(finding, projects, protectedPaths);
  const [copyState, setCopyState] = useState('');
  const copy = async () => {
    try {
      if (inVSCode) await invoke('copy_text', { text: plan.command!.text });
      else await navigator.clipboard.writeText(plan.command!.text);
      setCopyState('Copied. Nothing was executed.');
    } catch { setCopyState('Clipboard unavailable. Select and copy the command below.'); }
  };
  return <section className="review-plan" aria-label="Project review plan"><h3>{plan.title}</h3><p>{plan.reason}</p>
    {plan.checks.length > 0 && <ul className="evidence-checks">{plan.checks.map((check, i) => <li key={i} className={`check-${check.state}`}><span>{check.state === 'found' ? 'Found' : check.state === 'missing' ? 'Resolve first' : 'Check'}</span>{check.label}</li>)}</ul>}
    <div className="plan-step"><h4>Next step</h4><p>{plan.action}</p></div>
    <div className="plan-step"><h4>How to recover</h4><p>{plan.recovery}</p></div>
    <div className="plan-step"><h4>What it costs</h4><p>{plan.tradeoff}</p></div>
    {plan.command && <details className="plan-command"><summary>{demo ? 'Example command · demo only' : plan.command.label}</summary><p>{plan.command.note}</p><span className="tiny muted">Working directory</span><p className="mono">{visiblePath(plan.directory ?? '')}</p><pre><code>{plan.command.text}</code></pre><button onClick={copy}>{demo ? 'Copy example command' : 'Copy command'}</button><p role="status">{copyState}</p></details>}
    {plan.documentation && <a href={plan.documentation} target="_blank" rel="noreferrer">Tool documentation ↗</a>}
  </section>;
}
