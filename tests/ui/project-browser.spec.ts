import {test,expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport,navigate} from './fixtures';
test('large project inventories can be paged, searched and resumed after inspection',async ({page})=>{
  await page.setViewportSize({width:1000,height:700});
  const r=demoReport();r.projects=Array.from({length:120},(_,i)=>({...r.projects[0],id:'p'+i,name:'Project-'+String(i).padStart(3,'0'),path:'C:/work/project-'+i}));
  await loadReport(page,r);await navigate(page,'Projects');await expect(page.locator('tbody tr')).toHaveCount(50);
  expect(await page.locator('.table-scroll').evaluate(el=>el.scrollWidth-el.clientWidth)).toBeLessThanOrEqual(1);
  await page.getByRole('button',{name:'Next',exact:true}).click();await expect(page.locator('.pagination')).toContainText('51–100 of 120');
  await page.getByLabel('Search projects').fill('Project-119');await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Inspect',exact:true}).click();await navigate(page,'Projects');
  await expect(page.getByLabel('Search projects')).toHaveValue('Project-119');await expect(page.locator('tbody tr')).toHaveCount(1);
  await page.getByRole('button',{name:'Clear project filters'}).click();await page.getByLabel('Project ecosystem').selectOption('Gradle');await expect(page.locator('tbody tr')).toHaveCount(50);
});
