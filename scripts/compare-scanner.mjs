// Paired benchmark: same disposable files, alternating order, equal full reports.
// All filesystem caches are warm; this is not a real-workspace speed guarantee.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const [currentPath, baselinePath] = process.argv.slice(2);
if (!currentPath || !baselinePath) throw new Error('Usage: node scripts/compare-scanner.mjs CURRENT_BINARY BASELINE_BINARY');
const binaries = { current: path.resolve(currentPath), baseline: path.resolve(baselinePath) };
const root = mkdtempSync(path.join(tmpdir(), 'devspace-paired-'));
const env = { ...process.env };
for (const key of Object.keys(env)) if (/^npm_config_(userconfig|cache)$/i.test(key)) delete env[key];
env.NPM_CONFIG_USERCONFIG = path.join(root, 'npmrc'); writeFileSync(env.NPM_CONFIG_USERCONFIG, '');
const hash = report => {
  const stable = structuredClone(report);
  delete stable.startedAt; delete stable.durationMs; delete stable.progress.currentPath;
  return createHash('sha256').update(JSON.stringify(stable)).digest('hex');
};
async function scan(binary, workspace) {
  const start = performance.now();
  const report = await new Promise((resolve, reject) => {
    const child = spawn(binary, [], { env, stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true });
    let report; const lines = createInterface({ input: child.stdout });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Benchmark exceeded 120 seconds.')); }, 120_000);
    lines.on('line', line => { try { const event = JSON.parse(line); if (event.type === 'report') report = event.data; if (event.type === 'error') reject(new Error(event.message)); } catch (error) { child.kill(); reject(error); } });
    child.on('error', error => { clearTimeout(timeout); reject(error); });
    child.on('close', code => { clearTimeout(timeout); code === 0 && report ? resolve(report) : reject(new Error(`Scanner failed (${code}).`)); });
    child.stdin.write(JSON.stringify({ protocolVersion: 1, request: { roots: [workspace], includeGlobalCaches: false, protectedPaths: [] } }) + '\n');
  });
  assert.equal(report.complete, true);
  assert.equal(report.progress.files, 100100);
  assert.equal(report.projects.length, 100);
  assert.equal(report.findings.length, 100);
  return { reportHash: hash(report), scannerMs: report.durationMs, totalMs: Math.round(performance.now() - start), directories: report.progress.directories, retainedDirectories: report.storage.directories.length, storageTruncated: report.storage.truncated };
}
const results = [];
try {
  for (const profile of ['flat', 'mixed-deep']) {
    const workspace = path.join(root, profile);
    for (let project = 0; project < 100; project++) {
      const folder = path.join(workspace, `project-${project}`);
      mkdirSync(folder, { recursive: true }); writeFileSync(path.join(folder, 'package.json'), '{"name":"benchmark-fixture"}');
      for (let group = 0; group < 10; group++) {
        const dependency = profile === 'flat' ? path.join(folder, 'node_modules', `dependency-${group}`) : path.join(folder, 'node_modules', '@fixture', `dependency-${group}`, 'lib', 'generated', 'v1');
        const source = path.join(folder, 'src', `feature-${group}`, 'components', 'internal');
        mkdirSync(dependency, { recursive: true }); if (profile !== 'flat') mkdirSync(source, { recursive: true });
        for (let file = 0; file < 100; file++) writeFileSync(path.join(profile !== 'flat' && file < 25 ? source : dependency, `${file}.js`), 'export const fixture = true;\n');
      }
    }
    // Explicit warm-up, excluded from timings.
    const reference = await scan(binaries.baseline, workspace);
    assert.equal((await scan(binaries.current, workspace)).reportHash, reference.reportHash, `${profile}: complete reports must match`);
    const samples = { baseline: [], current: [] };
    for (let round = 0; round < 3; round++) {
      for (const variant of round % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const result = await scan(binaries[variant], workspace);
        assert.equal(result.reportHash, reference.reportHash, `${profile}/${variant}: complete reports must match`);
        samples[variant].push(result.scannerMs);
      }
    }
    const median = values => [...values].sort((a, b) => a - b)[1];
    const baselineMedianMs = median(samples.baseline), currentMedianMs = median(samples.current);
    results.push({ profile, files: 100100, directories: reference.directories, identicalReports: true, samples, baselineMedianMs, currentMedianMs, speedup: Number((baselineMedianMs / currentMedianMs).toFixed(2)), reductionPercent: Number((100 * (1 - currentMedianMs / baselineMedianMs)).toFixed(1)) });
    rmSync(workspace, { recursive: true, force: true });
  }
  console.log(JSON.stringify({ platform: process.platform, synthetic: true, warmFilesystem: true, baselineRevision: 'eec50f9df34a6c9ed7621e9670edff50371cc092', results }, null, 2));
} finally { rmSync(root, { recursive: true, force: true }); }
