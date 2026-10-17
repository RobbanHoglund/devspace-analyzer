// The minimum host embeds Node 18, while current Playwright requires Node 20.
// Exercise the installed extension and its real webview/scanner without loading
// the browser-test driver into that older extension host.
import * as vscode from 'vscode';
import * as assert from 'node:assert/strict';
import { readFile, stat, mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 100)); }
  throw new Error(label);
}
export async function run() {
  const root = process.env.DEVSPACE_TEST_ROOT!;
  const extension = vscode.extensions.getExtension('RobbanHoglund.devspace-analyzer');
  assert.ok(extension);
  assert.ok(extension.extensionPath.startsWith(path.join(root, 'extensions')));
  const api = await extension.activate();
  const file = path.join(root, 'workspace', 'node_modules', 'example', 'index.js');
  const before = { data: await readFile(file), mtime: (await stat(file)).mtimeMs };
  await vscode.commands.executeCommand('devspace.open');
  await waitFor(() => api.getStatus().ready, 'The bundled webview did not initialize on the minimum host.');
  await vscode.commands.executeCommand('devspace.scanWorkspace');
  await waitFor(() => api.getStatus().complete === true, 'A real scan did not complete on the minimum host.');
  assert.equal(api.getStatus().projects, 1);
  assert.ok(api.getStatus().findings >= 1);
  assert.deepEqual(await readFile(file), before.data);
  assert.equal((await stat(file)).mtimeMs, before.mtime);
  for (const tab of ['storage', 'findings', 'projects', 'coverage', 'overview']) {
    await vscode.commands.executeCommand(`devspace.${tab}`);
    await waitFor(() => api.getStatus().activeTab === tab, `The webview did not acknowledge ${tab}.`);
  }
  await vscode.commands.executeCommand('workbench.action.closeActiveEditor');
  await vscode.commands.executeCommand('devspace.open');
  await waitFor(() => api.getStatus().ready, 'The webview did not reopen.');
  assert.equal(api.getStatus().complete, true);
  const output = process.env.DEVSPACE_ARTIFACTS!; await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'minimum-host.json'), JSON.stringify({ vscode: vscode.version, node: process.version, installedVsix: true, realWebviewInitialized: true, readOnlyNativeScan: true, allViews: true, reopen: true }, null, 2));
}
