import { test, expect } from '@playwright/test';

async function fixture(page: import('@playwright/test').Page) {
  await page.route('**/src/demo.ts*', async route => {
    const response = await route.fetch(); const original = await response.text();
    await route.fulfill({ response, body: original + `
      const originalInspectionDemo = demoReport; demoReport = function () {
        const r = originalInspectionDemo(); const project = r.projects[1], finding = r.findings[1];
        r.projects = [{...project, id:'outer', name:'Outer project', path:'C:/work'},
          {...project, id:'inner', name:'Nested source project', path:'C:/work/build/tools', ownedLogicalBytes:50, artifactBytes:0},
          {...project, id:'sibling', name:'Sibling project', path:'C:/work/building/tools'}];
        r.findings = [{...finding,id:'aggregate',label:'Protected mixed build',path:'C:/work/build',projectId:'outer',risk:'protected',logicalBytes:100},
          {...finding,id:'direct',label:'Outer dependencies',path:'C:/work/node_modules',projectId:'outer',logicalBytes:200},
          {...finding,id:'unrelated',label:'Other protected storage',path:'C:/elsewhere',projectId:null,risk:'protected',logicalBytes:300}];
        return r;
      };` });
  });
  await page.goto('/'); await page.getByRole('button', { name: 'Explore demo', exact: true }).click();
}

test('nested project Inspect exposes the protected aggregate without changing totals or protection', async ({ page }) => {
  await fixture(page); const summary = (await page.getByRole('region', { name: 'Scan summary' }).textContent())!;
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: 'Nested source project' }).getByRole('button', { name: 'Inspect' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr')).toContainText('Protected mixed build');
  await expect(page.locator('.project-context')).toContainText('inside protected storage');
  await page.getByRole('button', { name: /Protected mixed build/ }).click();
  await expect(page.getByRole('complementary', { name: 'Finding details' }).locator('.badge')).toHaveText(/Protected/);
  await expect(page.getByRole('button', { name: 'Exclude from review', exact: true })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Scan summary' })).toHaveText(summary);
  await page.getByLabel('Risk filter').selectOption('review'); await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(3); await expect(page.locator('.project-context')).toHaveCount(0);
});

test('ordinary project scopes stay direct and sibling path prefixes do not inherit an aggregate', async ({ page }) => {
  await fixture(page); await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await page.locator('tbody tr').filter({ hasText: 'Outer project' }).getByRole('button', { name: 'Inspect' }).click();
  await expect(page.locator('tbody tr')).toHaveCount(2); await expect(page.locator('.project-context')).toHaveCount(0);
  await page.getByLabel('Project filter').selectOption('sibling');
  await expect(page.locator('tbody tr')).toHaveCount(0); await expect(page.locator('.project-context')).toHaveCount(0);
});
