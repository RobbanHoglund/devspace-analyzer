import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/demo';
import { loadReport, navigate } from './fixtures';

test('the takeaway explains Gradle storage and connects all measured bytes to review or coverage', async ({ page }) => {
  const report = demoReport();
  const project = { ...report.projects[0], name: 'stock_info' };
  const build = { ...report.findings[6], path: `${project.path}/build`, logicalBytes: 1024 ** 3 };
  const cache = { ...build, id: 'project-cache', path: `${project.path}/.gradle`, logicalBytes: 200 * 1024 ** 2 };
  const git = { ...report.findings[9], projectId: project.id, logicalBytes: 800 * 1024 ** 2 };
  Object.assign(report, { projects: [project], findings: [build, cache, git], complete: true, warningCount: 0, warnings: [] });
  report.progress.logicalBytes = 6 * 1024 ** 3;
  await loadReport(page, report);
  const insights = page.getByRole('region', { name: 'What your scan tells you' });
  await expect(insights).toContainText('1.2 GiB in 2 locations to review');
  await expect(insights).toContainText('Gradle build output');
  await expect(insights).toContainText('Gradle project cache');
  await expect(insights).not.toContainText('Git metadata');
  const summary = page.getByRole('region', { name: 'Scan summary' });
  await expect(summary).toContainText('6 GiB measured');
  await expect(summary.getByRole('button', { name: /Other measured files/ })).toContainText('4 GiB');
  await summary.getByRole('button', { name: /Other measured files/ }).click();
  await expect(page.getByRole('region', { name: 'Unclassified measured data' })).toContainText('did not match a supported');
  await navigate(page, 'Overview');
  await insights.getByRole('button', { name: 'Review build', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Suggested review step' })).toContainText('configured build outputs');
  await page.getByRole('button', { name: 'Exclude from review', exact: true }).click();
  await navigate(page, 'Overview');
  await expect(insights).toContainText('200 MiB in 1 location to review');
  await expect(insights).not.toContainText('Gradle build output');
});

test('partial measurements never become a suggested review and the breakdown opens the correct subset', async ({ page }) => {
  const report = demoReport();
  report.findings[0].complete = false;
  await loadReport(page, report);
  const insights = page.getByRole('region', { name: 'What your scan tells you' });
  await expect(insights).not.toContainText('Gradle dependency cache');
  await expect(insights).toContainText('Partial coverage');
  await page.getByRole('button', { name: /Incomplete findings/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Gradle dependency cache');
  await page.locator('.finding-button').click();
  await expect(page.getByRole('region', { name: 'Suggested review step' })).toContainText('excluded from the review total');
  await page.getByRole('button', { name: 'Close finding details', exact: true }).click();
  await page.getByRole('region', { name: 'Scan summary' }).getByRole('button', { name: /^To review/ }).click();
  await expect(page.locator('tbody tr')).toHaveCount(6);
  await expect(page.locator('tbody')).not.toContainText('Git metadata');
});

test('compact export is keyboard accessible and preserves the default private mode', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 700 });
  await loadReport(page);
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeHidden();
  const toggle = page.locator('.export-options summary');
  await toggle.focus(); await page.keyboard.press('Enter');
  await expect(page.getByLabel('Redacted summary', { exact: true })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeVisible();
  const box = await page.locator('.export-popover').boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(1000);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Export JSON' })).toBeHidden();
  await expect(toggle).toBeFocused();
});
