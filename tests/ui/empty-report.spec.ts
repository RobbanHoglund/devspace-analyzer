import {test, expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport, navigate} from './fixtures';
test('a scan with no recognized findings does not offer a meaningless filter reset', async ({page}) => {
  await loadReport(page, {...demoReport(), findings:[], projects:[]}); await navigate(page, 'Findings');
  await expect(page.getByText('No recognized developer data in this scan.',{exact:true})).toBeVisible();
  await expect(page.getByRole('button', {name:'Clear filters',exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Review coverage',exact:true}).click();
  await expect(page.getByRole('heading', {name:'What was scanned'})).toBeVisible();
});
