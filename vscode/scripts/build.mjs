import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const extensionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = path.dirname(extensionRoot);
export function run(command, args, cwd = repoRoot) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`);
}
export const target = `${process.platform}-${process.arch}`;
if (!['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) throw new Error(`Unsupported pilot target: ${target}`);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this build with npm run build or npm run package.');
run(process.execPath, [npm, 'run', 'build:vscode']);
run(process.execPath, [npm, 'run', 'compile'], extensionRoot);
run('cargo', ['build', '--locked', '--release', '-p', 'devspace-core', '--bin', 'devspace-scan']);
const binary = process.platform === 'win32' ? 'devspace-scan.exe' : 'devspace-scan';
mkdirSync(path.join(extensionRoot, 'bin'), { recursive: true });
copyFileSync(path.join(repoRoot, 'target', 'release', binary), path.join(extensionRoot, 'bin', binary));
chmodSync(path.join(extensionRoot, 'bin', binary), 0o755);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
writeFileSync(path.join(extensionRoot, 'bin', 'build.json'), JSON.stringify({ target, revision, protocolVersion: 1 }, null, 2) + '\n');

// Include the actual license texts of bundled web code and scanner dependencies.
const notices = ['DevSpace Analyzer — third-party notices\n'];
for (const name of ['react', 'react-dom', 'scheduler', '@tauri-apps/api', '@tauri-apps/plugin-dialog', 'vite']) {
  const dir = path.join(repoRoot, 'node_modules', name);
  const pkg = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
  notices.push(`\n=== ${name} ${pkg.version} (${pkg.license}) ===\n`);
  const licenses = readdirSync(dir).filter(file => /^(licen[cs]e|copying|copyright)/i.test(file));
  for (const file of licenses) notices.push(readFileSync(path.join(dir, file), 'utf8'));
  if (!licenses.length) throw new Error(`Missing license texts for ${name}`);
  if (name.startsWith('@tauri-apps/') && licenses.every(file => file.endsWith('.spdx'))) {
    notices.push(readFileSync(path.join(repoRoot, 'node_modules', '@tauri-apps', 'api', 'LICENSE-MIT'), 'utf8'));
  }
}
// Include licenses for the dependency graph actually compiled for this host.
// Without this filter, optional UEFI/WASI dependencies enter desktop packages.
const rustHost = spawnSync('rustc', ['-vV'], { encoding: 'utf8' }).stdout?.match(/^host: (.+)$/m)?.[1];
if (!rustHost) throw new Error('Could not determine the scanner build platform.');
const metadataRun = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', rustHost], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (metadataRun.status !== 0) throw new Error('Could not collect scanner dependency licenses.');
const metadata = JSON.parse(metadataRun.stdout);
const start = metadata.packages.find(pkg => pkg.name === 'devspace-core');
const pending = [start.id]; const visited = new Set();
while (pending.length) {
  const id = pending.pop(); if (visited.has(id)) continue; visited.add(id);
  const pkg = metadata.packages.find(pkg => pkg.id === id);
  const node = metadata.resolve.nodes.find(node => node.id === id);
  for (const dep of node.deps) if (dep.dep_kinds.some(kind => kind.kind !== 'dev')) pending.push(dep.pkg);
  if (id === start.id) continue;
  const dir = path.dirname(pkg.manifest_path);
  notices.push(`\n=== ${pkg.name} ${pkg.version} (${pkg.license ?? 'see license text'}) ===\n${pkg.repository ?? ''}\n`);
  const licenses = readdirSync(dir).filter(file => /^(licen[cs]e|copying|copyright)/i.test(file));
  if (pkg.license_file && existsSync(path.join(dir, pkg.license_file))) licenses.push(pkg.license_file);
  if (!licenses.length) throw new Error(`Missing license texts for ${pkg.name}`);
  for (const file of new Set(licenses)) notices.push(readFileSync(path.join(dir, file), 'utf8'));
}
writeFileSync(path.join(extensionRoot, 'THIRD_PARTY_NOTICES.txt'), notices.join('\n'));
