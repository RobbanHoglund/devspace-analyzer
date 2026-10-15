const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { Scanner } = require('../dist/vscode/src/scanner.js');
const { scanRequest } = require('../dist/vscode/src/protocol.js');
const { exportContent, writeNewReport } = require('../dist/vscode/src/export.js');
const extensionRoot = path.resolve(__dirname, '..');
const binaryName = process.platform === 'win32' ? 'devspace-scan.exe' : 'devspace-scan';
const bundled = path.join(extensionRoot, 'bin', binaryName);
const binary = existsSync(bundled) ? bundled : path.resolve(extensionRoot, '../target/debug', binaryName);
const request = root => ({ roots: [root], includeGlobalCaches: false, protectedPaths: [] });
// npm injects userconfig even when that file does not exist. Supply an explicit
// disposable configuration so the scanner tests have deterministic coverage.
let configDirectory;
const previousConfig = Object.entries(process.env).filter(([key]) => /^npm_config_userconfig$/i.test(key));
before(async () => {
  configDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'devspace-test-config-'));
  const config = path.join(configDirectory, 'npmrc'); await fs.writeFile(config, '');
  for (const [key] of previousConfig) delete process.env[key];
  process.env.npm_config_userconfig = config;
});
after(async () => {
  delete process.env.npm_config_userconfig;
  for (const [key, value] of previousConfig) process.env[key] = value;
  await fs.rm(configDirectory, { recursive: true, force: true });
});
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'devspace-vscode-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.mkdir(path.join(root, 'node_modules', 'example'), { recursive: true });
  await fs.writeFile(path.join(root, 'package.json'), '{"name":"read-only-fixture","scripts":{"postinstall":"exit 99"}}');
  await fs.writeFile(path.join(root, 'node_modules', 'example', 'index.js'), 'const value = 42;');
  return root;
}
test('bundled scanner inventories real files without modifying content or mtime', async t => {
  const root = await fixture(t); const file = path.join(root, 'node_modules', 'example', 'index.js');
  const before = { data: await fs.readFile(file), stat: await fs.stat(file) };
  const scanner = new Scanner(binary, extensionRoot); t.after(() => scanner.dispose());
  const progress = [];
  const report = await scanner.scan(request(root), event => progress.push(event));
  assert.equal(report.projects.length, 1);
  assert.ok(report.findings.some(f => f.ecosystem === 'Node'));
  assert.equal(report.complete, true, JSON.stringify(report.warnings)); assert.ok(progress.length > 0);
  assert.deepEqual(await fs.readFile(file), before.data);
  assert.equal((await fs.stat(file)).mtimeMs, before.stat.mtimeMs);
  assert.equal(scanner.running, false);
  await assert.rejects(scanner.scan(request(path.join(root, 'missing')), () => {}), /No accessible/);
  const again = await scanner.scan(request(root), () => {}); assert.equal(again.complete, true);
});
test('rejects duplicate concurrent scans and cancels a running native scan', async t => {
  const root = await fixture(t);
  // A large enough tree lets the queued cancellation reach the scanner's boundary checks.
  for (let i = 0; i < 30; i++) {
    const dir = path.join(root, 'source', String(i)); await fs.mkdir(dir, { recursive: true });
    await Promise.all(Array.from({ length: 100 }, (_, j) => fs.writeFile(path.join(dir, `${j}.txt`), 'fixture')));
  }
  const scanner = new Scanner(binary, extensionRoot); t.after(() => scanner.dispose());
  const result = scanner.scan(request(root), () => {});
  await assert.rejects(scanner.scan(request(root), () => {}), /already running/);
  scanner.cancel(); const report = await result;
  assert.equal(report.cancelled, true); assert.equal(report.complete, false);
  const fresh = await scanner.scan(request(root), () => {}); assert.equal(fresh.cancelled, false);
});
test('scanner rejects incompatible protocol and oversized input', async () => {
  async function run(input) {
    return new Promise((resolve, reject) => {
      const child = spawn(binary, [], { cwd: extensionRoot, windowsHide: true }); let output = '';
      child.stdout.on('data', data => output += data); child.on('error', reject);
      child.stdin.on('error', () => {}); child.stdin.end(input);
      child.on('close', code => resolve({ code, output }));
    });
  }
  const incompatible = await run(JSON.stringify({ protocolVersion: 2, request: request(extensionRoot) }) + '\n');
  assert.equal(incompatible.code, 1); assert.match(incompatible.output, /Unsupported scanner protocol/);
  const oversized = await run('x'.repeat(2 * 1024 * 1024 + 1) + '\n');
  assert.equal(oversized.code, 1); assert.match(oversized.output, /at most 2 MiB/);
});
test('scan request rejects relative paths, option injection, excessive roots and implicit cache opt-in', () => {
  for (const roots of [['relative'], ['--help'], [os.tmpdir() + '\0x'], Array(33).fill(os.tmpdir())]) {
    assert.throws(() => scanRequest({ roots, includeGlobalCaches: false, protectedPaths: [] }));
  }
  assert.throws(() => scanRequest({ roots: [os.tmpdir()], protectedPaths: [] }));
  assert.throws(() => scanRequest({ roots: [], includeGlobalCaches: false, protectedPaths: [] }));
});
test('export validates format and never overwrites an existing file or symlink', async t => {
  const root = await fixture(t); const destination = path.join(root, 'report.json');
  assert.throws(() => exportContent('broken', 'json'), /Invalid JSON/);
  assert.throws(() => exportContent('x', 'exe'), /Unsupported/);
  assert.throws(() => exportContent('x'.repeat(32 * 1024 * 1024 + 1), 'md'), /32 MiB/);
  await writeNewReport(destination, '{"redacted":true}', 'json');
  await assert.rejects(writeNewReport(destination, 'replacement', 'json'), /never overwritten/);
  assert.equal(await fs.readFile(destination, 'utf8'), '{"redacted":true}');
  await assert.rejects(writeNewReport(path.join(root, 'wrong.exe'), 'x', 'md'), /Choose a .md/);
  if (process.platform !== 'win32') {
    const link = path.join(root, 'link.json'); await fs.symlink(destination, link);
    await assert.rejects(writeNewReport(link, 'replacement', 'json'), /never overwritten/);
  }
});
