import { chromium, expect } from '@playwright/test';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

if (process.platform !== 'win32') throw new Error('This smoke test requires Windows and WebView2.');
const executable = resolve(process.argv[2] ?? 'target/release/devspace-analyzer.exe');
if (!existsSync(executable)) throw new Error(`Application executable not found: ${executable}`);
const temp = mkdtempSync(join(tmpdir(), 'devspace-native-'));
const workspace = join(temp, 'workspace');
const artifacts = resolve('artifacts');
mkdirSync(artifacts, { recursive: true });
function put(relative, content) {
  const path = join(workspace, relative);
  mkdirSync(resolve(path, '..'), { recursive: true });
  writeFileSync(path, content);
}
put('service/build.gradle.kts', '// Static project marker\n');
put('service/.git/HEAD', 'ref: refs/heads/main\n');
put('service/build/classes/output.bin', Buffer.alloc(2048, 1));
put('web/package.json', '{"name":"native-fixture-web"}');
put('web/package-lock.json', '{"lockfileVersion":3}');
put('web/node_modules/example/index.js', Buffer.alloc(1024, 2));
put('python/pyproject.toml', '[project]\nname = "native-fixture-python"\n');
put('python/.venv/pyvenv.cfg', 'home = fixture-interpreter\n');
put('python/module.py', '# Source filename for bytecode recovery evidence\n');
put('python/__pycache__/module.cpython-313.pyc', Buffer.alloc(64, 3));
function snapshot(root) {
  const result = {};
  function walk(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name);
      if (entry.isDirectory()) walk(full);
      else result[full] = { sha256: createHash('sha256').update(readFileSync(full)).digest('hex'), modified: statSync(full).mtimeMs };
    }
  }
  walk(root); return result;
}
const before = snapshot(workspace);
const endpoint = 'http://127.0.0.1:9337';
// This debugging endpoint exists only in this CI test process. The application
// itself does not enable a debugging port or ship a test-mode command.
const child = spawn(executable, [], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9337', WEBVIEW2_USER_DATA_FOLDER: join(temp, 'webview-profile') },
  stdio: ['ignore', 'pipe', 'pipe']
});
let processOutput = ''; let browser; let page; let processError;
child.stdout.on('data', data => { processOutput += data; });
child.stderr.on('data', data => { processOutput += data; });
child.on('error', error => { processError = error; });
try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    if (processError) throw processError;
    if (child.exitCode !== null) throw new Error(`Desktop application exited before initialization: ${child.exitCode}\n${processOutput}`);
    try { const response = await fetch(`${endpoint}/json/version`, { signal: AbortSignal.timeout(1000) }); if (response.ok) { ready = true; break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  if (!ready) throw new Error(`WebView2 did not expose its test-only debugging endpoint.\n${processOutput}`);
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  page = context.pages()[0] ?? await context.waitForEvent('page');
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('button', { name: 'Choose folders', exact: true })).toBeEnabled({ timeout: 20000 });
  await expect(page.getByText('Browser preview', { exact: false })).toHaveCount(0);
  await expect(page.getByText('DEMO · SYNTHETIC DATA')).toHaveCount(0);
  await page.getByLabel('Add folder path').fill(workspace);
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await page.getByLabel('Include known shared caches').uncheck();
  await page.getByRole('button', { name: 'Scan workspace', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Scan summary' })).toBeVisible({ timeout: 30000 });
  await expect(page.getByRole('button', { name: 'Completed within scope', exact: true })).toBeVisible();
  await page.screenshot({ path: join(artifacts, 'native-overview.png'), fullPage: true });
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Findings', exact: false }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name: /Installed Node dependencies/ }).click();
  await expect(page.getByRole('button', { name: 'Open folder', exact: true })).toBeEnabled();
  await expect(page.getByRole('complementary', { name: 'Finding details' })).toContainText('1 KiB');
  await page.getByRole('button', { name: 'Protect this path', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove personal protection', exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: join(artifacts, 'native-findings.png'), fullPage: true });
  expect(snapshot(workspace)).toEqual(before);
  expect(errors).toEqual([]);
  const result = { passed: true, revision: process.env.GITHUB_SHA ?? 'local', platform: process.platform, browser: browser.version(), checks: ['Native desktop startup', 'No browser/demo fallback', 'Real Rust scan through the desktop UI', 'Three discovered projects and five findings', 'Expected Node dependency size', 'Personal protection interaction', 'Fixture content and modification times unchanged', 'No observed page errors'], notCovered: ['Native directory/save dialog automation', 'Folder reveal interaction', 'Large workspace cancellation', 'Installer installation/uninstallation'] };
  writeFileSync(join(artifacts, 'native-smoke.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: join(artifacts, 'native-failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (child.pid) spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
  writeFileSync(join(artifacts, 'native-process.log'), processOutput);
  // Cleanup is restricted to the uniquely generated fixture/profile directory.
  rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
