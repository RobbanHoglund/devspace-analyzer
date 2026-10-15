import {test,expect} from '@playwright/test';
import {demoReport} from '../../src/demo';
import {loadReport,navigate} from './fixtures';
for(const status of ['complete','partial','cancelled']) test(`coverage explains ${status} independently of deletion risk`,async ({page})=>{
  const r=demoReport();r.complete=status==='complete';r.cancelled=status==='cancelled';if(r.complete){r.warningCount=0;r.warnings=[];}
  await loadReport(page,r);await navigate(page,'Scan coverage');
  await expect(page.locator('.coverage-grid .scan-status')).toHaveClass(new RegExp('status-'+status));
  await expect(page.locator('.coverage-grid')).not.toContainText('Lower risk');
  if(status==='complete') await expect(page.getByRole('button',{name:'Completed within scope',exact:true})).toBeVisible();
});
