import {test, expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport, navigate} from './fixtures';
test('a full result page opens visible details at the minimum supported size', async ({page}) => {
  const r=demoReport();r.findings=Array.from({length:70},(_,i)=>({...r.findings[0],id:'row-'+i,label:'Finding '+i}));
  await page.setViewportSize({width:1000,height:700}); await loadReport(page,r); await navigate(page,'Findings');
  await expect(page.locator('tbody tr')).toHaveCount(50);
  await page.locator('.finding-button').first().click();
  const drawer=page.getByRole('dialog',{name:'Finding details'}); await expect(drawer).toBeVisible();
  const heading=await drawer.locator('h2').boundingBox(); expect(heading!.y).toBeGreaterThan(0); expect(heading!.y+heading!.height).toBeLessThan(700);
  await page.keyboard.press('Escape'); await expect(drawer).not.toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(50);
});
