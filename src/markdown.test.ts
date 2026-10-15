import { describe, expect, it } from 'vitest';
import { markdownReport, redactedReport } from './analysis';
import { demoReport } from './demo';

function fixture() {
  const report = demoReport();
  const sample = { ...report.findings[0], logicalBytes: 100, risk: 'review' as const, userProtected: false };
  report.complete = false;
  report.findings = [
    { ...sample, id: 'complete', label: 'Complete folder', complete: true },
    { ...sample, id: 'partial', label: 'Partial folder', complete: false },
    { ...sample, id: 'protected', label: 'Protected folder', risk: 'protected', complete: true },
    { ...sample, id: 'personal', label: 'Personally protected folder', userProtected: true, complete: true },
  ];
  return report;
}

describe('Markdown measurement status', () => {
  it('distinguishes complete candidates from partial measurements in a mixed report', () => {
    const md = markdownReport(fixture(), 'native');
    expect(md).toContain('| Logical size | Measurement | Risk | Review candidate |');
    expect(md).toContain('| Complete folder | 100 B | Complete | review | Yes |');
    expect(md).toContain('| Partial folder | 100 B (partial) | Partial | review | No |');
    expect(md).toContain('Partial sizes include only the files measured');
  });
  it('excludes both intrinsic and personal protection from candidates', () => {
    const md = markdownReport(fixture(), 'native');
    expect(md).toContain('| Protected folder | 100 B | Complete | protected | No |');
    expect(md).toContain('| Personally protected folder | 100 B | Complete | protected | No |');
  });
  it('keeps per-finding status after redaction and cancellation', () => {
    const report = fixture(); report.cancelled = true;
    const md = markdownReport(redactedReport(report), 'native');
    expect(md).toContain('Cancelled; partial results');
    expect(md).toContain('| 100 B (partial) | Partial | review | No |');
    expect(md).toContain('| 100 B | Complete | review | Yes |');
    expect(md).not.toContain('Complete folder');
    expect(md).not.toContain('Developer');
  });
});
