import {test, expect} from '@playwright/test';
import {loadReport,navigate} from './fixtures';
for(const width of [1440,1000]) test(`details support keyboard entry and return at ${width}px`,async ({page}) => {
  await page.setViewportSize({width,height:940});await loadReport(page);await navigate(page,'Findings');
  const row=page.getByRole('button',{name:/Installed Node dependencies/});await row.focus();await page.keyboard.press('Enter');
  await expect(page.locator('.detail h2')).toBeFocused();
  await page.keyboard.press('Escape');await expect(row).toBeFocused();
  await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close finding details'}).click();await expect(row).toBeFocused();
});
