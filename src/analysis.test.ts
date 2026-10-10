import { describe, expect, it } from 'vitest';
import { bytes, effectiveRisk, markdownReport, pathsOverlap, redactedReport, summarize, treemap } from './analysis';
import { demoReport } from './demo';

describe('logical sizes and candidate totals', () => {
  it('uses binary units and handles zero/invalid values', () => { expect(bytes(0)).toBe('0 B'); expect(bytes(1024)).toBe('1 KiB'); expect(bytes(1024 ** 3)).toBe('1 GiB'); expect(bytes(NaN)).toBe('Unknown'); });
  it('does not include protected data as a candidate', () => {
    const report = demoReport(); const summary = summarize(report.findings, []);
    expect(summary.candidates + summary.protected).toBe(summary.identified);
    expect(summary.protected).toBeGreaterThan(0);
  });
  it('personal protection removes a candidate from the total', () => {
    const report = demoReport(); const f = report.findings[0];
    expect(summarize(report.findings, [f.path]).candidates).toBe(summarize(report.findings, []).candidates - f.logicalBytes);
    expect(effectiveRisk(f, [f.path])).toBe('protected');
  });
  it('excludes incomplete findings from candidate totals', () => {
    const f = { ...demoReport().findings[0], complete: false };
    expect(summarize([f], []).candidates).toBe(0); expect(summarize([f], []).incomplete).toBe(f.logicalBytes);
  });
});
describe('protection path boundaries', () => {
  it('uses path boundaries rather than plain string prefixes', () => { expect(pathsOverlap('C:\\work\\app', 'C:\\work\\apple')).toBe(false); expect(pathsOverlap('C:\\work\\app', 'C:\\work\\app\\node_modules')).toBe(true); });
  it('treats Windows paths case-insensitively and POSIX paths case-sensitively', () => { expect(pathsOverlap('C:\\WORK', 'c:/work/app')).toBe(true); expect(pathsOverlap('/Work', '/work/app')).toBe(false); });
  it('handles both roots and empty strings', () => { expect(pathsOverlap('/', '/work/app')).toBe(true); expect(pathsOverlap('', '/work')).toBe(false); });
});
describe('redaction and export', () => {
  it('strips sensitive strings from every free-text field', () => {
    const report = demoReport(); const secret = 'PRIVATE_CANARY';
    report.roots = [secret]; report.progress.currentPath = secret; report.sizeBasis = secret; report.limitations = [secret];
    report.globalCaches[0] = { path: secret, source: secret, kind: secret, ecosystem: secret };
    report.projects[0] = { ...report.projects[0], path: secret, name: secret, branch: secret, wrapperVersion: secret, markers: [secret], lockfiles: [secret], gitKind: secret };
    report.findings[0] = { ...report.findings[0], path: secret, label: secret, kind: secret, reason: secret, recovery: secret, evidence: [secret], caveats: [secret], confidence: secret, wrapperVersion: secret };
    report.warnings = [{ path: secret, code: secret, message: secret }];
    const redacted = redactedReport(report);
    expect(JSON.stringify(redacted)).not.toContain(secret); expect(redacted.findings[0].logicalBytes).toBe(report.findings[0].logicalBytes);
  });
  it('never mutates the original report', () => { const report = demoReport(); const before = JSON.stringify(report); redactedReport(report); expect(JSON.stringify(report)).toBe(before); });
  it('identifies demo exports and escapes Markdown filenames', () => { const report = demoReport(); report.findings[0].path = '<script>|unsafe\nname'; const md = markdownReport(report, 'demo'); expect(md).toContain('DEMO'); expect(md).not.toContain('<script>'); expect(md).toContain('\\|unsafe name'); });
});
describe('treemap geometry', () => {
  it('ignores zero and invalid values', () => { expect(treemap([{ name: 'a', value: 0 }, { name: 'b', value: NaN }])).toEqual([]); });
  it('preserves the exact chart area without overlap', () => {
    const items = [{ name: 'a', value: 11 }, { name: 'b', value: 7 }, { name: 'c', value: 3 }, { name: 'd', value: 1 }]; const tiles = treemap(items);
    expect(tiles.reduce((sum, t) => sum + t.w * t.h, 0)).toBeCloseTo(960 * 240);
    for (let i = 0; i < tiles.length; i++) for (let j = i + 1; j < tiles.length; j++) {
      const a = tiles[i], b = tiles[j]; const overlap = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      expect(overlap).toBeCloseTo(0);
    }
  });
});
