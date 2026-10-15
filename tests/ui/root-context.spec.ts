import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/demo';

test('a parent context project makes the measurement scope explicit', async ({ page }) => {
  const report = demoReport();
  report.projects = [{ ...report.projects[1], contextOnly: true }];
  report.findings = [report.findings[1]];
  report.roots = [report.findings[0].path];
  await page.addInitScript(report => {
    Object.assign(window, {
      isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string) => command === 'scan' ? report : 1 },
    });
  }, report);
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('sizes within selected scope only');
  await page.getByRole('button', { name: 'Inspect', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Installed Node dependencies');
});
