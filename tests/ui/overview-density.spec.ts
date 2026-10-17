import { test, expect } from '@playwright/test';
import { loadReport } from './fixtures';
import { demoReport } from '../../src/demo';

// A laptop/editor-sized viewport with a real comparison, not an empty welcome
// screen. Expanded explanations may grow naturally; nothing is clipped to fit.
for (const width of [1440, 1100, 600]) test(`overview density and disclosure at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 900 });
  const report = { ...demoReport(), complete: true, warningCount: 0, warnings: [] };
  await loadReport(page, report);
  await page.evaluate(() => {
    const host = (window as any).__TAURI_INTERNALS__, invoke = host.invoke;
    host.invoke = async (command: string, args: unknown) => {
      const result = await invoke(command, args);
      if (command !== 'scan') return result;
      const after = structuredClone(result);
      after.progress.logicalBytes -= 1024; after.findings[0].logicalBytes -= 1024; after.startedAt += 60;
      return after;
    };
  });
  await page.getByRole('button', { name: 'Rescan the same scope', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Changes since previous scan' })).toContainText('1 KiB less measured');
  await page.evaluate(() => {
    document.body.classList.add('devspace-vscode', 'vscode-dark');
    for (const [name, value] of Object.entries({ 'editor-background':'#181818', 'editor-foreground':'#cccccc', descriptionForeground:'#9d9d9d', 'panel-border':'#333333', 'widget-border':'#454545', 'sideBar-background':'#1f1f1f', 'textLink-foreground':'#4daafc', 'button-background':'#0078d4', 'button-foreground':'#ffffff', 'button-hoverBackground':'#026ec1', 'input-background':'#313131', 'input-foreground':'#cccccc', 'charts-green':'#89d185', 'charts-blue':'#4daafc', 'charts-purple':'#b180d7', 'charts-yellow':'#cca700', 'charts-orange':'#d18616', 'editorWarning-foreground':'#cca700', 'list-hoverBackground':'#2a2d2e', 'list-inactiveSelectionBackground':'#37373d', focusBorder:'#007fd4' })) document.body.style.setProperty(`--vscode-${name}`, value);
  });
  const chart = page.getByRole('region', { name: 'Storage distribution' });
  const metrics = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, diagramTop: document.querySelector('.distribution-panel')!.getBoundingClientRect().top, diagramBottom: document.querySelector('.distribution-panel')!.getBoundingClientRect().bottom }));
  console.log('OVERVIEW_DENSITY', width, JSON.stringify(metrics));
  await page.screenshot({ path: `test-results/overview-${process.env.DEVSPACE_BASELINE ? 'before' : 'after'}-${width}.png`, fullPage: true });
  if (process.env.DEVSPACE_BASELINE) return;
  expect(metrics.width).toBeLessThanOrEqual(width + 1);
  if (width === 1440) expect(metrics.diagramBottom).toBeLessThanOrEqual(900);
  if (width === 1100) expect(metrics.diagramTop).toBeLessThan(700);
  await expect(chart).toBeVisible();
  const why = page.locator('.insight-reason summary').first();
  await why.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.insight-reason').first().locator('.insight-step')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.insight-reason').first().locator('.insight-step')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width + 1);
});
