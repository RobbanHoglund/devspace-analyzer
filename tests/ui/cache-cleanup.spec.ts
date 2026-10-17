import { test, expect, type Page } from '@playwright/test';
import { demoReport } from '../../src/demo';
import type { Report } from '../../src/types';

async function setup(page: Page, options: { protected?: boolean; partial?: boolean; fail?: boolean } = {}) {
  const report: Report = demoReport();
  const sample = report.findings[0];
  report.findings = [{ ...sample, id: 'cache', kind: 'npm-cache', path: 'C:/Cache/npm/_cacache', label: 'npm package cache', ecosystem: 'Node', risk: options.protected ? 'protected' : 'review', complete: true, userProtected: false, protectedDescendants: [], protectedDescendantCount: 0, projectId: null, logicalBytes: 1024, files: 1 }];
  report.globalCaches = [{ path: 'C:/Cache/npm', kind: 'npm-cache', ecosystem: 'Node', source: 'Test' }];
  report.projects = []; report.complete = !options.partial; report.cancelled = false;
  report.progress.logicalBytes = 1024; report.progress.files = 1; report.roots = ['C:/Cache/npm']; report.storage = { directories: [], truncated: false };
  await page.addInitScript(({report,fail}) => {
    let scans = 0;
    Object.assign(window, { acquireVsCodeApi: () => ({ postMessage(message: {id:number;command:string;args:Record<string,unknown>}) {
      const calls = JSON.parse(localStorage.getItem('cleanup-calls') ?? '[]'); calls.push(message); localStorage.setItem('cleanup-calls',JSON.stringify(calls));
      let result: unknown = null;
      if (message.command === 'scan') { scans++; localStorage.setItem('cleanup-scans',String(scans)); result = report; }
      if (message.command === 'prepare_cleanup') result = { id:'reviewed-token', action:message.args.action, title:message.args.action === 'npm-verify' ? 'Verify npm cache' : 'Clear npm package cache', toolVersion:'11.0.0', targetPath:report.findings[0].path, cachePath:report.globalCaches[0].path, executable:'C:/Node/node.exe', arguments:[], command:"& 'C:/Node/node.exe' 'npm-cli.js' '--cache=C:/Cache/npm' 'cache' 'clean' '--force'", shell:'PowerShell', beforeBytes:1024, beforeFiles:1, effects:['This changes cache files. There is no undo.','A preview is not a dry run.'] };
      if (message.command === 'run_cleanup') result = { status:fail ? 'failed' : 'succeeded', exitCode:fail ? 1 : 0, beforeBytes:1024, afterBytes:fail ? 512 : 0, measurementError:null, log:fail ? 'Unable to remove one entry.' : 'Cache cleaned.' };
      queueMicrotask(() => window.dispatchEvent(new MessageEvent('message',{data:{type:'response',id:message.id,result}})));
    } }) });
  }, {report,fail:options.fail});
  await page.goto('/');
  await page.evaluate(() => {
    const tokens = { 'editor-background':'#101925','editor-foreground':'#e6edf4',descriptionForeground:'#99aabd','textLink-foreground':'#80dbb5','button-background':'#80dbb5','button-foreground':'#08271d','input-background':'#101925','input-foreground':'#e6edf4','panel-border':'#2a384a','sideBar-background':'#152130' };
    for (const [key,value] of Object.entries(tokens)) document.body.style.setProperty(`--vscode-${key}`,value);
  });
  await page.getByLabel('Add folder path').fill('C:/Cache'); await page.getByRole('button',{name:'Add',exact:true}).click();
  await page.getByRole('button',{name:'Scan workspace',exact:true}).click();
  await expect(page.getByRole('region',{name:'Cache maintenance'})).toBeVisible();
}
test('cleanup is a separate preview and explicit run, followed by measured result and rescan', async ({page}) => {
  await setup(page);
  await page.getByRole('button',{name:'Review cleanup →'}).click();
  const dialog = page.getByRole('dialog',{name:'Review before running'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio',{name:/Clear npm package cache/}).check();
  await dialog.getByRole('button',{name:'Prepare preview'}).click();
  await expect(dialog.getByRole('region',{name:'Cleanup preview'})).toContainText('1 KiB');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('cleanup-calls')!).filter((c: {command:string})=>c.command === 'run_cleanup'))).toHaveLength(0);
  await dialog.getByRole('button',{name:'Copy command',exact:true}).click();
  await expect(dialog.getByText('Copied.',{exact:false})).toBeVisible();
  await dialog.getByRole('button',{name:'Run cleanup',exact:true}).click();
  const result = page.getByRole('dialog',{name:'Maintenance result'});
  await expect(result.getByRole('region',{name:'Cleanup result'})).toContainText('Command completed');
  await expect(result.getByRole('log')).toContainText('Cache cleaned.');
  await expect.poll(() => page.evaluate(()=>localStorage.getItem('cleanup-scans'))).toBe('2');
  await expect(result.getByRole('button',{name:'Done',exact:true})).toBeEnabled();
  await page.screenshot({path:'test-results/cleanup-result.png'});
  await result.getByRole('button',{name:'Done',exact:true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
test('closing a preview cancels it without running; narrow preview fits and keeps keyboard focus', async ({page}) => {
  await page.setViewportSize({width:560,height:850}); await setup(page);
  await page.getByRole('button',{name:'Review cleanup →'}).click();
  await page.getByRole('button',{name:'Prepare preview'}).click();
  const dialog=page.getByRole('dialog'); await expect(dialog.getByRole('button',{name:'Run verification'})).toBeVisible();
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  await page.screenshot({path:'test-results/cleanup-preview-narrow.png'});
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  const commands = await page.evaluate(()=>JSON.parse(localStorage.getItem('cleanup-calls')!).map((c:{command:string})=>c.command));
  expect(commands).toContain('cancel_cleanup'); expect(commands).not.toContain('run_cleanup');
});
for (const option of ['protected','partial'] as const) test(`${option} reports cannot start cleanup`,async({page})=>{
  await setup(page,{[option]:true}); await expect(page.getByRole('button',{name:'Review cleanup →'})).toBeDisabled();
});
test('failed native maintenance keeps its log and partial measurements, then refreshes',async({page})=>{
  await setup(page,{fail:true}); await page.getByRole('button',{name:'Review cleanup →'}).click();
  await page.getByRole('button',{name:'Prepare preview'}).click(); await page.getByRole('button',{name:'Run verification'}).click();
  await expect(page.getByRole('region',{name:'Cleanup result'})).toContainText('Command failed');
  await expect(page.getByRole('region',{name:'Cleanup result'})).toContainText('partial changes');
  await expect(page.getByRole('log')).toContainText('Unable to remove one entry.');
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('cleanup-scans'))).toBe('2');
});
