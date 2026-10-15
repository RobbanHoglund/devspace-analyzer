import {test, expect} from '@playwright/test';
import {loadReport, navigate} from './fixtures';
test('export feedback remains visible at the bottom of a report and can be dismissed', async ({page}) => {
  await loadReport(page); await navigate(page, 'Findings');
  await page.getByRole('button', {name:'Export JSON',exact:true}).click();
  const notice = page.locator('.feedback-region'); await expect(notice).toContainText('Report saved:');
  const box = await notice.boundingBox(); expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.getByRole('button', {name:'Dismiss notification'}).click(); await expect(notice).toHaveCount(0);
});

test('folder action errors remain visible and dismissible inside a modal detail drawer', async ({page}) => {
  await page.setViewportSize({width:1000,height:700});
  await loadReport(page); await navigate(page,'Findings');
  await page.evaluate(()=>{
    const bridge=(window as unknown as {__TAURI_INTERNALS__:{invoke:(command:string,args:unknown)=>Promise<unknown>}}).__TAURI_INTERNALS__;
    const invoke=bridge.invoke;
    bridge.invoke=async (command,args)=>{if(command==='reveal_finding')throw new Error('Folder unavailable');return invoke(command,args);};
  });
  await page.getByRole('button',{name:/Installed Node dependencies/}).click();
  await page.getByRole('button',{name:'Open folder',exact:true}).click();
  const drawer=page.getByRole('dialog',{name:'Finding details'});
  await expect(drawer.getByRole('alert')).toContainText('Folder unavailable');
  const dismiss=drawer.getByRole('button',{name:'Dismiss error'});
  const box=await dismiss.boundingBox();expect(box!.y+box!.height).toBeLessThanOrEqual(700);
  await dismiss.click();await expect(page.getByRole('alert')).toHaveCount(0);
});
