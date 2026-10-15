import { test, expect } from '@playwright/test';

test('redacted Markdown downloads retain partial measurement status', async ({ page }) => {
  await page.route('**/src/demo.ts*', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + `
      const basePartialExportDemo = demoReport;
      demoReport = function () {
        const r = basePartialExportDemo(); r.complete = false;
        r.findings = [{...r.findings[0], label:'PRIVATE_PARTIAL_FOLDER', logicalBytes:123, complete:false}];
        return r;
      };` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Markdown', exact: true }).click();
  const stream = await (await pending).createReadStream();
  let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  expect(content).toContain('| 123 B (partial) | Partial | review | No |');
  expect(content).not.toContain('PRIVATE_PARTIAL_FOLDER');
  expect(content).not.toContain('Developer');
});
