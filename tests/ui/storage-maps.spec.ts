import { test, expect } from '@playwright/test';
import { loadReport, navigate } from './fixtures';
import { demoReport } from '../../src/demo';
import type { Report, StorageDirectory } from '../../src/types';

const mib = 1024 ** 2;
function mapReport(): Report {
  const report = demoReport(), root = 'C:/Workspace';
  const data: [number | null, string, number, number][] = [[null, root, 100, 90], [0, `${root}/build`, 60, 60], [0, `${root}/node_modules`, 30, 30], [0, `${root}/src`, 4, 0], [0, `${root}/docs`, 3, 0], [0, `${root}/assets`, 2, 0], [1, `${root}/build/classes`, 40, 40], [1, `${root}/build/reports`, 20, 20]];
  const directories: StorageDirectory[] = data.map(([parentId, path, size, classified], id) => ({ id, parentId, path, logicalBytes: size * mib, classifiedBytes: classified * mib, directClassifiedBytes: classified * mib, directFileBytes: size * mib, directFiles: 2, files: 2, complete: true, omittedDirectories: 0, largestFiles: [{ name: 'output.bin', logicalBytes: size * mib * .75 }] }));
  directories[0] = { ...directories[0], files: 14, directFileBytes: mib, directClassifiedBytes: 0, largestFiles: [{ name: 'README.md', logicalBytes: mib / 2 }] };
  directories[1] = { ...directories[1], files: 4, directFileBytes: 0, directClassifiedBytes: 0, directFiles: 0, largestFiles: [] };
  const findings = [{ ...report.findings[6], path: `${root}/build`, logicalBytes: 60 * mib, files: 4 }, { ...report.findings[1], path: `${root}/node_modules`, projectId: 'p0', logicalBytes: 30 * mib, files: 2 }];
  const projects = [{ ...report.projects[0], name: 'Workspace', path: root, ecosystems: ['Gradle', 'Node'], ownedLogicalBytes: 100 * mib, artifactBytes: 90 * mib }];
  return { ...report, findings, projects, roots: [root], globalCaches: [], complete: true, warningCount: 0, warnings: [], storage: { directories, truncated: false }, progress: { ...report.progress, files: 14, directories: directories.length, projects: 1, logicalBytes: 100 * mib } };
}
for (const width of [380, 1440]) test(`map drill-down, file samples and up navigation at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 }); await loadReport(page, mapReport()); await navigate(page, 'Storage');
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await expect(map.getByRole('button', { name: /^Open folder: build,/ })).toHaveAttribute('data-value', String(60 * mib));
  await page.screenshot({ path: `test-results/treemap-${width}.png`, fullPage: true });
  const build = map.getByRole('button', { name: /^Open folder: build,/ }); await build.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Storage path' }).locator('[aria-current]')).toHaveText('build');
  await map.getByRole('button', { name: /^Open folder: classes,/ }).click();
  await map.getByRole('button', { name: /^Explore group: Files directly here,/ }).click();
  await expect(map.getByRole('button', { name: /^Show size details: output.bin,/ })).toBeVisible();
  await map.getByRole('button', { name: '← Back to folder map', exact: true }).click();
  await page.getByRole('button', { name: 'Up one folder level' }).click();
  await expect(map.getByRole('button', { name: /^Open folder: reports,/ })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});
test('filtered and omitted folder bytes keep their area, with working group navigation', async ({ page }) => {
  await page.setViewportSize({ width: 380, height: 1000 });
  const r = mapReport(); r.storage!.directories = r.storage!.directories.filter(d => d.id !== 4); r.storage!.truncated = true; r.storage!.directories[0].omittedDirectories = 1;
  await loadReport(page, r); await navigate(page, 'Storage');
  const map = page.getByRole('region', { name: 'Interactive folder map' });
  await map.getByRole('button', { name: /^Open folder: Workspace,/ }).click();
  await map.getByRole('button', { name: /^Explore group: \d+ smaller items,/ }).click();
  await expect(map.getByRole('button', { name: /^Show size details: Folders without detail,/ })).toHaveAttribute('data-value', String(3 * mib));
  await expect(map.getByRole('button', { name: /^Explore group: Files directly here,/ })).toBeVisible();
  await map.getByRole('button', { name: '← Back to folder map', exact: true }).click();
  await page.getByLabel('Filter child folders').fill('build');
  await expect(map.getByRole('button', { name: /^Clear filter: Filtered-out folders,/ })).toHaveAttribute('data-value', String(36 * mib));
  const sum = await map.locator('.map-tile').evaluateAll(tiles => tiles.reduce((n, tile) => n + Number(tile.getAttribute('data-value')), 0));
  expect(sum).toBe(100 * mib);
  await map.getByRole('button', { name: /^Clear filter: Filtered-out folders,/ }).click();
  await expect(page.getByLabel('Filter child folders')).toHaveValue('');
});
test('donut segments include unclassified files and support keyboard drill-through', async ({ page }) => {
  await loadReport(page, mapReport());
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
