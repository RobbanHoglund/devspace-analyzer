import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

// Expand only the synthetic demo response in the browser test. The checked-in
// application and scanner are not modified or mocked into passing behavior.
test('r06 protection must clamp pagination when the last filtered item disappears', async ({ page }) => {
  await page.route('**/src/demo.ts*', async route => {
    const response = await route.fetch();
    const original = await response.text();
    await route.fulfill({ response, body: original + `\n
      const originalReviewDemo = demoReport;
      demoReport = function () {
        const r = originalReviewDemo();
        const sample = r.findings.find(f => f.risk === 'review');
        r.findings = Array.from({ length: 51 }, (_, i) => ({ ...sample,
          id: 'review-' + i, label: 'Review fixture ' + i,
          path: 'C:\\\\ReviewFixtures\\\\cache-' + i,
          logicalBytes: 1000 - i, complete: true, userProtected: false }));
        return r;
      };
    ` });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
  await page.getByLabel('Risk filter').selectOption('review');
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button', { name: /Review fixture 50/ }).click();
  await page.getByRole('button', { name: 'Protect this path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove personal protection', exact: true })).toHaveCount(0);
  mkdirSync('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/review-pagination.png', fullPage: true });
  console.log('OBSERVED pagination:', await page.locator('.pagination').innerText());
  console.log('OBSERVED visible rows:', await page.locator('tbody tr').count());
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await expect(page.locator('.pagination')).toContainText('1–50 of 50');
});
