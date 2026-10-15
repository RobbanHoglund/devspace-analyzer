import {test, expect} from '@playwright/test';
import {loadReport, navigate} from './fixtures';
test('small desktop reports prioritize findings and bound large scope lists', async ({page}) => {
  await page.setViewportSize({width:1000,height:700}); await loadReport(page); await navigate(page,'Findings');
  await expect(page.getByLabel('Add folder path')).toBeHidden();
  const row=await page.locator('tbody tr').first().boundingBox(); expect(row!.y + row!.height).toBeLessThan(700);
  await page.getByRole('button',{name:'Scan settings',exact:true}).click(); await expect(page.getByLabel('Add folder path')).toBeVisible();
  await page.getByRole('button',{name:'Scan settings',exact:true}).click();
  await page.locator('tbody tr').last().scrollIntoViewIfNeeded();
  const toolbar=await page.locator('.report-toolbar').boundingBox(); expect(toolbar!.y).toBeGreaterThanOrEqual(0);
});
