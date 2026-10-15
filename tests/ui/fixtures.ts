import { expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
import type { Report } from '../../src/types';
export async function loadReport(page: Page, report: Report = demoReport()) {
  await page.addInitScript(report => {
    Object.assign(window, { isTauri: true, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
      __TAURI_INTERNALS__: { transformCallback: () => 1, invoke: async (command: string, args: {content: string}) => {
        if (command === 'scan') return report;
        if (command === 'save_export') { localStorage.setItem('review-export', args.content); return 'C:/Reports/review.json'; }
        return 1;
      } },
    });
    localStorage.setItem('devspace.roots', JSON.stringify(['C:/Workspaces']));
  }, report);
  await page.goto('/');
  await page.getByRole('button', {name: 'Scan workspace', exact: true}).click();
  await expect(page.getByRole('region', {name: 'Scan summary'})).toBeVisible();
}
export async function navigate(page: Page, name: string) {
  await page.getByRole('navigation').getByRole('button', {name: new RegExp(`^${name}`)}).click();
}
