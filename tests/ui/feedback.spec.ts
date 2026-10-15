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
