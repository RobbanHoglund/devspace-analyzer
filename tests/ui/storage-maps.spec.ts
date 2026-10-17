import { test, expect } from '@playwright/test';
import { loadReport, navigate, storageMapReport } from './fixtures';

const mib = 1024 ** 2;

for (const width of [380, 1440]) test(`map drill-down, file samples and up navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await loadReport(page, storageMapReport()); await navigate(page, 'Storage');
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await expect(map.getByRole('button', { name: /^Open folder: build,/ })).toHaveAttribute('data-value', String(60 * mib));
  await page.screenshot({ path: `test-results/treemap-${width}.png`, fullPage: true });
  const build = map.getByRole('button', { name: /^Open folder: build,/ }); await build.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('build');
  await map.getByRole('button', { name: /^Open folder: classes,/ }).click();
  await map.getByRole('button', { name: /^Explore group: Files directly here,/ }).click();
  await expect(map.getByRole('button', { name: /^Show size details: output.bin,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Up one level', exact: true }).click();
  await page.getByRole('button', { name: 'Up one level' }).click();
  await expect(map.getByRole('button', { name: /^Open folder: reports,/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});
test('filtered and omitted folder bytes keep their area, with working group navigation', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 1000 });
  const r = storageMapReport(); r.storage!.directories = r.storage!.directories.filter(d => d.id !== 4); r.storage!.truncated = true; r.storage!.directories[0].omittedDirectories = 1;
  await loadReport(page, r); await navigate(page, 'Storage');
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await map.getByRole('button', { name: /^Explore group: \d+ smaller items,/ }).click();
  await expect(map.getByRole('button', { name: /^Show size details: Folders without detail,/ })).toHaveAttribute('data-value', String(3 * mib));
  await expect(map.getByRole('button', { name: /^Explore group: Files directly here,/ })).toBeVisible();
  await page.getByRole('button', { name: 'Up one level', exact: true }).click();
  await page.getByLabel('Filter child folders').fill('build');
  await expect(map.getByRole('button', { name: /^Clear filter: Filtered-out folders,/ })).toHaveAttribute('data-value', String(36 * mib));
  const sum = await map.locator('.map-tile').evaluateAll(tiles => tiles.reduce((n, tile) => n + Number(tile.getAttribute('data-value')), 0));
  expect(sum).toBe(100 * mib);
  await map.getByRole('button', { name: /^Clear filter: Filtered-out folders,/ }).click();
  await expect(page.getByLabel('Filter child folders')).toHaveValue('');
});
test('donut segments include unclassified files and support keyboard drill-through', async ({ page }) => {
  await loadReport(page, storageMapReport());
  const distribution = page.getByRole('region', { name: 'Storage distribution' });
  await expect(distribution).toContainText('100 MiB');
  const ring = distribution.getByRole('group', { name: 'Storage share by category' });
  await page.screenshot({ path: 'test-results/storage-distribution.png', fullPage: true });
  await ring.getByRole('button', { name: /^Gradle,/ }).focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Gradle');
  await navigate(page, 'Overview');
  await ring.getByRole('button', { name: /^Other measured files,/ }).focus(); await page.keyboard.press('Space');
  await expect(page.getByLabel('Other measured files only')).toBeChecked();
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await expect(map.getByRole('button', { name: /^Open folder: build,/ })).toHaveCount(0);
  const sum = await map.locator('.map-tile').evaluateAll(tiles => tiles.reduce((n, tile) => n + Number(tile.getAttribute('data-value')), 0)); expect(sum).toBe(10 * mib);
});
