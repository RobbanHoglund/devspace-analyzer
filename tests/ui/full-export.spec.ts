import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
async function markdown(page: Page) {
  const pending = page.waitForEvent('download');
  if (!(await page.locator('.export-options').evaluate(e => e.open))) await page.locator('.export-options summary').click();
  await page.getByRole('button', { name: 'Export Markdown', exact: true }).click();
  const stream = await (await pending).createReadStream(); let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  return content;
}
test('the export choice switches between a private summary and full analysis', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.locator('.export-options summary').click();
  await expect(page.getByLabel('Redacted summary', {exact:true})).toBeChecked();
  await expect(page.locator('.export-mode-help')).toContainText('withheld');
  const summary = await markdown(page);
  expect(summary).toContain('Detail level: Redacted summary');
  expect(summary).not.toContain('Developer'); expect(summary).not.toContain('Finding analysis');
  await page.locator('.export-options summary').click();
  await page.getByLabel('Full report', {exact:true}).check();
  await expect(page.locator('.export-mode-help')).toContainText('Includes paths, project names, branches');
  const full = await markdown(page);
  expect(full).toContain('Detail level: Full report');
  expect(full).toContain('DEMO — synthetic data');
  expect(full).toContain(demoReport().findings[0].reason);
  expect(full).toContain(demoReport().findings[0].recovery);
  expect(full).toContain('## Coverage warnings');
  expect(full).toContain('## Projects');
});
