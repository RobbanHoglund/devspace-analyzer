import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';

// Exercise real UI state across two scans. Only the native IPC transport is
// stubbed; these report shapes model a broad aggregate then a narrower scope.
async function protectThenNarrow(page: Page, extraPaths: string[] = []) {
  const base = demoReport();
  const sample = { ...base.findings[0], risk: 'review' as const, projectId: null, logicalBytes: 100 };
  const broad = { ...base, findings: [{ ...sample, id: 'build', label: 'Build aggregate', path: 'C:/work/build' }] };
  const narrow = { ...base, findings: [
    { ...sample, id: 'modules', label: 'Node dependencies', path: 'C:/work/build/tool/node_modules', userProtected: true },
    { ...sample, id: 'dist', label: 'Build output', path: 'C:/work/build/tool/dist', userProtected: true },
  ] };
  await page.addInitScript(({ reports, paths }) => {
    let index = 0;
    Object.assign(window, {
      isTauri: true,
      __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string) => command === 'scan' ? reports[index++] : 1 },
    });
    localStorage.setItem('devspace.protected', JSON.stringify(paths));
  }, { reports: [broad, narrow], paths: extraPaths.length ? ['C:/work/build', ...extraPaths] : [] });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await page.getByRole('button', { name: /Build aggregate/ }).click();
  if (!extraPaths.length) await page.getByRole('button', { name: 'Exclude from review', exact: true }).click();
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await page.getByRole('button', { name: /Node dependencies/ }).click();
  await expect(page.locator('tbody .risk-protected')).toHaveCount(2);
}

test('inherited protection is not removed by a finding-local action', async ({ page }) => {
  await protectThenNarrow(page);
  await expect(page.getByRole('button', { name: 'Remove my exclusion', exact: true })).toHaveCount(0);
  const rules = page.getByRole('region', { name: 'Shared protection rules' });
  await expect(rules).toContainText('C:/work/build');
  await expect(rules).toContainText('2 findings');
  await rules.getByRole('button', { name: 'Review removal', exact: true }).click();
  await expect(page.locator('tbody .risk-protected')).toHaveCount(2);
  await rules.getByRole('button', { name: 'Keep exclusion', exact: true }).click();
  await expect(page.locator('tbody .risk-protected')).toHaveCount(2);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('devspace.protected')!))).toContain('C:/work/build');
});

test('explicit shared-rule removal keeps independent sibling protection', async ({ page }) => {
  await protectThenNarrow(page, ['C:/work/build/tool/dist']);
  const rules = page.getByRole('region', { name: 'Shared protection rules' });
  await rules.getByRole('button', { name: 'Review removal', exact: true }).click();
  await rules.getByRole('button', { name: 'Remove rule for all covered paths', exact: true }).click();
  await expect(page.locator('tbody tr').filter({ hasText: 'Node dependencies' })).toContainText('Needs review');
  await expect(page.locator('tbody tr').filter({ hasText: 'Build output' })).toContainText('Protected');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('devspace.protected')!))).toEqual(['C:/work/build/tool/dist']);
});
