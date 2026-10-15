import {test, expect} from '@playwright/test';
import {loadReport, navigate} from './fixtures';
test('returning from demo restores the native report, filter and selection', async ({page}) => {
  await loadReport(page); await navigate(page, 'Findings');
  await page.getByLabel('Ecosystem filter').selectOption('Node');
  await page.getByRole('button', {name: /Installed Node dependencies/}).click();
  await page.getByRole('button', {name: 'Protect this path', exact: true}).click();
  await page.getByRole('button', {name: 'Scan settings', exact: true}).click();
  await page.getByRole('button', {name: 'Explore demo', exact: true}).click();
  await page.getByRole('button', {name: 'Exit demo', exact: true}).click();
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Node');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await expect(page.getByRole('button', {name: 'Remove personal protection', exact: true})).toBeVisible();
  if (!(await page.locator('.export-options').evaluate(e => e.open))) await page.locator('.export-options summary').click();
  await page.getByRole('button', {name: 'Export JSON', exact: true}).click();
  const result = await page.evaluate(() => JSON.parse(localStorage.getItem('review-export')!));
  expect(result.origin).toBe('native'); expect(result.report.findings.some((f: {userProtected: boolean}) => f.userProtected)).toBe(true);
});
