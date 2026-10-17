import { writeNotices } from '../../scripts/third-party-notices.mjs';
import { spawnSync } from 'node:child_process';
import { mkdirSync, copyFileSync, chmodSync, writeFileSync, rmSync } from 'node:fs';
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
if (!['win32-x64', 'linux-x64', 'darwin-x64', 'darwin-arm64'].includes(target)) throw new Error(`Unsupported package target: ${target}`);
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run this build with npm run build or npm run package.');
run(process.execPath, [npm, 'run', 'icons']);
// Remove obsolete compiled host modules before packaging a new version.
rmSync(path.join(extensionRoot, 'dist'), { recursive: true, force: true });
run(process.execPath, [npm, 'run', 'build:vscode']);
run(process.execPath, [npm, 'run', 'compile'], extensionRoot);
run('cargo', ['build', '--locked', '--release', '-p', 'devspace-core', '--bin', 'devspace-scan']);
const binary = process.platform === 'win32' ? 'devspace-scan.exe' : 'devspace-scan';
mkdirSync(path.join(extensionRoot, 'bin'), { recursive: true });
copyFileSync(path.join(repoRoot, 'target', 'release', binary), path.join(extensionRoot, 'bin', binary));
chmodSync(path.join(extensionRoot, 'bin', binary), 0o755);
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).stdout.trim();
writeFileSync(path.join(extensionRoot, 'bin', 'build.json'), JSON.stringify({ target, revision, protocolVersion: 1 }, null, 2) + '\n');

writeNotices('devspace-core', path.join(extensionRoot, 'THIRD_PARTY_NOTICES.txt'));
