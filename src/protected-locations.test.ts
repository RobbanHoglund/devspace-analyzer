import { expect, it } from 'vitest';
import { redactedReport } from './analysis';
import { demoReport } from './demo';

it('withholds protected location paths and labels while retaining the count', () => {
  const report = demoReport();
  report.findings[0].protectedDescendants = [{ path: 'C:/PRIVATE_BOUNDARY', label: 'PRIVATE_CATEGORY' }];
  report.findings[0].protectedDescendantCount = 25;
  const redacted = redactedReport(report);
  expect(redacted.findings[0].protectedDescendants).toEqual([]);
  expect(redacted.findings[0].protectedDescendantCount).toBe(25);
  expect(JSON.stringify(redacted)).not.toContain('PRIVATE_');
});
