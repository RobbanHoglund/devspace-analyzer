import {test, expect} from '@playwright/test';
import {loadReport, navigate} from './fixtures';
test('details never retain an item excluded by a filter or personal protection', async ({page}) => {
  await loadReport(page); await navigate(page, 'Findings');
  await page.getByRole('button', {name: /Container virtual disks/}).click();
  await page.getByLabel('Risk filter').selectOption('low');
  await expect(page.locator('.detail h2')).not.toHaveText('Container virtual disks');
  await page.getByRole('button', {name: /Python bytecode cache/}).click();
  await page.getByRole('button', {name: 'Protect this path', exact: true}).click();
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Remove personal protection', exact: true})).toHaveCount(0);
});
