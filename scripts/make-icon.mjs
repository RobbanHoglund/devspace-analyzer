import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
// One unmodified author portrait, shared with JvmScope. Tauri generates the
// platform icon sizes; the source and VSIX icon stay byte-for-byte identical.
const source = 'src/assets/robbanhoglund.png';
mkdirSync('vscode/resources', { recursive: true });
copyFileSync(source, 'vscode/resources/robbanhoglund.png');
const mark = readFileSync('vscode/resources/devspace.svg', 'utf8');
for (const [theme, color] of [['light','#424242'],['dark','#c5c5c5']]) writeFileSync(`vscode/resources/devspace-${theme}.svg`, mark.replace('stroke="currentColor"', `stroke="${color}"`));
const result = spawnSync(process.execPath, ['node_modules/@tauri-apps/cli/tauri.js', 'icon', source, '--output', 'src-tauri/icons'], { stdio: 'inherit', shell: false });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status ?? 1);
