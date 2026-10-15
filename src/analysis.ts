import type { Finding, Project, Report, Risk } from './types';

export function bytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'Unknown';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const i = value === 0 ? 0 : Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** i).toLocaleString('en-GB', { maximumFractionDigits: i === 0 ? 0 : 1 })} ${units[i]}`;
}
export function visiblePath(path: string): string {
  const normal = path.replaceAll('\\', '/');
  return normal.startsWith('//?/') ? path.slice(4) : path;
}
function pathKey(path: string): string {
  let value = visiblePath(path).replaceAll('\\', '/');
  if (/^[A-Za-z]:\//.test(value)) value = value.toLowerCase();
  return value.length > 1 ? value.replace(/\/+$/, '') : value;
}
export function samePath(a: string, b: string): boolean {
  const key = pathKey(a);
  return !!key && key === pathKey(b);
}
/** Remove only the selected saved rule, never its ancestors or descendants. */
export function removeProtectionRule(paths: string[], rule: string): string[] {
  return paths.filter(path => !samePath(path, rule));
}
export function pathsOverlap(a: string, b: string): boolean {
  const x = pathKey(a), y = pathKey(b);
  if (!x || !y) return false;
  const under = (p: string, root: string) => p === root || p.startsWith(root.endsWith('/') ? root : `${root}/`);
  return under(x, y) || under(y, x);
}
/** Include existing enclosing protected findings without reassigning ownership or bytes. */
export function findingsForProject(findings: Finding[], project: Pick<Project, 'id' | 'path'>): Finding[] {
  const projectPath = pathKey(project.path);
  return findings.filter(f => {
    if (f.projectId === project.id) return true;
    const enclosing = pathKey(f.path);
    return f.risk === 'protected' && !!enclosing && !!projectPath &&
      (projectPath === enclosing || projectPath.startsWith(enclosing.endsWith('/') ? enclosing : `${enclosing}/`));
  });
}
export function isProtected(finding: Finding, protectedPaths: string[]): boolean {
  return finding.risk === 'protected' || protectedPaths.some(path => pathsOverlap(path, finding.path));
}
export function effectiveRisk(f: Finding, paths: string[]): Risk { return isProtected(f, paths) ? 'protected' : f.risk; }
export function summarize(findings: Finding[], paths: string[]) {
  return findings.reduce((sum, f) => {
    sum.identified += f.logicalBytes;
    if (isProtected(f, paths)) sum.protected += f.logicalBytes;
    else if (f.complete) sum.candidates += f.logicalBytes;
    else sum.incomplete += f.logicalBytes;
    return sum;
  }, { identified: 0, candidates: 0, protected: 0, incomplete: 0 });
}
export interface Tile { name: string; value: number; x: number; y: number; w: number; h: number }
export function treemap(items: { name: string; value: number }[], x = 0, y = 0, w = 960, h = 240): Tile[] {
  const positive = items.filter(item => item.value > 0 && Number.isFinite(item.value));
  if (!positive.length) return [];
  if (positive.length === 1) return [{ ...positive[0], x, y, w, h }];
  const total = positive.reduce((sum, item) => sum + item.value, 0);
  let split = 1, left = positive[0].value;
  while (split < positive.length - 1 && left + positive[split].value <= total / 2) left += positive[split++].value;
  const ratio = left / total;
  return w >= h
    ? [...treemap(positive.slice(0, split), x, y, w * ratio, h), ...treemap(positive.slice(split), x + w * ratio, y, w * (1 - ratio), h)]
    : [...treemap(positive.slice(0, split), x, y, w, h * ratio), ...treemap(positive.slice(split), x, y + h * ratio, w, h * (1 - ratio))];
}

/** Strict summary redaction: no free-text evidence, paths, branch names or project
 * names are copied. This also protects against future rules embedding paths in prose. */
export function redactedReport(report: Report): Report {
  const projects = new Map(report.projects.map((p, i) => [p.id, `p${i}`]));
  const ecosystems = new Set(['Gradle', 'Maven', 'Node', 'Python', 'Git', 'Containers']);
  const safeEco = (e: string) => ecosystems.has(e) ? e : 'Other';
  return {
    schemaVersion: report.schemaVersion, startedAt: report.startedAt, durationMs: report.durationMs,
    roots: report.roots.map((_, i) => `[scope-${i + 1}]`),
    globalCaches: report.globalCaches.map((c, i) => ({ path: `[cache-${i + 1}]`, ecosystem: safeEco(c.ecosystem), kind: 'shared-storage', source: 'Location source withheld' })),
    projects: report.projects.map((p, i) => ({ id: `p${i}`, name: `Project ${i + 1}`, path: `[project-${i + 1}]`, ecosystems: p.ecosystems.map(safeEco), markers: [], lockfiles: [], gitKind: p.gitKind === 'worktree' ? 'worktree' : p.gitKind === 'repository' ? 'repository' : null, branch: null, wrapperVersion: null, workspace: p.workspace, ownedLogicalBytes: p.ownedLogicalBytes, artifactBytes: p.artifactBytes })),
    findings: report.findings.map((f, i) => ({
      id: `f${i}`, path: `[finding-${i + 1}]`, label: `${safeEco(f.ecosystem)} storage ${i + 1}`, ecosystem: safeEco(f.ecosystem), kind: 'classified-storage',
      risk: ['low', 'review', 'protected'].includes(f.risk) ? f.risk : 'protected', confidence: 'See local report',
      logicalBytes: f.logicalBytes, files: f.files, latestModified: f.latestModified, projectId: f.projectId ? projects.get(f.projectId) ?? null : null,
      evidence: ['Detailed evidence withheld from the redacted summary.'], reason: 'Inspect the local application for the category-specific analysis.', recovery: 'Review the local recovery notes before considering changes.', caveats: ['No guaranteed physical-space saving is claimed.'],
      complete: f.complete, userProtected: f.userProtected, wrapperVersion: null, wrapperReferences: f.wrapperReferences.map(id => projects.get(id)).filter((id): id is string => !!id)
    })),
    progress: { ...report.progress, currentPath: '[withheld]' },
    warnings: report.warnings.map((_, i) => ({ path: `[warning-${i + 1}]`, code: 'withheld', message: 'Inspect this warning in the local application.' })),
    warningCount: report.warningCount, complete: report.complete, cancelled: report.cancelled,
    sizeBasis: 'Logical file lengths; physical allocation and reclaimable bytes are unknown.',
    limitations: ['Redacted summary: paths, names, branches, versions and detailed evidence are withheld.', 'Only the chosen scan scope was inventoried. No cleanup was performed.']
  };
}
function markdownText(value: string) { return value.replace(/[\\`*_{}\[\]<>#!|]/g, '\\$&').replace(/[\r\n]/g, ' '); }
export function markdownReport(report: Report, origin: 'native' | 'demo'): string {
  const rows = report.findings.slice().sort((a, b) => b.logicalBytes - a.logicalBytes).map(f => {
    const risk = f.userProtected ? 'protected' : f.risk;
    const size = `${bytes(f.logicalBytes)}${f.complete ? '' : ' (partial)'}`;
    const candidate = f.complete && risk !== 'protected';
    return `| ${markdownText(f.label)} | ${size} | ${f.complete ? 'Complete' : 'Partial'} | ${risk} | ${candidate ? 'Yes' : 'No'} | ${markdownText(f.path)} |`;
  });
  return `# DevSpace Analyzer report

Origin: ${origin === 'demo' ? 'DEMO — synthetic data, not this computer' : 'Local native scan'}

Scan: ${new Date(report.startedAt * 1000).toISOString()}

Status: ${report.cancelled ? 'Cancelled; partial results' : report.complete ? 'Completed within scope' : 'Partial coverage; review warnings'}

${report.sizeBasis}

Files measured: ${report.progress.files}

Warnings: ${report.warningCount}

## Findings

Partial sizes include only the files measured, not unread or skipped entries. Incomplete findings are excluded from review candidates. A review candidate is a complete, unprotected finding requiring further review, not approval to delete.

| Finding | Logical size | Measurement | Risk | Review candidate | Path |
|---|---:|---|---|---|---|
${rows.join('\n')}

## Limitations

${report.limitations.map(s => `- ${markdownText(s)}`).join('\n')}

No files were deleted. Review the detailed local evidence before taking any action.
`;
}
