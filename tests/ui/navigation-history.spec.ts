import { test, expect } from '@playwright/test';
import { loadReport, storageMapReport } from './fixtures';

test('chart drill-through restores the overview position and supports keyboard forward', async ({ page }) => {
  await loadReport(page, storageMapReport());
  const chart = page.getByRole('region', { name: 'Storage distribution' });
  await chart.scrollIntoViewIfNeeded();
  const before = await page.evaluate(() => scrollY);
  // Click the painted middle of the 60% arc; its bounding-box center is the donut hole.
  const ring = chart.getByRole('group', { name: 'Storage share by category' });
  const bounds = (await ring.boundingBox())!;
  await ring.click({ position: { x: bounds.width * (.5 + Math.sin(Math.PI * .6) * 112 / 300), y: bounds.height * (.5 - Math.cos(Math.PI * .6) * 112 / 300) } });
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Gradle');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(chart).toBeVisible();
  await expect.poll(async () => Math.abs(await page.evaluate(() => scrollY) - before)).toBeLessThan(3);
  await page.keyboard.press('Alt+ArrowRight');
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Gradle');
  await page.keyboard.press('Alt+ArrowLeft');
  await chart.getByRole('button', { name: 'Explore all folders' }).click();
  await expect(page.getByRole('region', { name: 'Storage breakdown' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go forward', exact: true })).toBeDisabled();
});

test('one history includes folder filters, files groups and parent navigation', async ({ page }) => {
  await loadReport(page, storageMapReport());
  await page.getByRole('button', { name: 'Explore all folders' }).click();
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  const back = page.getByRole('button', { name: 'Go back', exact: true });
  const forward = page.getByRole('button', { name: 'Go forward', exact: true });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await page.getByLabel('Filter child folders').fill('build');
  await map.getByRole('button', { name: /^Open folder: build,/ }).click();
  await back.click();
  await expect(page.getByLabel('Filter child folders')).toHaveValue('build');
  await expect(map.getByRole('button', { name: /^Open folder: build,/ })).toBeFocused();
  await forward.click();
  await map.getByRole('button', { name: /^Open folder: classes,/ }).click();
  await map.getByRole('button', { name: /^Explore group: Files directly here,/ }).click();
  const crumbs = page.getByRole('navigation', { name: 'Storage path' });
  await expect(crumbs.locator('[aria-current]')).toHaveText('Files directly here');
  await page.getByRole('button', { name: 'Up one level', exact: true }).click();
  await expect(crumbs.locator('[aria-current]')).toHaveText('classes');
  await back.click();
  await expect(map.getByRole('button', { name: /^Show size details: output.bin,/ })).toBeVisible();
  await expect(crumbs.locator('[aria-current]')).toHaveText('Files directly here');
  await page.getByRole('button', { name: 'Up one level', exact: true }).click();
  await expect(forward).toBeDisabled();
});

for (const width of [380, 1440]) test(`reviewing a folder and returning restores its filter and exact location at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  await loadReport(page, storageMapReport());
  await page.getByRole('button', { name: 'Explore all folders' }).click();
  await page.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await page.getByLabel('Filter child folders').fill('build');
  await page.getByRole('button', { name: 'Review Gradle build output', exact: true }).click();
  await page.getByRole('button', { name: 'Inspect size breakdown', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('build');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.locator('.detail h2')).toHaveText('Gradle build output');
  await page.getByRole('button', { name: width < 1250 ? 'Back to previous location' : 'Go back', exact: true }).click();
  await expect(page.getByLabel('Filter child folders')).toHaveValue('build');
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('Workspace');
});

for (const width of [380, 1440]) test(`deep paths have reachable ancestors and sticky navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 800 });
  const report = storageMapReport();
  report.findings = []; report.projects = [];
  let path = 'C:/Workspace';
  const prototype = report.storage!.directories[0];
  report.storage!.directories = Array.from({ length: 10 }, (_, id) => {
    if (id) path += `/level-${id}`;
    return { ...prototype, id, path, parentId: id === 0 ? null : id - 1, classifiedBytes: 0, directFileBytes: id === 9 ? prototype.logicalBytes : 0, directFiles: id === 9 ? 2 : 0, largestFiles: [] };
  });
  await loadReport(page, report);
  await page.getByRole('button', { name: 'Explore all folders' }).click();
  for (const name of ['Workspace', 'level-1', 'level-2', 'level-3', 'level-4', 'level-5']) await page.getByRole('button', { name: new RegExp(`^Open folder: ${name},`) }).click();
  const crumbs = page.getByRole('navigation', { name: 'Storage path' });
  await crumbs.getByLabel('Show parent folders').click();
  await crumbs.locator('.ancestor-menu').getByRole('button', { name: /^level-2/ }).click();
  await expect(crumbs.locator('[aria-current]')).toHaveText('level-2');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(crumbs.locator('[aria-current]')).toHaveText('level-5');
  await page.keyboard.press('Alt+ArrowUp');
  await expect(crumbs.locator('[aria-current]')).toHaveText('level-4');
  await page.screenshot({ path: `test-results/navigation-explore-${width}.png` });
  await page.locator('.direct-files').scrollIntoViewIfNeeded();
  const history = await page.locator('.report-toolbar').boundingBox();
  const navigation = await page.locator('.storage-navigation').boundingBox();
  expect(history!.y).toBeGreaterThanOrEqual(-1);
  expect(navigation!.y).toBeGreaterThanOrEqual(history!.y + history!.height - 1);
  expect(navigation!.y + navigation!.height).toBeLessThan(800);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  await page.screenshot({ path: `test-results/navigation-${width}.png` });
});

test('demo has separate navigation history and a fresh scan clears the old report history', async ({ page }) => {
  await loadReport(page, storageMapReport());
  await page.getByRole('button', { name: 'Explore all folders' }).click();
  await page.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await page.getByRole('button', { name: /^Open folder: build,/ }).click();
  await page.getByRole('button', { name: 'Scan settings', exact: true }).click();
  await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Go back', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Exit demo', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('build');
  await page.getByRole('button', { name: 'Go back', exact: true }).click();
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('Workspace');
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Storage distribution' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Go back', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Go forward', exact: true })).toBeDisabled();
});
