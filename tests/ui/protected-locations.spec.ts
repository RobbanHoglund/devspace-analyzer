import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/demo';

test('details locate protected descendants and show the retained sample limit', async ({ page }) => {
  const report = demoReport();
  report.findings = [{ ...report.findings[1], risk: 'protected', protectedDescendantCount: 25,
    protectedDescendants: Array.from({ length: 20 }, (_, i) => ({ path: `C:/workspace/build/vendor-${i}/.yarn`, label: 'Project Yarn storage' })) }];
  await page.addInitScript(report => {
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string) => command === 'scan' ? report : 1 } });
  }, report);
  await page.goto('/'); await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await page.getByRole('button', { name: /Installed Node dependencies/ }).click();
  const locations = page.getByRole('region', { name: 'Protected locations', exact: true });
  await expect(locations).toContainText('Showing 20 of 25');
  await expect(locations).toContainText('C:/workspace/build/vendor-0/.yarn');
  await expect(locations.locator('li')).toHaveCount(20);
});
