import {test,expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport} from './fixtures';
test('tiny ecosystem shares retain readable labels and an accessible drill-through',async ({page})=>{
  const r=demoReport();r.findings=r.findings.filter(f=>f.ecosystem==='Gradle'||f.ecosystem==='Git').map(f=>({...f,logicalBytes:f.ecosystem==='Git'?1:100000000000}));
  await page.setViewportSize({width:1000,height:700});await loadReport(page,r);
  const git=page.locator('.storage-bar').filter({hasText:'Git'});await expect(git).toContainText('1 B');
  const clipped=await git.evaluate(e=>[...e.querySelectorAll('*')].some(x=>x instanceof HTMLElement&&x.scrollWidth>x.clientWidth+1));expect(clipped).toBe(false);
  await git.click();await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Git');await expect(page.locator('tbody tr')).toHaveCount(1);
});
