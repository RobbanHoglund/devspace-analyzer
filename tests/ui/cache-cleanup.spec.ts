import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
import type { Report } from '../../src/types';

async function setup(page: Page, options: { protected?: boolean; partial?: boolean; missing?: boolean; unread?: boolean } = {}) {
  const report: Report = demoReport();
  report.findings = [{ ...report.findings[0], id: 'cache', kind: 'npm-cache', path: 'C:/Cache/npm/_cacache', label: 'npm package cache', ecosystem: 'Node', risk: options.protected ? 'protected' : 'review', complete: !options.unread, userProtected: false, protectedDescendants: [], protectedDescendantCount: 0, projectId: null, logicalBytes: 1024, files: 1 }];
  report.globalCaches = [{ path: 'C:/Cache/npm', kind: 'npm-cache', ecosystem: 'Node', source: 'Test' }];
  report.projects = []; report.complete = !options.partial; report.cancelled = false;
  report.progress.logicalBytes = 1024; report.progress.files = 1; report.roots = ['C:/Cache/npm']; report.storage = { directories: [], truncated: false };
  if (options.missing) { report.findings = []; report.globalCaches = []; }
  await page.addInitScript(report => {
    let scans = 0;
    Object.assign(window, { acquireVsCodeApi: () => ({ postMessage(message: {id:number;command:string;args:Record<string,unknown>}) {
      const calls = JSON.parse(localStorage.getItem('guidance-calls') ?? '[]'); calls.push(message); localStorage.setItem('guidance-calls',JSON.stringify(calls));
      let result: unknown = null;
      if (message.command === 'scan') { scans++; localStorage.setItem('guidance-scans',String(scans)); result = scans === 1 ? report : { ...report, progress: {...report.progress, logicalBytes: 512}, findings: report.findings.map(f => ({...f, logicalBytes: 512})) }; }
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message',{data:{type:'response',id:message.id,result}})));
    } }) });
  }, report);
  await page.goto('/');
  await page.evaluate(() => {
    const tokens = { 'editor-background':'#101925','editor-foreground':'#e6edf4',descriptionForeground:'#99aabd','textLink-foreground':'#80dbb5','button-background':'#80dbb5','button-foreground':'#08271d','input-background':'#101925','input-foreground':'#e6edf4','panel-border':'#2a384a','sideBar-background':'#152130' };
    for (const [key,value] of Object.entries(tokens)) document.body.style.setProperty(`--vscode-${key}`,value);
  });
  await page.getByLabel('Add folder path').fill('C:/Cache'); await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('button',{name:'Scan workspace',exact:true}).click();
  await expect(page.getByRole('region',{name:'Cache cleanup guidance'})).toBeVisible();
}
test('guidance copies the exact scoped command without execution, then explicitly compares a rescan', async ({page}) => {
  await setup(page);
  await page.getByRole('button',{name:'How to clean up →'}).click();
  const dialog = page.getByRole('dialog',{name:'How to clean up'});
  await expect(dialog.getByRole('region',{name:'Measured cache'})).toContainText('1 KiB');
  await dialog.getByRole('radio',{name:'Clear npm package cache',exact:true}).check();
  await dialog.getByRole('button',{name:'Copy command',exact:true}).click();
  await expect(dialog.getByRole('status')).toContainText('Nothing was executed');
  const calls = await page.evaluate(() => JSON.parse(localStorage.getItem('guidance-calls')!));
  expect(calls.find((c: {command:string})=>c.command === 'copy_text').args.text).toBe("npm.cmd '--cache=C:/Cache/npm' --logs-max=0 cache clean --force");
  expect(calls.some((c:{command:string})=>/cleanup/.test(c.command))).toBe(false);
  expect(await page.evaluate(()=>localStorage.getItem('guidance-scans'))).toBe('1');
  await expect(dialog.getByRole('button',{name:/^Run /})).toHaveCount(0);
  await dialog.getByRole('link',{name:'Official tool documentation ↗'}).click();
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('guidance-calls')!).some((c:{command:string})=>c.command==='open_documentation'))).toBe(true);
  await dialog.getByRole('button',{name:'Scan again',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('region',{name:'Changes since previous scan'})).toContainText('512 B less measured');
});
test('guidance fits a narrow editor and Escape restores focus', async ({page}) => {
  await page.setViewportSize({width:560,height:700}); await setup(page);
  const opener = page.getByRole('button',{name:'How to clean up →'}); await opener.click();
  const dialog=page.getByRole('dialog');
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await expect(dialog.getByRole('button',{name:'Close cleanup guidance'})).toBeVisible();
  await expect(dialog.getByRole('button',{name:'Scan again'})).toBeVisible();
  await page.screenshot({path:'test-results/cleanup-guidance-narrow.png'});
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
});
for (const option of ['protected','unread'] as const) test(`${option} cache explains the restriction and offers no command`,async({page})=>{
  await setup(page,{[option]:true}); await page.getByRole('button',{name:'How to clean up →'}).click();
  await expect(page.getByRole('dialog').getByRole('button',{name:'Copy command',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog').getByRole('link')).toBeVisible();
});
test('an unrelated partial scan keeps guidance for a fully measured cache, with an honest baseline notice',async({page})=>{
  await setup(page,{partial:true}); await page.getByRole('button',{name:'How to clean up →'}).click();
  await expect(page.getByRole('button',{name:'Copy command',exact:true})).toBeEnabled();
  await expect(page.getByText('This report is incomplete.',{exact:false})).toBeVisible();
});
test('missing caches provide a route to scan settings',async({page})=>{
  await setup(page,{missing:true});
  await page.getByRole('button',{name:'Open scan settings'}).click();
  await expect(page.getByLabel('Include known shared caches')).toBeVisible();
});
