import { useEffect, useRef, useState } from 'react';
import { bytes, visiblePath } from './analysis';
import { inVSCode, invoke, listen, native } from './host';
import { cleanupActions, cleanupBlocked, cleanupLabels } from './cleanupOptions';
import type { CleanupAction, CleanupOutcome, CleanupPlan } from './cleanupTypes';
import type { Finding, Report } from './types';

export function CleanupOverview({ report, protectedPaths, disabled, onOpen }: { report: Report; protectedPaths: string[]; disabled: boolean; onOpen(f: Finding): void }) {
  const caches = report.findings.filter(f => cleanupActions(f, report).length).sort((a,b) => b.logicalBytes-a.logicalBytes);
  if (!caches.length) return null;
  return <section className="panel cleanup-overview" aria-label="Cache maintenance"><div className="section-heading"><div><span className="eyebrow">TAKE ACTION</span><h2>Maintain your caches</h2></div><span className="muted">Preview → Run → Measure</span></div>
    <p>Use the package manager’s own maintenance command. Every action starts with a preview; scanning changes nothing.</p>
    <div className="cleanup-cards">{caches.map(f => { const blocked = cleanupBlocked(f, report, protectedPaths); return <article key={f.id}><div><strong>{f.kind === 'npm-cache' ? 'npm package cache' : f.kind === 'pnpm-store' ? 'pnpm store' : 'pip cache'}</strong><b>{bytes(f.logicalBytes)}</b></div><p className="mono" title={f.path}>{visiblePath(f.path)}</p><button disabled={disabled || !!blocked} title={blocked || undefined} onClick={() => onOpen(f)}>Review cleanup →</button>{blocked && <small>{blocked}</small>}</article>; })}</div>
    <p className="tiny muted">Logical cache sizes, not predicted savings. Gradle, Maven and project output keep their manual review guidance.</p>
  </section>;
}

