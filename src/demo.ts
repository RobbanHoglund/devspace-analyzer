import type { Finding, Project, Report, Risk } from './types';
const gib = (n: number) => Math.round(n * 1024 ** 3);
export function demoReport(): Report {
  const home = 'C:\\Users\\Developer';
  const projects: Project[] = [
    { id: 'p0', name: 'gateway-service', path: 'C:\\Workspaces\\gateway-service', ecosystems: ['Gradle'], markers: ['build.gradle.kts'], lockfiles: ['gradle.lockfile'], gitKind: 'repository', branch: 'main', wrapperVersion: '8.14.3', workspace: false, ownedLogicalBytes: gib(1.4), artifactBytes: gib(1.2) },
    { id: 'p1', name: 'shopfront', path: 'C:\\Workspaces\\shopfront', ecosystems: ['Node'], markers: ['package.json'], lockfiles: ['pnpm-lock.yaml'], gitKind: 'repository', branch: 'feature/catalog', wrapperVersion: null, workspace: true, ownedLogicalBytes: gib(8.8), artifactBytes: gib(8.5) },
    { id: 'p2', name: 'data-lab', path: 'C:\\Workspaces\\data-lab', ecosystems: ['Python'], markers: ['pyproject.toml'], lockfiles: ['uv.lock'], gitKind: 'worktree', branch: null, wrapperVersion: null, workspace: false, ownedLogicalBytes: gib(1.9), artifactBytes: gib(1.75) }
  ];
  const add = (id: string, label: string, ecosystem: string, path: string, size: number, risk: Risk, projectId: string | null, reason: string, recovery: string, extra: Partial<Finding> = {}): Finding => ({
    id, label, ecosystem, path, logicalBytes: gib(size), risk, projectId, reason, recovery, kind: ['gradle-cache', 'node-modules', 'maven-repository', 'virtual-disks', 'gradle-wrapper', 'python-venv', 'gradle-project', 'node-output', 'python-bytecode', 'git-metadata'][Number(id.slice(1))] ?? 'demo-category', confidence: 'contextual', files: Math.round(size * 13_742), latestModified: 1788004800,
    evidence: ['Synthetic demonstration finding; not measured on this computer.'], caveats: ['Source availability, tracked files and running tools must be checked before cleanup.', 'Logical bytes are not guaranteed space savings.'], complete: true, userProtected: false, wrapperVersion: null, wrapperReferences: [], ...extra
  });
  const findings = [
    add('f0', 'Gradle dependency cache', 'Gradle', `${home}\\.gradle\\caches\\modules-2`, 11.4, 'review', null, 'Shared dependencies across builds. Gradle already has automatic retention; a cache may also be your only offline copy.', 'Review Gradle retention settings. Future builds may need to download dependencies again.'),
    add('f1', 'Installed Node dependencies', 'Node', `${projects[1].path}\\node_modules`, 7.8, 'review', 'p1', 'A pnpm lockfile was found. Local packages, manual patches and hardlinked store content still need review.', 'Verify the lockfile and local package sources before reinstalling.'),
    add('f2', 'Maven local repository', 'Maven', `${home}\\.m2\\repository`, 5.4, 'protected', null, 'May contain locally installed JARs and snapshots without a remote copy. Do not treat the whole repository as disposable.', 'Identify artifact origins and back up any local-only packages.'),
    add('f3', 'Container virtual disks', 'Containers', `${home}\\AppData\\Local\\Docker\\wsl`, 8.8, 'protected', null, 'Contains virtual disks that can hold persistent application data. Sparse images make logical size misleading.', 'Inspect from the container platform. Never delete a VHDX to clean a cache.'),
    add('f4', 'Gradle wrapper distribution', 'Gradle', `${home}\\.gradle\\wrapper\\dists\\gradle-7.6.4-bin`, 2.6, 'review', null, 'No matching wrapper was found in the selected projects. This does not prove the version is unused elsewhere.', 'Let Gradle manage retention where possible. Downloading again may be required.', { wrapperVersion: '7.6.4', wrapperReferences: [] }),
    add('f5', 'Python virtual environment', 'Python', `${projects[2].path}\\.venv`, 1.7, 'review', 'p2', 'pyvenv.cfg and uv.lock were found. Editable or manually installed packages may not be recoverable from the lock alone.', 'Check the interpreter, lockfile and local package origins.'),
    add('f6', 'Gradle project artifacts', 'Gradle', `${projects[0].path}\\build`, 1.2, 'review', 'p0', 'Conventional build output next to a Gradle project. Unique outputs and tracked files have not been excluded.', 'Review contents, then rebuild normal output with the trusted project.'),
    add('f7', 'Possible Node build artifacts', 'Node', `${projects[1].path}\\.next`, 0.7, 'review', 'p1', 'A conventional Next.js build directory next to package.json. Review contents before treating it as disposable.', 'A fresh build can recreate conventional output.'),
    add('f8', 'Python bytecode cache', 'Python', `${projects[2].path}\\src\\__pycache__`, 0.05, 'low', 'p2', 'Each observed .pyc filename has a corresponding .py source filename. Source content was not opened.', 'Python normally recreates bytecode when the source is imported.'),
    add('f9', 'Git metadata', 'Git', `${projects[1].path}\\.git`, 0.3, 'protected', 'p1', 'Repository history and references are not build cache.', 'Use Git maintenance after a backup; do not delete this directory.')
  ];
  return {
    schemaVersion: 1, startedAt: 1791622800, durationMs: 12400, roots: ['C:\\Workspaces', `${home}\\.gradle`, `${home}\\.m2\\repository`],
    globalCaches: [{ path: `${home}\\.gradle\\caches`, ecosystem: 'Gradle', kind: 'gradle-caches', source: 'Platform default (demo)' }, { path: `${home}\\.m2\\repository`, ecosystem: 'Maven', kind: 'maven-repository', source: 'Platform default (demo)' }],
    findings, projects, progress: { files: 487214, directories: 36182, logicalBytes: gib(42.1), projects: projects.length, currentPath: '' },
    warnings: [{ path: `${projects[1].path}\\packages\\linked-package`, code: 'link-skipped', message: 'Linked package was not followed (synthetic warning).' }], warningCount: 1, complete: false, cancelled: false,
    sizeBasis: 'Logical file lengths, not physical or guaranteed reclaimable bytes',
    limitations: ['DEMO: all values are synthetic and illustrative; nothing on this computer was scanned.', 'Only selected roots and discovered caches are included.', 'No builds, package-manager commands or Git commands are executed.', 'Hardlinks, sparse files and compression prevent a precise reclaimable-space estimate.', 'Modification dates are not last-use dates. No matching wrapper does not mean unused.']
  };
}
