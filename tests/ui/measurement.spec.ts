import {test,expect} from '@playwright/test';
import {loadReport} from './fixtures';
import {demoReport} from '../../src/demo';
test('zero classified findings still explain measured unclassified data and partial coverage',async ({page})=>{
  const r={...demoReport(),findings:[],projects:[]};r.progress.logicalBytes=10*1024**3;
  await loadReport(page,r);const context=page.getByRole('region',{name:'Measurement coverage'});
  await expect(context).toContainText('10 GiB measured');await expect(context).toContainText('10 GiB unclassified measured data');await expect(context).toContainText('unread data is not estimated');
});
