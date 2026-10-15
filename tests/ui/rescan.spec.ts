import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/demo';

test('a failed rescan retains the report, selection and export until a successful replacement', async ({ page }) => {
  const original = demoReport();
  const replacement = { ...original, findings: [original.findings[0]] };
  await page.addInitScript(({ original, replacement }) => {
    let scans = 0;
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string, args: { content: string }) => {
        if (command === 'scan') { scans++; if (scans === 2) throw new Error('No accessible scan directories'); return scans === 1 ? original : replacement; }
        if (command === 'save_export') { localStorage.setItem('test-export', args.content); return 'report.json'; } return 1;
      } },
    });
  }, { original, replacement });
  await page.goto('/');
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await page.getByRole('button', { name: /Installed Node dependencies/ }).click();
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('No accessible scan directories');
  await expect(page.getByText('The new scan failed.', { exact: false })).toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(10);
  await expect(page.getByRole('complementary', { name: 'Finding details' })).toContainText('Installed Node dependencies');
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  const exported = await page.evaluate(() => JSON.parse(localStorage.getItem('test-export')!));
  expect(exported.report.findings).toHaveLength(10); expect(exported.origin).toBe('native');
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByText('The new scan failed.', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
});

test('demo provenance survives a failed attempt at native scanning', async ({ page }) => {
  await page.addInitScript(() => {
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string, args: { content: string }) => {
        if (command === 'scan') throw new Error('Scan failed');
        if (command === 'save_export') { localStorage.setItem('test-export', args.content); return 'demo.json'; } return 1;
      } },
    });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Scan failed');
  await expect(page.getByText('DEMO · SYNTHETIC DATA', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Export JSON', exact: true }).click();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('test-export')!).origin)).toBe('demo');
});

test('a cancelled rescan replaces the clearly marked previous report with partial results', async ({ page }) => {
  const original = demoReport();
  await page.addInitScript(original => {
    let first = true; let finish: ((report: unknown) => void) | undefined;
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string) => {
        if (command === 'scan') { if (first) { first = false; return original; } return new Promise(resolve => { finish = resolve; }); }
        if (command === 'cancel_scan') finish?.({ ...original, cancelled: true, complete: false, findings: [] });
        return 1;
      } },
    });
  }, original);
  await page.goto('/'); await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await page.getByRole('button', { name: /Findings/ }).first().click();
  await page.getByRole('button', { name: /Installed Node dependencies/ }).click();
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByText('Showing the previous report while a new scan runs.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open folder', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Cancel scan', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cancelled · partial results', exact: true })).toBeVisible();
  await expect(page.getByText('Showing the previous report while a new scan runs.')).toHaveCount(0);
});
