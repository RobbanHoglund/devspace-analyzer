import {test,expect} from '@playwright/test';
import {loadReport,navigate} from './fixtures';
import {demoReport} from '../../src/demo';
test('retained warning details are grouped searchable and bounded without claiming complete counts',async ({page})=>{
  const r=demoReport();r.warningCount=605;r.warnings=Array.from({length:500},(_,i)=>({code:i%2?'link-skipped':'directory-unavailable',path:'C:/path-'+i,message:'Unable to inspect this fixture.'}));
  await loadReport(page,r);await navigate(page,'Scan coverage');
  const warnings=page.getByRole('region',{name:'Coverage warnings'});await expect(warnings).toContainText('remaining 105 warnings');await expect(warnings.locator('details')).toHaveCount(25);
  await warnings.getByRole('button',{name:/Linked paths skipped/}).click();await expect(warnings).toContainText('1–25 of 250 retained details');
  await page.getByLabel('Search warnings').fill('path-499');await expect(warnings.locator('details')).toHaveCount(1);await expect(warnings).toContainText('link-skipped');
  await navigate(page,'Projects');await navigate(page,'Scan coverage');await expect(page.getByLabel('Search warnings')).toHaveValue('path-499');
});
