import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

async function loadDemo(page: import('@playwright/test').Page) {
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByText('DEMO · SYNTHETIC DATA')).toBeVisible();
}
test('starts empty and never pretends a browser can scan the machine', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('button', { name: 'Scan workspace', exact: true })).toBeDisabled();
  await expect(page.getByText('Browser preview', { exact: false })).toBeVisible();
  await expect(page.getByText('DEMO · SYNTHETIC DATA')).toHaveCount(0);
});
test('overview renders with explicit provenance and no console errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await loadDemo(page); await expect(page.getByRole('region', { name: 'Scan summary' })).toBeVisible();
  await expect(page.getByText('Logical size · not guaranteed savings')).toBeVisible();
  mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/ui-overview.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('filters, details and protection operate on real view state', async ({ page }) => {
  await loadDemo(page); await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
  await page.getByLabel('Ecosystem filter').selectOption('Node');
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: /Installed Node dependencies/ }).click();
  await page.getByRole('button', { name: 'Protect this path' }).click();
  await expect(page.getByRole('button', { name: 'Remove personal protection' })).toBeVisible();
  await page.getByLabel('Risk filter').selectOption('protected'); await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByLabel('Search findings').fill('does-not-exist'); await expect(page.getByText('No findings match these filters.')).toBeVisible();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  mkdirSync('artifacts', { recursive: true }); await page.screenshot({ path: 'artifacts/ui-findings.png', fullPage: true });
});
test('projects link to scoped findings and coverage explains missing data', async ({ page }) => {
  await loadDemo(page); await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.locator('tbody tr').filter({ hasText: 'shopfront' }).getByRole('button', { name: 'Inspect' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Scan coverage', exact: true }).click();
  await expect(page.getByText('link-skipped', { exact: true })).toBeVisible();
});
test('redacted demo export omits paths and keeps demo origin', async ({ page }) => {
  await loadDemo(page); const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export JSON' }).click(); const download = await pending;
  const stream = await download.createReadStream(); let content = '';
  for await (const chunk of stream!) content += chunk.toString();
  expect(content).not.toContain('C:\\\\Users'); expect(content).not.toContain('shopfront');
  expect(JSON.parse(content).origin).toBe('demo'); expect(JSON.parse(content).redacted).toBe(true);
});
test('compact viewport remains horizontally contained', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 }); await loadDemo(page);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow).toBe(false);
});
