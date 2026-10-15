import {test, expect} from '@playwright/test';
import {loadReport, navigate} from './fixtures';
import {demoReport} from '../../src/demo';
test('navigation and project drill-through preserve the previous findings view', async ({page}) => {
  await loadReport(page); await navigate(page,'Findings');
  await page.getByLabel('Ecosystem filter').selectOption('Python');
  await page.getByRole('button',{name:/Python virtual environment/}).click();
  await navigate(page,'Projects'); await navigate(page,'Findings');
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Python');
  await expect(page.locator('.detail h2')).toHaveText('Python virtual environment');
  await navigate(page,'Projects'); await page.locator('tbody tr').filter({hasText:'shopfront'}).getByRole('button',{name:'Inspect'}).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button',{name:'Back to previous findings'}).click();
  await expect(page.getByLabel('Ecosystem filter')).toHaveValue('Python');
  await expect(page.locator('.detail h2')).toHaveText('Python virtual environment');
});
test('demo round trip restores pagination after a filtered native report', async ({page}) => {
  const r=demoReport();r.findings=Array.from({length:101},(_,i)=>({...r.findings[0],id:'item-'+i,label:'Item '+i}));
  await loadReport(page,r); await navigate(page,'Findings'); await page.getByLabel('Search findings').fill('Item');
  await page.getByRole('button',{name:'Next',exact:true}).click();
  await page.getByRole('button',{name:'Explore demo',exact:true}).click(); await page.getByRole('button',{name:'Exit demo',exact:true}).click();
  await expect(page.locator('.pagination')).toContainText('51–100 of 101');
});

test('overview recommendations open correctly after a prior filtered findings view',async ({page})=>{
  await loadReport(page);await navigate(page,'Findings');await page.getByLabel('Ecosystem filter').selectOption('Python');await navigate(page,'Overview');
  await page.locator('.review-item').first().click();await expect(page.locator('.detail h2')).toHaveText('Gradle dependency cache');await expect(page.getByLabel('Ecosystem filter')).toHaveValue('all');
});
