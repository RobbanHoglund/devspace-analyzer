import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const root = mkdtempSync(path.join(tmpdir(), 'devspace-benchmark-'));
const workspace = path.join(root, 'workspace');
const binary = path.resolve(process.argv[2] ?? `vscode/bin/devspace-scan${process.platform === 'win32' ? '.exe' : ''}`);
try {
  const config = path.join(root, 'npmrc'); writeFileSync(config, '');
  for (let project = 0; project < 100; project++) {
    const folder = path.join(workspace, `project-${project}`);
    mkdirSync(path.join(folder, 'node_modules'), { recursive: true });
    writeFileSync(path.join(folder, 'package.json'), '{"name":"benchmark-fixture"}');
    for (let group = 0; group < 10; group++) {
      const directory = path.join(folder, 'node_modules', `dependency-${group}`); mkdirSync(directory);
      for (let file = 0; file < 100; file++) writeFileSync(path.join(directory, `${file}.js`), 'export const fixture = true;\n');
    }
  }
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^npm_config_(userconfig|cache)$/i.test(key)) delete env[key];
  env.NPM_CONFIG_USERCONFIG = config;
  const start = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { env, stdio: ['pipe','pipe','inherit'], windowsHide: true });
    const lines = createInterface({ input: child.stdout }); let report;
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Benchmark exceeded 60 seconds.')); }, 60_000);
    lines.on('line', line => { const event = JSON.parse(line); if (event.type === 'report') report = event.data; if (event.type === 'error') reject(new Error(event.message)); });
    child.on('error', reject);
    child.on('close', code => { clearTimeout(timeout); code === 0 && report ? resolve(report) : reject(new Error(`Scanner failed (${code}).`)); });
    child.stdin.write(JSON.stringify({ protocolVersion: 1, request: { roots: [workspace], includeGlobalCaches: false, protectedPaths: [] } }) + '\n');
  });
  if (!result.complete || result.progress.files !== 100100 || result.projects.length !== 100 || result.findings.length !== 100) throw new Error('Benchmark did not measure the expected fixture completely.');
  console.log(JSON.stringify({ platform: process.platform, synthetic: true, files: result.progress.files, projects: result.projects.length, findings: result.findings.length, complete: result.complete, elapsedMs: Math.round(performance.now()-start), scannerDurationMs: result.durationMs, retainedDirectories: result.storage.directories.length, storageTruncated: result.storage.truncated }, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
