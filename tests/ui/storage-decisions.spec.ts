import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
import { demoStorage } from '../../src/demoStorage';
import type { Report } from '../../src/types';
import { navigate } from './fixtures';

function measured(buildBytes = 10 * 1024 ** 2): Report {
  const r = demoReport(), p = { ...r.projects[0], path: 'C:/Project', name: 'Project' };
  const f = { ...r.findings[6], path: `${p.path}/build`, logicalBytes: buildBytes, files: 10 };
  const roots = [p.path];
  return { ...r, projects: [p], findings: [f], roots, complete: true, cancelled: false, warningCount: 0, warnings: [],
    progress: { ...r.progress, files: 13, directories: 3, logicalBytes: buildBytes + 20 * 1024 ** 2 },
    storage: demoStorage(roots, [f], `${p.path}/logs`, 20 * 1024 ** 2) };
}
async function prepare(page: Page, reports: Report[]) {
  await page.addInitScript(reports => {
    let index = 0;
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string, args: any) => {
      if (command === 'scan') return reports[Math.min(index++, reports.length - 1)];
      if (command === 'reveal_storage') localStorage.setItem('opened-storage', JSON.stringify(args));
      return 1;
    } } });
    localStorage.setItem('devspace.roots', JSON.stringify(['C:/Project']));
  }, reports);
  await page.goto('/'); await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
}
for (const width of [380, 1440]) test(`storage drill-down explains other files and links a project plan at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await prepare(page, [measured()]);
  await page.getByRole('region', { name: 'Scan summary' }).getByRole('button', { name: /Other measured files/ }).click();
  const storage = page.getByRole('region', { name: 'Storage breakdown' });
  await expect(storage.getByLabel('Other measured files only')).toBeChecked();
  await storage.locator('.storage-folder').filter({ hasText: 'Project' }).click();
  await expect(storage.locator('.storage-row')).toHaveCount(1);
  await storage.locator('.storage-folder').filter({ hasText: 'logs' }).click();
  await expect(storage).toContainText('application.log'); await expect(storage).toContainText('20 MiB');
  await expect(storage.locator('.storage-file').filter({ hasText: 'Other direct files' })).toContainText('2 MiB');
  await storage.getByRole('button', { name: 'Show in file manager', exact: true }).click();
  expect(JSON.parse(await page.evaluate(() => localStorage.getItem('opened-storage')!))).toHaveProperty('id');
  await page.screenshot({ path: `test-results/storage-other-${width}.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
  await navigate(page, 'Overview');
  await page.getByRole('button', { name: 'Review build', exact: true }).click();
  const plan = page.getByRole('region', { name: 'Project review plan' });
  await expect(plan).toContainText('gradlew.bat found');
  await plan.locator('summary').click();
  await expect(plan.locator('code')).toHaveText('.\\gradlew.bat clean');
  await expect(plan).toContainText('Deletes configured build output');
  await page.screenshot({ path: `test-results/project-plan-${width}.png`, fullPage: true });
});

test('a rescan measures changes, keeps its baseline across reload and never converts a partial scan to savings', async ({ page }) => {
  const before = measured(), after = measured(4 * 1024 ** 2), partial = { ...measured(0), complete: false };
  await prepare(page, [before, after, partial]);
  const comparison = page.getByRole('region', { name: 'Changes since previous scan' });
  await expect(comparison).toContainText('Baseline captured');
  await comparison.getByRole('button', { name: 'Rescan the same scope' }).click();
  await expect(comparison).toContainText('6 MiB less measured');
  await comparison.locator('summary').click();
  await expect(comparison).toContainText('−6 MiB');
  await page.screenshot({ path: 'test-results/scan-comparison.png', fullPage: true });
  const saved = await page.evaluate(() => localStorage.getItem('devspace.baseline'));
  await comparison.getByRole('button', { name: 'Rescan the same scope' }).click();
  await expect(comparison).toContainText('incomplete');
  expect(await page.evaluate(() => localStorage.getItem('devspace.baseline'))).toBe(saved);
  await page.reload(); await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(comparison).toContainText('6 MiB more measured');
});

test('legacy and bounded reports show missing detail instead of inventing folder sizes', async ({ page }) => {
  const r = measured(); delete r.storage;
  await prepare(page, [r]); await navigate(page, 'Storage');
  await expect(page.getByRole('region', { name: 'Storage breakdown' })).toContainText('Run a new scan');
});
