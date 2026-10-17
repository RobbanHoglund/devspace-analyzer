import { describe, expect, it } from 'vitest';
import { demoReport } from './demo';
import { prioritizedCandidates, reviewPlan } from './reviewPlan';
import { redactedReport } from './analysis';
describe('project recovery guidance', () => {
  it('offers the detected platform wrapper only for the full ordinary build output', () => {
    const r = demoReport(), f = r.findings[6];
    expect(reviewPlan(f, r.projects, []).command?.text).toBe('.\\gradlew.bat clean');
    expect(reviewPlan({ ...f, path: f.path.replace(/build$/, '.gradle') }, r.projects, []).command).toBeUndefined();
    expect(reviewPlan({ ...f, path: `${f.path}/classes` }, r.projects, []).command).toBeUndefined();
    r.projects[0].contextOnly = true;
    expect(reviewPlan(f, r.projects, []).command).toBeUndefined();
  });
  it('never suggests a cleanup command for protected, personally excluded or incomplete storage', () => {
    const r = demoReport(), f = r.findings[6];
    for (const changed of [{ ...f, risk: 'protected' as const }, { ...f, complete: false }]) expect(reviewPlan(changed, r.projects, []).command).toBeUndefined();
    expect(reviewPlan(f, r.projects, [f.path])).toMatchObject({ title: 'Excluded by your preference', priority: 4 });
    expect(prioritizedCandidates(r, []).at(0)?.id).toBe(f.id);
  });
  it('requires consistent npm evidence and surfaces local dependencies and patch risks', () => {
    const r = demoReport(), p = r.projects[1], f = r.findings[1];
    p.workspace = false; p.lockfiles = ['package-lock.json'];
    p.recoveryEvidence = { wrappers: [], nodeManifest: 'parsed', packageManager: 'npm', scripts: [], localDependencies: [], localDependencyCount: 0, installScripts: false, patches: false };
    expect(reviewPlan(f, r.projects, []).command?.text).toBe('npm ci');
    p.recoveryEvidence.localDependencyCount = 1; p.recoveryEvidence.localDependencies = ['private-package'];
    const blocked = reviewPlan(f, r.projects, []);
    expect(blocked.command).toBeUndefined(); expect(blocked.checks.some(c => c.label.includes('private-package') && c.state === 'missing')).toBe(true);
    p.recoveryEvidence.localDependencyCount = 0; p.lockfiles.push('yarn.lock');
    expect(reviewPlan(f, r.projects, []).command).toBeUndefined();
  });
  it('does not export private folder samples or manifest evidence in redacted summaries', () => {
    const r = demoReport(), redacted = redactedReport(r);
    expect(redacted.storage).toBeUndefined();
    expect(redacted.projects.every(p => !p.recoveryEvidence)).toBe(true);
    expect(JSON.stringify(redacted)).not.toMatch(/application\.log|catalog-ui|gateway-service|C:\\\\/);
  });
});
