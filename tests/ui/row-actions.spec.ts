import {test,expect} from '@playwright/test';
import {loadReport,navigate} from './fixtures';
test('the entire finding row opens the same detail and compact navigation has visible labels on focus',async ({page})=>{
  await loadReport(page);await navigate(page,'Findings');
  await page.locator('tbody tr').first().locator('td.number').click();await expect(page.locator('.detail h2')).toHaveText('Gradle dependency cache');
  await page.getByRole('button',{name:'Close finding details'}).click();
  await page.setViewportSize({width:1000,height:700});
  const nav=page.getByRole('navigation').getByRole('button',{name:'Projects',exact:true});await nav.focus();
  await expect(nav.locator('.nav-tooltip')).toBeVisible();await page.keyboard.press('Enter');await expect(page.getByRole('heading',{name:'Project inventory'})).toBeVisible();
});
