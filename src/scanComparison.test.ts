import { describe, expect, it } from 'vitest';
import { demoReport } from './demo';
import { comparisonUnavailable, findingChanges, makeSnapshot, readSnapshot } from './scanComparison';
const scope = { roots: ['C:/Workspaces'], includeCaches: false };
function report() { const r = demoReport(); r.complete = true; r.warnings = []; r.warningCount = 0; return r; }
describe('scan comparison uses complete, comparable observations', () => {
  it('matches locations by normalized path, independent of finding IDs and protection preferences', () => {
    const before = report(), snapshot = makeSnapshot(before, scope)!;
    const after = structuredClone(before); after.findings[0].id = 'new-id'; after.findings[0].path = after.findings[0].path.replaceAll('\\', '/').toLowerCase();
    after.findings[0].logicalBytes -= 1024; after.progress.logicalBytes -= 1024; after.findings[0].userProtected = true;
    expect(comparisonUnavailable(after, scope, snapshot)).toBeNull();
    expect(findingChanges(after, snapshot).map(c => c.delta)).toEqual([-1024]);
  });
  it('rejects cancellation, incomplete scans, different cache settings, roots and scanner formats', () => {
    const before = report(), saved = makeSnapshot(before, scope)!;
    for (const changed of [{ ...before, complete: false }, { ...before, cancelled: true }]) {
      expect(makeSnapshot(changed, scope)).toBeNull(); expect(comparisonUnavailable(changed, scope, saved)).toMatch(/incomplete/);
    }
    expect(comparisonUnavailable(before, { ...scope, includeCaches: true }, saved)).toMatch(/scope changed/);
    expect(comparisonUnavailable({ ...before, roots: ['D:/different'] }, scope, saved)).toMatch(/scope changed/);
    expect(comparisonUnavailable({ ...before, schemaVersion: 99 }, scope, saved)).toMatch(/format changed/);
  });
  it('does not call missing classifications deletion or invent zero baselines for omitted entries', () => {
    const before = report(), after = report(); after.findings.shift();
    const saved = makeSnapshot(before, scope)!;
    expect(findingChanges(after, saved)[0].status).toBe('No longer classified here');
    const retained = { ...saved, allFindings: false, findings: saved.findings.slice(0, 1) };
    expect(findingChanges(before, retained)).toEqual([]);
  });
  it('bounds stored data and rejects corrupt or duplicate snapshots', () => {
    const r = report(); const sample = r.findings[0];
    r.findings = Array.from({ length: 5100 }, (_, i) => ({ ...sample, id: `f${i}`, path: `C:/Workspaces/${i}`, logicalBytes: 1 }));
    r.progress.logicalBytes = 5100;
    const saved = makeSnapshot(r, scope)!;
    expect(saved.findings).toHaveLength(5000); expect(saved.allFindings).toBe(false);
    expect(readSnapshot({ ...saved, logicalBytes: -1 })).toBeNull();
    expect(readSnapshot({ ...saved, findings: [saved.findings[0], saved.findings[0]] })).toBeNull();
  });
});
