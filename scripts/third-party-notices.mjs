import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function writeNotices(packageName, destination, targetOverride) {
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
const rustHost = targetOverride ?? spawnSync('rustc', ['-vV'], { encoding: 'utf8' }).stdout?.match(/^host: (.+)$/m)?.[1];
if (!rustHost) throw new Error('Could not determine the scanner build platform.');
const metadataRun = spawnSync('cargo', ['metadata', '--locked', '--format-version', '1', '--filter-platform', rustHost], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (metadataRun.status !== 0) throw new Error('Could not collect scanner dependency licenses.');
const metadata = JSON.parse(metadataRun.stdout);
// cargo metadata resolves optional packages as well. Attribute the dependencies
// actually selected for this build target, including build-time dependencies.
const tree = spawnSync('cargo', ['tree', '--locked', '-p', packageName, '--target', rustHost, '--edges', 'normal,build', '--prefix', 'none', '--format', '{p}'], { cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
if (tree.status !== 0) throw new Error('Could not collect the compiled dependency graph.');
const compiled = new Set(tree.stdout.split(/\r?\n/).map(line => line.match(/^([\w-]+) v([^ ]+)/)?.slice(1).join('@')).filter(Boolean));
for (const pkg of metadata.packages) {
  if (!pkg.source || !compiled.has(`${pkg.name}@${pkg.version}`)) continue;
  const dir = path.dirname(pkg.manifest_path);
  notices.push(`\n=== ${pkg.name} ${pkg.version} (${pkg.license ?? 'see license text'}) ===\n${pkg.repository ?? ''}\nAuthors: ${pkg.authors.join(', ')}\nCorresponding source: https://crates.io/api/v1/crates/${pkg.name}/${pkg.version}/download\n`);
  const licenses = readdirSync(dir).filter(file => /^(licen[cs]e|copying|copyright)/i.test(file));
  if (pkg.license_file && existsSync(path.join(dir, pkg.license_file))) licenses.push(pkg.license_file);
  if (!licenses.length) {
    const supplements = JSON.parse(readFileSync(path.join(repoRoot, 'scripts', 'licenses', 'supplements.json'), 'utf8'));
    const supplement = supplements[`${pkg.name}-${pkg.version}`];
    const vcs = JSON.parse(readFileSync(path.join(dir, '.cargo_vcs_info.json'), 'utf8'));
    if (!supplement || supplement.revision !== vcs.git.sha1) throw new Error(`Missing pinned license text for ${pkg.name} ${pkg.version}`);
    notices.push(`Source of supplemental license: ${supplement.source}\n`);
    notices.push(readFileSync(path.join(repoRoot, 'scripts', 'licenses', supplement.file), 'utf8'));
  }
  for (const file of new Set(licenses)) notices.push(readFileSync(path.join(dir, file), 'utf8'));
}
writeFileSync(destination, notices.join('\n'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  writeNotices('devspace-analyzer', path.join(repoRoot, 'src-tauri', 'THIRD_PARTY_NOTICES.txt'));
}
