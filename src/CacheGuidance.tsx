import { Icon } from './Icon';
import { useEffect, useRef, useState } from 'react';
import { bytes, visiblePath } from './analysis';
import { inVSCode, invoke } from './host';
import { cacheActions, cacheCommand, cacheFor, guidanceActions, guidanceBlocked, type CacheAction } from './cleanupGuide';
import { DocumentationLink } from './DocumentationLink';
import type { Finding, Report } from './types';

export function CleanupOverview({ report, protectedPaths, disabled, includeCaches, onSettings, onOpen }: { report: Report; protectedPaths: string[]; disabled: boolean; includeCaches: boolean; onSettings(): void; onOpen(f: Finding): void }) {
  const caches = report.findings.filter(f => guidanceActions(f, report).length).sort((a,b) => b.logicalBytes-a.logicalBytes);
  return <section className="panel cleanup-overview" aria-label="Cache cleanup guidance"><div className="section-heading"><div><span className="eyebrow">YOUR NEXT STEP</span><h2>How to clean up</h2></div><span className="muted">Review · Copy · Scan again</span></div>
    <p>Review a command for your cache, run it yourself in a terminal, then scan again to compare. DevSpace never runs cleanup commands.</p>
    {caches.length ? <div className="cleanup-cards">{caches.map(f => { const blocked = guidanceBlocked(f, report, protectedPaths); return <article key={f.id}><div><strong>{f.kind === 'npm-cache' ? 'npm package cache' : f.kind === 'pnpm-store' ? 'pnpm store' : 'pip cache'}</strong><b>{bytes(f.logicalBytes)}{!f.complete && ' · partial'}</b></div><p className="mono">{visiblePath(f.path)}</p><button disabled={disabled} onClick={() => onOpen(f)}><Icon name="guide"/>How to clean up</button>{blocked && <small>{blocked}</small>}</article>; })}</div> : <div className="cleanup-empty"><strong>No npm, pnpm or pip cache identified in this scan.</strong><p>{includeCaches ? 'Check Scan coverage for discovered locations and warnings. A custom cache can also be scanned by choosing its folder.' : 'Open Scan settings, enable “Include known shared caches”, then scan again.'} Gradle, Maven and project folders have individual review guidance under Findings.</p><button disabled={disabled} onClick={onSettings}><Icon name="settings"/>Open scan settings</button></div>}
    <p className="tiny muted">Measured cache sizes are logical bytes. The amount you can actually free is not known.</p>
  </section>;
}

export function CleanupGuide({ finding, report, protectedPaths, demo, canRescan, onClose, onRescan }: { finding: Finding; report: Report; protectedPaths: string[]; demo: boolean; canRescan: boolean; onClose(): void; onRescan(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const actions = guidanceActions(finding, report);
  const [action, setAction] = useState<CacheAction>(actions[0]);
  const [copied, setCopied] = useState('');
  const cache = cacheFor(finding, report)!;
  const blocked = guidanceBlocked(finding, report, protectedPaths);
  const command = blocked ? null : cacheCommand(action, cache.path);
  const guide = cacheActions[action];
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); if (opener?.isConnected) opener.focus(); };
  }, []);
  async function copy(text: string) {
    try {
      if (inVSCode) await invoke('copy_text', { text });
      else await navigator.clipboard.writeText(text);
      setCopied('Copied. Nothing was executed.');
    } catch { setCopied('Clipboard unavailable. Select the command to copy it.'); }
  }
  return <dialog className="cleanup-dialog" ref={dialog} aria-labelledby="cleanup-title" onCancel={e => { e.preventDefault(); onClose(); }}>
    <header><div><span className="eyebrow">CACHE INSTRUCTIONS</span><h2 id="cleanup-title">Manual cleanup guide</h2></div><button className="icon-button" autoFocus aria-label="Close cleanup guidance" onClick={onClose}><Icon name="close"/></button></header>
    <div className="cleanup-body">
      <p><strong>Cleanup commands never run from this window.</strong> Choose instructions to review and copy, then run the command yourself in your own terminal.</p>
      {demo && <p className="guidance-notice">Example paths from demo data. Scan your own folders for commands you can copy.</p>}
      <section className="cleanup-plan" aria-label="Measured cache"><dl><div><dt>Measured folder</dt><dd className="mono">{visiblePath(finding.path)}</dd></div><div><dt>Measured size</dt><dd>{bytes(finding.logicalBytes)}{!finding.complete && ' · partial'} · {finding.files.toLocaleString()} {finding.files === 1 ? 'file' : 'files'}</dd></div><div><dt>Tool’s cache path</dt><dd className="mono">{visiblePath(cache.path)}</dd></div></dl></section>
      <fieldset><legend>1. Choose instructions</legend>{actions.map(value => <label key={value}><input type="radio" name="cleanup-action" checked={action === value} onChange={() => { setAction(value); setCopied(''); }}/><span>{cacheActions[value].title}</span></label>)}</fieldset>
      <section className="guidance-effects"><h3>What it changes</h3><p>{guide.effect}</p><h3>What happens next</h3><p>{guide.recovery}</p></section>
      {blocked ? <p className="guidance-notice" role="status">{blocked}</p> : command ? <section aria-label="Manual commands"><h3>2. Review and run in your terminal</h3><p className="muted">{command.shell}. Use the installed tool you trust, from a folder outside a project. No tool version or live cache contents were checked by DevSpace.</p><details className="cleanup-check"><summary>Check the tool’s target first</summary><pre><code>{command.check}</code></pre><p>The printed location should match the cache above; pnpm may add its version subfolder. If it differs, stop and check your tool configuration.</p><button disabled={demo} onClick={() => void copy(command.check)}><Icon name="copy"/>Copy check command</button></details><pre aria-label="Cleanup command"><code>{command.text}</code></pre><button disabled={demo} onClick={() => void copy(command.text)}><Icon name="copy"/>Copy command</button><p className="tiny muted">Stop active package-manager jobs first. The command uses your terminal’s tool version and configuration; review the official documentation for that version.</p></section> : <p className="guidance-notice">This path needs manual shell review. No copyable command is offered for its path format or special characters. Use the tool documentation and the exact cache path above.</p>}
      <p role="status" className="copy-status">{copied}</p>
      <DocumentationLink href={guide.documentation}>Official tool documentation</DocumentationLink>
      <section className="guidance-rescan"><h3>3. Measure the difference</h3><p>After you finish in the terminal, scan the same scope again. Overview compares complete scans and shows the change in logical bytes. Other changes can affect the totals; they do not prove physical disk space was freed.</p>{(!report.complete || report.cancelled) && <p className="guidance-notice">This report is incomplete. A complete scan is needed to establish a comparison baseline.</p>}</section>
    </div>
    <footer><button onClick={onClose}><Icon name="close"/>Close</button><button className="primary" disabled={!canRescan || demo} onClick={onRescan}><Icon name="refresh"/>Scan again</button></footer>
  </dialog>;
}
