import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
async function markdown(page: Page) {
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const stream = await (await pending).createReadStream(); let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  return content;
}
test('the export choice switches between a private summary and full analysis', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const summary = await markdown(page);
  expect(summary).toContain('Detail level: Redacted summary');
  expect(summary).not.toContain('Developer'); expect(summary).not.toContain('Finding analysis');
  await page.getByLabel('Redacted summary').uncheck();
  const full = await markdown(page);
  expect(full).toContain('Detail level: Full report');
  expect(full).toContain('DEMO — synthetic data');
  expect(full).toContain(demoReport().findings[0].reason);
  expect(full).toContain(demoReport().findings[0].recovery);
  expect(full).toContain('## Coverage warnings');
  expect(full).toContain('## Projects');
});
