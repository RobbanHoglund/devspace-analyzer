import { mkdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { extensionRoot, repoRoot, run, target } from './build.mjs';
const pkg = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
const vsce = path.join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce');
// Validate the actual package allowlist, not just the source checkout. Shared
// host modules compile outside dist/vscode/src and must travel with the VSIX.
const listing = spawnSync(process.execPath, [vsce, 'ls', '--no-dependencies'], { cwd: extensionRoot, encoding: 'utf8' });
if (listing.status !== 0) throw new Error(`Could not inspect VSIX contents: ${listing.stderr}`);
const included = new Set(listing.stdout.trim().split(/\r?\n/).map(file => file.replaceAll('\\', '/')));
const rootPackage = JSON.parse(readFileSync(path.join(repoRoot, 'package.json'), 'utf8'));
if (pkg.version !== rootPackage.version || pkg.license !== 'Apache-2.0') throw new Error('Extension version/license does not match the release source.');
for (const file of ['LICENSE', 'NOTICE']) {
  if (!included.has(file) || !readFileSync(path.join(extensionRoot, file)).equals(readFileSync(path.join(repoRoot, file)))) throw new Error(`VSIX omits or changes ${file}.`);
}
if (!included.has('THIRD_PARTY_NOTICES.txt')) throw new Error('VSIX omits third-party license notices.');
if (!included.has(pkg.icon)) throw new Error('VSIX omits its publisher icon.');
if ([...included].some(file => /(?:^|\/)cleanup\.js$/.test(file))) throw new Error('Obsolete cleanup runner remains in the package.');
if (!included.has(pkg.main.replace(/^\.\//, ''))) throw new Error('VSIX omits its extension entry point.');
for (const file of included) {
  if (!file.startsWith('dist/') || !file.endsWith('.js')) continue;
  const contents = readFileSync(path.join(extensionRoot, file), 'utf8');
  for (const match of contents.matchAll(/require\(["'](\.[^"']+)["']\)/g)) {
    const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(file), match[1]));
    if (!included.has(`${dependency}.js`) && !included.has(`${dependency}/index.js`) && !included.has(dependency)) throw new Error(`VSIX omits ${match[1]}, required by ${file}.`);
  }
}
const directory = path.join(repoRoot, 'artifacts'); mkdirSync(directory, { recursive: true });
run(process.execPath, [vsce, 'package', '--no-dependencies', '--target', target, '--out', path.join(directory, `devspace-analyzer-${pkg.version}-${target}.vsix`)], extensionRoot);
