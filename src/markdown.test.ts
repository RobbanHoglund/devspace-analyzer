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

describe('full Markdown analysis', () => {
  it('retains the reasoning, evidence, recovery, project context, protected paths and warnings', () => {
    const report = demoReport();
    report.projects[0].contextOnly = true;
    report.findings[0].protectedDescendants = [{ path: 'C:/private-boundary', label: 'Protected storage' }];
    report.findings[0].protectedDescendantCount = 25;
    const md = markdownReport(report, 'native');
    expect(md).toContain('Detail level: Full report');
    expect(md).toContain(report.findings[0].reason);
    expect(md).toContain(report.findings[0].evidence[0]);
    expect(md).toContain(report.findings[0].recovery);
    expect(md).toContain(report.findings[0].caveats[0]);
    expect(md).toContain('Parent context; selected scope only');
    expect(md).toContain('Showing 1 of 25 protected locations');
    expect(md).toContain('C:/private-boundary');
    expect(md).toContain('link-skipped');
  });
  it('keeps the redacted summary private even when handed an unredacted report', () => {
    const report = demoReport();
    report.findings[0].protectedDescendants = [{ path: 'C:/PRIVATE_PATH', label: 'PRIVATE_LABEL' }];
    report.findings[0].reason = 'PRIVATE_REASON';
    report.findings[0].recovery = 'PRIVATE_RECOVERY';
    const md = markdownReport(report, 'native', true);
    expect(md).toContain('Detail level: Redacted summary');
    expect(md).not.toContain('PRIVATE_');
    expect(md).not.toContain('Developer');
    expect(md).not.toContain('Finding analysis');
  });
  it('escapes Markdown in all newly exported free-text fields', () => {
    const report = demoReport();
    report.findings[0].reason = '# Heading\n![image](https://example.test) | cell';
    report.findings[0].evidence = ['[link](target)'];
    report.findings[0].recovery = '<script>content</script>';
    report.findings[0].protectedDescendants = [{ path: '/private|path', label: '*label*' }];
    report.findings[0].protectedDescendantCount = 1;
    const md = markdownReport(report, 'native');
    expect(md).toContain('\\# Heading \\!\\[image\\](https://example.test) \\| cell');
    expect(md).toContain('\\[link\\](target)');
    expect(md).toContain('\\<script\\>content\\</script\\>');
    expect(md).toContain('\\*label\\*: /private\\|path');
  });
});
