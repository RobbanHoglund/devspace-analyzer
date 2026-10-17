import { downloadAndUnzipVSCode, runTests, resolveCliArgsFromVSCodeExecutablePath } from '@vscode/test-electron';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.dirname(extensionRoot);
// macOS Unix-domain sockets have a 103-byte path limit; use a short isolated profile path.
const temporaryBase = process.platform === 'darwin' ? '/private/tmp' : tmpdir();
const temporary = await realpath(await mkdtemp(path.join(temporaryBase, 'ds-vsix-')));
const restricted = process.argv.includes('--restricted');
try {
  const fixture = path.join(temporary, 'workspace'); const extensions = path.join(temporary, 'extensions'); const profile = path.join(temporary, 'profile');
  await mkdir(path.join(fixture, 'node_modules', 'example'), { recursive: true });
  await writeFile(path.join(fixture, 'package.json'), '{"name":"extension-fixture"}');
  await writeFile(path.join(fixture, 'node_modules', 'example', 'index.js'), 'const fixture = true;');
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'workbench.startupEditor': 'none',
    'window.titleBarStyle': 'custom', 'security.workspace.trust.startupPrompt': 'never', 'security.workspace.trust.enabled': restricted,
  }));
  const npmrc = path.join(temporary, 'npmrc'); await writeFile(npmrc, '');
  const npmCache = path.join(temporary, 'npm-cache');
  await mkdir(path.join(npmCache, '_cacache'), { recursive: true });
  await writeFile(path.join(npmCache, '_cacache', 'fixture'), Buffer.alloc(2048, 1));
  const executable = await downloadAndUnzipVSCode({ version: process.env.DEVSPACE_VSCODE_VERSION, cachePath: path.join(extensionRoot, '.vscode-test') });
  const pkg = JSON.parse(await readFile(path.join(extensionRoot, 'package.json'), 'utf8'));
  const vsix = path.join(root, 'artifacts', `devspace-analyzer-${pkg.version}-${process.platform}-${process.arch}.vsix`);
  const [cli, ...cliArgs] = resolveCliArgsFromVSCodeExecutablePath(executable);
  const install = spawnSync(cli, [...cliArgs, '--install-extension', vsix, '--extensions-dir', extensions, '--user-data-dir', profile, '--force', '--no-sandbox'], { encoding: 'utf8', shell: process.platform === 'win32' });
  process.stdout.write(install.stdout ?? ''); process.stderr.write(install.stderr ?? '');
  if (install.status !== 0) throw new Error('VSIX installation failed.');
  const options = {
    vscodeExecutablePath: executable, extensionDevelopmentPath: path.join(extensionRoot, 'test', 'harness'),
    extensionTestsPath: path.join(extensionRoot, 'dist', 'vscode', 'test', 'integration.js'),
    extensionTestsEnv: { npm_config_userconfig: npmrc, NPM_CONFIG_USERCONFIG: npmrc, npm_config_cache: npmCache, NPM_CONFIG_CACHE: npmCache, DEVSPACE_TEST_ROOT: temporary, DEVSPACE_RESTRICTED: restricted ? '1' : '0', DEVSPACE_ARTIFACTS: path.join(root, 'artifacts', process.env.DEVSPACE_VSCODE_VERSION ? 'minimum-vscode' : '.') },
    launchArgs: [fixture, '--extensions-dir', extensions, '--user-data-dir', profile, '--skip-welcome', '--skip-release-notes', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=9228', ...(restricted ? [] : ['--disable-workspace-trust'])],
  };
  if (restricted) {
    // test-electron unconditionally adds --disable-workspace-trust. Launch this
    // isolated test host ourselves so the real Restricted Mode can be exercised.
    await new Promise((resolve, reject) => {
      const child = spawn(executable, [...options.launchArgs,
        `--extensionDevelopmentPath=${options.extensionDevelopmentPath}`,
        `--extensionTestsPath=${options.extensionTestsPath}`,
      ], { env: { ...process.env, ...options.extensionTestsEnv }, stdio: 'inherit' });
      const timeout = setTimeout(() => { child.kill(); reject(new Error('Restricted Mode test timed out.')); }, 120000);
      child.on('error', error => { clearTimeout(timeout); reject(error); });
      child.on('close', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error(`Restricted Mode test failed (${code}).`)); });
    });
  } else await runTests(options);
} finally { await rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); }