export function CleanupDialog({ finding, report, onClose, onExecuted }: { finding: Finding; report: Report; onClose(): void; onExecuted(): Promise<void> }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const actions = cleanupActions(finding, report);
  const [action, setAction] = useState<CleanupAction>(actions[0]);
  const [phase, setPhase] = useState<'choose'|'preparing'|'ready'|'running'|'done'>('choose');
  const [plan, setPlan] = useState<CleanupPlan | null>(null);
  const [outcome, setOutcome] = useState<CleanupOutcome | null>(null);
  const [log, setLog] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [stopping, setStopping] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const lock = useRef(false);
  const cancelRequested = useRef(false);
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => { dialog.current?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  useEffect(() => {
    let off: (() => void) | undefined; let disposed = false;
    if (native) listen<string>('cleanup-log', e => setLog(old => (old + e.payload).slice(-140_000))).then(fn => { if (disposed) fn(); else off = fn; }).catch(e => setError(String(e)));
    return () => { disposed = true; off?.(); };
  }, []);
  async function prepare() {
    if (lock.current) return; lock.current = true;
    cancelRequested.current = false;
    setPhase('preparing'); setError(''); setStopping(false); setLog('');
    try {
      const prepared = await invoke<CleanupPlan>('prepare_cleanup', { id: finding.id, action, expectedPath: finding.path });
      if (cancelRequested.current) { setPlan(null); setPhase('choose'); setError('Preparation stopped. Nothing was cleaned.'); }
      else { setPlan(prepared); setPhase('ready'); }
    }
    catch (e) { setError(String(e)); setPhase('choose'); }
    finally { lock.current = false; setStopping(false); }
  }
  async function run() {
    if (!plan || lock.current) return; lock.current = true;
    setPhase('running'); setError(''); setCopied('');
    try { const result = await invoke<CleanupOutcome>('run_cleanup', { id: plan.id }); setOutcome(result); setLog(result.log); }
    catch (e) { setError(String(e)); }
    finally {
      setPhase('done'); setStopping(false); setRefreshing(true);
      try { await onExecuted(); } finally { setRefreshing(false); lock.current = false; }
    }
  }
  async function cancel() {
    cancelRequested.current = true;
    setStopping(true);
    try { await invoke('cancel_cleanup'); }
    catch (e) { setError(String(e)); setStopping(false); }
  }
  async function close() {
    if (lock.current || refreshing) return;
    try { if (phase === 'ready') await invoke('cancel_cleanup'); onClose(); }
    catch (e) { setError(String(e)); }
  }
  async function copy() {
    if (!plan) return;
    try { if (inVSCode) await invoke('copy_text', { text: plan.command }); else await navigator.clipboard.writeText(plan.command); setCopied('Copied. Manual execution uses your shell’s environment.'); }
    catch { setCopied('Clipboard unavailable. Select the command to copy it.'); }
  }
  const change = outcome?.afterBytes == null ? null : outcome.beforeBytes - outcome.afterBytes;
  const documentation = action.startsWith('npm-') ? 'https://docs.npmjs.com/cli/v11/commands/npm-cache/' : action === 'pnpm-prune' ? 'https://pnpm.io/cli/store' : 'https://pip.pypa.io/en/stable/cli/pip_cache/';
  return <dialog className="cleanup-dialog" ref={dialog} aria-labelledby="cleanup-title" onCancel={e => { e.preventDefault(); void close(); }}>
    <header><div><span className="eyebrow">CACHE MAINTENANCE</span><h2 id="cleanup-title">{phase === 'done' ? 'Maintenance result' : 'Review before running'}</h2></div><button aria-label="Close cleanup" onClick={() => void close()} disabled={phase === 'preparing' || phase === 'running' || refreshing}>×</button></header>
    <ol className="cleanup-steps" aria-label="Cleanup progress">{['Preview','Run','Measure'].map((label,i) => <li key={label} aria-current={(phase === 'done' ? 2 : phase === 'running' ? 1 : 0) === i ? 'step' : undefined}><span>{i+1}</span>{label}</li>)}</ol>
    {(phase === 'choose' || phase === 'preparing') && <>
      <p>Choose what the owning tool should do with <strong>{finding.label}</strong>.</p><div className="path-block">{visiblePath(finding.path)}</div>
      <fieldset disabled={phase === 'preparing'}><legend>Maintenance action</legend>{actions.map(value => <label key={value}><input type="radio" name="cleanup-action" checked={action === value} onChange={() => setAction(value)}/><span><strong>{cleanupLabels[value]}</strong><small>{value === 'npm-verify' ? 'Check integrity and remove unneeded data. This also changes the cache.' : value === 'npm-clean' ? 'Remove all cached npm package data; downloads will be needed again.' : value === 'pnpm-prune' ? 'Remove packages pnpm considers unreferenced.' : 'Remove cached HTTP downloads and built wheels.'}</small></span></label>)}</fieldset>
      <p className="muted">Preparing checks the installed tool and measures the target. It does not run maintenance.</p>
      <p className="tiny muted">Supported: npm 8–11, pnpm 8–10, pip 21–26. Direct CLI installations are required; wrapper launchers and Corepack are not executed.</p>
      <a href={documentation} target="_blank" rel="noreferrer">Manual guidance from the package manager ↗</a>
    </>}
    {plan && <section className="cleanup-plan" aria-label="Cleanup preview"><div className="cleanup-plan-heading"><h3>{plan.title}</h3><span>{plan.toolVersion}</span></div>
      <dl><div><dt>Target measured</dt><dd className="mono">{visiblePath(plan.targetPath)}</dd></div><div><dt>Configured cache</dt><dd className="mono">{visiblePath(plan.cachePath)}</dd></div><div><dt>Before</dt><dd>{bytes(plan.beforeBytes)} · {plan.beforeFiles.toLocaleString()} files</dd></div></dl>
      {phase === 'ready' && <ul>{plan.effects.map(text => <li key={text}>{text}</li>)}</ul>}
      <details className="cleanup-command" open={phase === 'ready'}><summary>Exact command · {plan.shell}</summary><pre><code>{plan.command}</code></pre><p className="tiny muted">The app uses an isolated temporary working directory and configuration. A copied command uses your shell’s environment; run it outside a project.</p><button onClick={copy}>Copy command</button><span role="status">{copied}</span></details>
    </section>}
    {outcome && <section className={`cleanup-result result-${outcome.status}`} aria-label="Cleanup result"><h3>{outcome.status === 'succeeded' ? 'Command completed' : outcome.status === 'cancelled' ? 'Command stopped' : outcome.status === 'timed-out' ? 'Command timed out' : 'Command failed'}</h3>
      {outcome.status !== 'succeeded' && <p>The command may have made partial changes. Review the log before trying again.</p>}
      <div className="cleanup-measures"><div><span>Before</span><strong>{bytes(outcome.beforeBytes)}</strong></div><div><span>After</span><strong>{outcome.afterBytes === null ? 'Unavailable' : bytes(outcome.afterBytes)}</strong></div><div><span>{change !== null && change < 0 ? 'Logical increase' : 'Logical decrease'}</span><strong>{change === null ? 'Unverified' : bytes(Math.abs(change))}</strong></div></div>
      <p className="tiny muted">Measured logical bytes, not physical disk space freed. Other running tools can affect these totals.{outcome.exitCode !== null && ` Exit code: ${outcome.exitCode}.`}</p>{outcome.measurementError && <p role="alert">After-measurement failed: {outcome.measurementError}</p>}
    </section>}
    {(phase === 'running' || phase === 'done') && <details className="cleanup-log" open><summary>Command log</summary><pre role="log" aria-label="Cleanup command log">{log || (phase === 'done' ? 'No command output was returned.' : 'Waiting for command output…')}</pre></details>}
    {error && <p className="cleanup-error" role="alert">{error}</p>}
    <footer><span role="status">{phase === 'preparing' ? stopping ? 'Stopping preparation…' : 'Checking tool and cache…' : phase === 'running' ? stopping ? 'Stopping; completed changes remain…' : 'Running native maintenance…' : refreshing ? 'Refreshing the original scan scope…' : phase === 'ready' ? 'Preview expires after five minutes.' : ''}</span><div>
      {phase === 'choose' && <button className="primary" onClick={prepare}>Prepare preview</button>}
      {phase === 'ready' && <><button onClick={async () => { await invoke('cancel_cleanup'); setPlan(null); setPhase('choose'); }}>Change action</button><button className="primary" onClick={run}>Run {action === 'npm-verify' ? 'verification' : 'cleanup'}</button></>}
      {(phase === 'preparing' || phase === 'running') && <button disabled={stopping} onClick={cancel}>Stop {phase === 'preparing' ? 'preparing' : 'command'}</button>}
      {phase === 'done' && <button className="primary" disabled={refreshing} onClick={() => void close()}>Done</button>}
    </div></footer>
  </dialog>;
}
