import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { extensionRoot, repoRoot, run, target } from './build.mjs';
const pkg = JSON.parse(readFileSync(path.join(extensionRoot, 'package.json'), 'utf8'));
const directory = path.join(repoRoot, 'artifacts'); mkdirSync(directory, { recursive: true });
run(process.execPath, [path.join(extensionRoot, 'node_modules', '@vscode', 'vsce', 'vsce'), 'package', '--no-dependencies', '--target', target, '--out', path.join(directory, `devspace-analyzer-${pkg.version}-${target}.vsix`)], extensionRoot);
