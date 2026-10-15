import {test, expect} from '@playwright/test';
import {loadReport} from './fixtures';
test('changed next-scan settings are distinct from the current report scope', async ({page}) => {
  await loadReport(page);
  await page.getByLabel('Include known shared caches').uncheck();
  await expect(page.getByText('Settings changed', {exact:false})).toBeVisible();
  await page.getByLabel('Include known shared caches').check();
  await expect(page.getByText('Settings changed', {exact:false})).toHaveCount(0);
  await page.getByLabel('Add folder path').fill('D:/NewWorkspace');
  await page.getByRole('button', {name:'Add',exact:true}).click();
  await expect(page.getByText('Settings changed', {exact:false})).toBeVisible();
  await page.getByRole('button', {name:'Scan workspace',exact:true}).click();
  await expect(page.getByText('Settings changed', {exact:false})).toHaveCount(0);
});
