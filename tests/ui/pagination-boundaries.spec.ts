import { test, expect, type Page } from '@playwright/test';

async function fixtures(page: Page, count: number) {
  await page.route('**/src/demo.ts*', async route => {
    const response = await route.fetch(); const original = await response.text();
    await route.fulfill({ response, body: original + `\nconst basePaginationDemo = demoReport; demoReport = function () {
      const r = basePaginationDemo(); const sample = r.findings.find(f => f.risk === 'review');
      r.findings = Array.from({length: ${count}}, (_, i) => ({...sample, id:'boundary-'+i, label:'Boundary fixture '+i,
        path:'C:/Pagination/cache-'+i, logicalBytes:1000-i, complete:true, userProtected:false})); return r; };` });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
  await page.getByLabel('Risk filter').selectOption('review');
}
for (const count of [0, 1, 50, 51, 100, 101]) {
  test(`pagination bounds for ${count} findings and report replacement`, async ({ page }) => {
    await fixtures(page, count);
    await expect(page.locator('tbody tr')).toHaveCount(Math.min(count, 50));
    if (count === 0) {
      await expect(page.locator('.pagination')).toContainText('0 findings');
      await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled(); return;
    }
    let start = 1;
    while (start + 49 < count) {
      await page.getByRole('button', { name: 'Next', exact: true }).click(); start += 50;
    }
    await expect(page.locator('.pagination')).toContainText(`${start}–${count} of ${count}`);
    await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();
    await page.getByRole('button', { name: `Boundary fixture ${count - 1}`, exact: false }).click();
    await page.getByRole('button', { name: 'Protect this path', exact: true }).click();
    const remaining = count - 1; const expectedPage = Math.max(0, Math.ceil(remaining / 50) - 1);
    await expect(page.locator('tbody tr')).toHaveCount(remaining ? Math.min(50, remaining - expectedPage * 50) : 0);
    await page.getByRole('button', { name: 'Remove personal protection', exact: true }).click();
    // Unprotecting must not jump back to a formerly invalid page.
    await expect(page.locator('.pagination')).toContainText(`${expectedPage * 50 + 1}–${Math.min(count, expectedPage * 50 + 50)} of ${count}`);
    await page.getByLabel('Search findings').fill('no-such-finding'); await expect(page.locator('tbody tr')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
    await expect(page.locator('.pagination')).toContainText(`1–${Math.min(count, 50)} of ${count}`);
    if (count > 50) await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
    await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
    await expect(page.locator('.pagination')).toContainText(`1–${Math.min(count, 50)} of ${count}`);
  });
}
