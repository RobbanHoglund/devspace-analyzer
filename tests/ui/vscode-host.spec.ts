import { test, expect } from '@playwright/test';
import { demoReport } from '../../src/demo';

const themeTokens = {
  'editor-background': '#ffffff', 'editor-foreground': '#202020', descriptionForeground: '#535353',
  'sideBar-background': '#f3f3f3', 'panel-border': '#cccccc', 'widget-border': '#999999',
  'textLink-foreground': '#005fb8', 'textLink-activeForeground': '#004578',
  'button-background': '#005fb8', 'button-foreground': '#ffffff', 'button-hoverBackground': '#004578',
  'input-background': '#ffffff', 'input-foreground': '#202020', 'input-placeholderForeground': '#666666',
  'list-hoverBackground': '#eeeeee', 'list-activeSelectionBackground': '#005fb8', 'list-activeSelectionForeground': '#ffffff', 'list-inactiveSelectionBackground': '#e4e6f1',
  'focusBorder': '#005fb8', 'badge-background': '#d0d0d0', 'badge-foreground': '#202020',
  'charts-green': '#287938', 'charts-blue': '#005fb8', 'charts-orange': '#9d4800', 'charts-purple': '#7442a8', 'charts-yellow': '#895a00',
  'editorWarning-foreground': '#895a00', 'errorForeground': '#b01928', 'editorWidget-background': '#f3f3f3', 'contrastBorder': '#202020',
};
for (const width of [380, 760, 1440]) {
  test(`VS Code host bridge and narrow editor layout at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const report = demoReport();
    await page.addInitScript(report => {
      (window as any).acquireVsCodeApi = () => ({ postMessage: (message: any) => {
        const { command, id, args } = message;
        let result: any = null;
        if (command === 'choose_folders') result = ['C:/Workspaces'];
        if (command === 'scan') { localStorage.setItem('vscode-request', JSON.stringify(args)); result = report; }
        if (command === 'save_export') { localStorage.setItem('vscode-export', args.content); result = 'C:/Reports/new-report.json'; }
        queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'response', id, result } })));
      } });
    }, report);
    await page.goto('/');
    await page.evaluate(tokens => {
      document.body.classList.add('vscode-light');
      for (const [key, value] of Object.entries(tokens)) document.body.style.setProperty(`--vscode-${key}`, value);
    }, themeTokens);
    await expect(page.getByRole('checkbox', { name: 'Include known shared caches' })).not.toBeChecked();
    await page.getByRole('button', { name: 'Choose folders', exact: true }).click();
    await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Scan summary' })).toBeVisible();
    const request = JSON.parse(await page.evaluate(() => localStorage.getItem('vscode-request')!));
    expect(request.request.includeGlobalCaches).toBe(false);
    await expect(page.getByText('Browser preview', { exact: false })).toHaveCount(0);
    await expect(page.getByRole('navigation')).toHaveCount(0);
    await page.screenshot({ path: `test-results/vscode-overview-${width}.png`, fullPage: true });
    for (const [tab, name] of [['overview', 'Overview'], ['findings', 'Findings'], ['projects', 'Projects'], ['coverage', 'Scan coverage']]) {
      await page.evaluate(tab => window.dispatchEvent(new MessageEvent('message', { data: { type: 'event', name: 'host-action', payload: { tab } } })), tab);
      await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible();
      const overflow = await page.evaluate(() => ({
        width: innerWidth, document: document.documentElement.scrollWidth,
        elements: [...document.querySelectorAll('body *')].map(e => ({ tag:e.tagName, class:e.className, x:e.getBoundingClientRect().x, right:e.getBoundingClientRect().right })).filter(e => e.right > innerWidth + 1).slice(0,20),
      }));
      if (overflow.document > overflow.width + 1) console.log('VS_CODE_OVERFLOW', name, JSON.stringify(overflow));
      expect(overflow.document, `Overflow in ${name}`).toBeLessThanOrEqual(overflow.width + 1);
    }
    await page.evaluate(() => window.dispatchEvent(new MessageEvent('message', { data: { type: 'event', name: 'host-action', payload: { tab: 'findings' } } })));
    await expect(page.getByLabel('Ecosystem filter')).toBeVisible();
    const label = await page.locator('.finding-button strong').first().innerText();
    await page.locator('.finding-button').first().click();
    await expect(page.getByRole('heading', { name: label, exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Close finding details' }).click();
    await page.screenshot({ path: `test-results/vscode-light-${width}.png`, fullPage: true });
  });
}
