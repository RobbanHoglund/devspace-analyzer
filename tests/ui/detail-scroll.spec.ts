import {test, expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport, navigate} from './fixtures';
test('switching between long findings resets the detail scroll position', async ({page}) => {
  const report = demoReport();
  report.findings = report.findings.slice(0,2).map(f => ({...f, reason: 'Long recovery context. '.repeat(150)}));
  await loadReport(page, report); await navigate(page, 'Findings');
  await page.locator('.finding-button').first().click();
  await page.locator('.detail').evaluate(e => e.scrollTop = 400);
  expect(await page.locator('.detail').evaluate(e => e.scrollTop)).toBeGreaterThan(100);
  await page.locator('.finding-button').nth(1).click();
  await expect.poll(() => page.locator('.detail').evaluate(e => e.scrollTop)).toBe(0);
});
