import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import { readFile, stat, writeFile, mkdir } from 'node:fs/promises';
import * as path from 'node:path';
import { chromium, type Frame } from 'playwright';

async function waitFor(predicate: () => boolean | Promise<boolean>, message: string, timeout = 30000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) { if (await predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(message);
}
export async function run(): Promise<void> {
  const temporary = process.env.DEVSPACE_TEST_ROOT!;
  const artifacts = process.env.DEVSPACE_ARTIFACTS!; await mkdir(artifacts, { recursive: true });
  const extension = vscode.extensions.getExtension('RobbanHoglund.devspace-analyzer'); assert.ok(extension, 'VSIX must be installed');
  assert.ok(extension.extensionPath.toLowerCase().startsWith(path.join(temporary, 'extensions').toLowerCase()), 'Test the installed VSIX, not the source checkout');
  const api = await extension.activate();
  const commands = await vscode.commands.getCommands(true);
  for (const name of ['open', 'scanWorkspace', 'scanFolder', 'cancel', 'findings', 'coverage']) assert.ok(commands.includes(`devspace.${name}`));
  await vscode.commands.executeCommand('devspace.open');
  await waitFor(() => api.getStatus().ready, 'Packaged webview did not become ready (check CSP and assets)');
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9228');
  try {
    let frame: Frame | undefined;
    await waitFor(async () => {
      for (const context of browser.contexts()) for (const page of context.pages()) for (const candidate of page.frames()) {
        if (await candidate.locator('body.devspace-vscode').count().catch(() => 0)) { frame = candidate; return true; }
      }
      return false;
    }, 'Packaged React view not found');
    const view = frame!;
    assert.equal(await view.getByRole('checkbox', { name: 'Include known shared caches' }).isChecked(), false);
    if (process.env.DEVSPACE_RESTRICTED === '1') {
      assert.equal(vscode.workspace.isTrusted, false);
      assert.equal(await view.getByRole('button', { name: 'Scan workspace', exact: true }).isDisabled(), true);
      await view.getByRole('button', { name: 'Explore demo data' }).click();
      assert.equal(api.getStatus().scanning, false);
      assert.ok(await view.getByText('DEMO · SYNTHETIC DATA', { exact: true }).isVisible());
      await view.page().screenshot({ path: path.join(artifacts, 'vscode-restricted.png') });
      return;
    }
    const fixtureFile = path.join(temporary, 'workspace', 'node_modules', 'example', 'index.js');
    const before = { bytes: await readFile(fixtureFile), mtime: (await stat(fixtureFile)).mtimeMs };
    await vscode.commands.executeCommand('devspace.scanWorkspace');
    await waitFor(() => api.getStatus().complete === true, 'Real scanner did not return a complete report');
    assert.equal(api.getStatus().projects, 1); assert.ok(api.getStatus().findings >= 1);
    assert.deepEqual(await readFile(fixtureFile), before.bytes); assert.equal((await stat(fixtureFile)).mtimeMs, before.mtime);
    await vscode.commands.executeCommand('devspace.findings');
    await view.getByRole('heading', { name: /Findings/ }).first().waitFor();
    await view.locator('.finding-button').first().click();
    await view.getByRole('heading', { name: /Node dependencies/ }).waitFor();
    await view.getByRole('button', { name: 'Close finding details' }).click();
    const themes: [string, string][] = [['Default Dark Modern', 'vscode-dark'], ['Default Light Modern', 'vscode-light'], ['Default High Contrast', 'vscode-high-contrast'], ['Default High Contrast Light', 'vscode-high-contrast-light']];
    for (const [name, css] of themes) {
      await vscode.workspace.getConfiguration('workbench').update('colorTheme', name, vscode.ConfigurationTarget.Global);
      await waitFor(() => view.locator(`body.${css}`).count().then(n => n === 1), `Theme ${name} not applied`);
      await view.page().screenshot({ path: path.join(artifacts, `${process.platform}-${css}.png`) });
    }
    await vscode.commands.executeCommand('devspace.projects');
    await view.getByRole('heading', { name: /^Projects/ }).first().waitFor();
    await vscode.commands.executeCommand('devspace.coverage');
    await view.getByRole('heading', { name: 'What was scanned' }).waitFor();
    await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
    await vscode.commands.executeCommand('devspace.open');
    await waitFor(() => api.getStatus().ready, 'Reopened view did not restore');
    assert.ok(api.getStatus().findings >= 1);
    await writeFile(path.join(artifacts, `vscode-integration-${process.platform}.json`), JSON.stringify({ installedPathVerified: true, realScan: true, readOnlyFixture: true, themes: themes.map(t => t[0]), reopen: true, vscode: vscode.version }, null, 2));
  } finally { await browser.close(); }
}
