import { isProtected } from './analysis';
import { folderName } from './insights';
import { pathKey } from './storage';
import type { Finding, Project, Report } from './types';

export interface ReviewPlan {
  title: string; reason: string; action: string; recovery: string; tradeoff: string;
  checks: { label: string; state: 'found' | 'check' | 'missing' }[];
  command?: { label: string; text: string; note: string };
  directory?: string; documentation?: string; priority: number;
}
export function reviewPlan(f: Finding, projects: Project[], protectedPaths: string[]): ReviewPlan {
  return projectPlan(f, projects.find(p => p.id === f.projectId), protectedPaths);
}
function projectPlan(f: Finding, p: Project | undefined, protectedPaths: string[]): ReviewPlan {
  const e = p?.recoveryEvidence;
  const plan: ReviewPlan = {
    title: 'Verify recovery before making changes', reason: f.reason, action: 'Inspect the folder breakdown and preserve unique files before making a narrower plan.',
    recovery: f.recovery, tradeoff: 'The measured size is not a guaranteed saving on disk.', priority: 2,
    checks: [], directory: p?.path,
  };
  if (isProtected(f, protectedPaths)) return { ...plan, title: f.risk === 'protected' ? 'Preserve this location' : 'Excluded by your preference', action: f.risk === 'protected' ? f.recovery : 'Remove your exclusion only if you want this folder included in review suggestions again.', priority: 4 };
  if (!f.complete) return { ...plan, title: 'Complete the measurement first', action: 'Resolve the coverage warnings and scan this folder again before considering changes.', priority: 4 };
  if (p) {
    plan.checks.push({ label: `Project: ${p.name}${p.contextOnly ? ' (outside the selected scan root)' : ''}`, state: 'found' });
    plan.checks.push({ label: p.lockfiles.length ? `Found ${p.lockfiles.join(', ')}; contents not validated` : 'No recognized lockfile in this project', state: p.lockfiles.length ? 'found' : 'check' });
  }
  if (f.kind === 'gradle-project' && folderName(f.path) === 'build' || f.kind === 'maven-output') {
    const gradle = f.kind === 'gradle-project';
    const windows = /^[a-z]:[/\\]|^\\\\/i.test(f.path);
    const wrapper = gradle ? windows ? 'gradlew.bat' : 'gradlew' : windows ? 'mvnw.cmd' : 'mvnw';
    const tool = gradle ? 'Gradle' : 'Maven';
    plan.title = `Review ${tool} build cleanup`;
    plan.reason = `${folderName(f.path)} is the conventional output folder for ${p?.name ?? 'this project'}. ${e?.wrappers.includes(wrapper) ? `The project includes ${wrapper}.` : 'A compatible project wrapper was not verified.'}`;
    plan.checks.push({ label: e?.wrappers.includes(wrapper) ? `${wrapper} found` : `${wrapper} not verified`, state: e?.wrappers.includes(wrapper) ? 'found' : 'missing' });
    plan.checks.push({ label: 'Check configured output paths, custom clean tasks and any files you need to keep', state: 'check' });
    plan.action = `Review the ${gradle ? 'build scripts and configured buildDirectory' : 'pom.xml clean-plugin configuration and filesets'}. Close running builds. If the outputs are reproducible, use the project’s clean task from its project directory.`;
    plan.recovery = `Run the project’s normal build when you need these outputs again. The scanner has not run or validated that build.`;
    plan.tradeoff = 'The next build must regenerate output. Custom cleanup can affect other modules and paths beyond this finding.';
    plan.documentation = gradle ? 'https://docs.gradle.org/current/userguide/building_java_projects.html' : 'https://maven.apache.org/plugins/maven-clean-plugin/';
    if (p && !p.contextOnly && e?.wrappers.includes(wrapper) && pathKey(f.path) === pathKey(`${p.path}/${gradle ? 'build' : 'target'}`)) {
      plan.command = { label: 'Cleanup command to review', text: `${windows ? '.\\' : './'}${wrapper} clean`, note: 'Deletes configured build output and runs project build logic. Review the scripts and scope first. DevSpace only copies this command.' };
      plan.priority = 0;
    } else plan.checks.push({ label: 'No cleanup command offered without a detected wrapper and a full project scan', state: 'check' });
    return plan;
  }
  if (f.kind === 'node-modules' || f.kind === 'node-output') {
    const managers = new Set<string>((p?.lockfiles ?? []).map(name => name === 'package-lock.json' || name === 'npm-shrinkwrap.json' ? 'npm' : name === 'pnpm-lock.yaml' ? 'pnpm' : name === 'yarn.lock' ? 'yarn' : '').filter(Boolean));
    if (e?.packageManager) managers.add(e.packageManager);
    const manager = managers.size === 1 ? [...managers][0] : null;
    plan.checks.push({ label: e?.nodeManifest === 'parsed' ? 'package.json read successfully' : 'package.json recovery evidence unavailable; rescan or inspect it', state: e?.nodeManifest === 'parsed' ? 'found' : 'missing' });
    plan.checks.push({ label: managers.size > 1 ? 'Conflicting package-manager evidence' : manager ? `Package manager: ${manager}` : 'Package manager not established', state: manager ? 'found' : 'missing' });
    if (e?.localDependencyCount) plan.checks.push({ label: `${e.localDependencyCount} local or non-registry dependencies: ${e.localDependencies.join(', ')}`, state: 'missing' });
    if (e?.patches) plan.checks.push({ label: 'Patch or Yarn configuration detected; preserve project-specific changes', state: 'missing' });
    if (e?.installScripts) plan.checks.push({ label: 'Install lifecycle scripts are declared in package.json', state: 'check' });
    if (p?.workspace) plan.checks.push({ label: 'Workspace project: check shared packages and install from the correct workspace root', state: 'check' });
    const modules = f.kind === 'node-modules';
    plan.title = modules ? 'Check whether this installation is still needed' : 'Verify the project’s rebuild path';
    plan.reason = e?.localDependencyCount ? 'This project depends on local or non-registry packages. A lockfile alone does not establish recovery.' : `${p?.name ?? 'This project'} has ${p?.lockfiles.length ? 'lockfile evidence' : 'no recorded lockfile'}${e?.scripts.includes('build') ? ' and a build script' : ''}. Package availability and manual edits remain unverified.`;
    plan.action = modules ? 'For an inactive project, preserve local packages and manual patches first. Once you have verified reinstall sources, remove only this project’s installed dependencies using your file manager. Keep package.json and the lockfile.' : 'Inspect the build script and output configuration. Preserve custom or tracked files; then remove only the verified generated output.';
    plan.recovery = modules ? 'Reinstall from the project’s lockfile when you resume work. Match its package-manager version and install configuration.' : 'Run the project’s verified build script to regenerate output.';
    plan.tradeoff = 'Reinstallation needs package sources and may run lifecycle scripts. Shared or hardlinked stores can make actual disk savings smaller.';
    plan.documentation = 'https://docs.npmjs.com/cli/v11/commands/npm-ci/';
    const npmLock = p?.lockfiles.some(name => name === 'package-lock.json' || name === 'npm-shrinkwrap.json');
    if (manager === 'npm' && npmLock && e?.nodeManifest === 'parsed' && !e.localDependencyCount && !e.patches && !p?.workspace && !p?.contextOnly) {
      plan.command = modules ? { label: 'Recovery command for later', text: 'npm ci', note: 'Reinstalls dependencies, replacing existing node_modules. Requires matching manifest/lockfile and install options; may run lifecycle scripts. This is not a space-saving command.' } : e.scripts.includes('build') ? { label: 'Recovery command for later', text: 'npm run build', note: 'Runs the project-defined build script. Review that script first; it may write outside this output folder.' } : undefined;
      if (plan.command) plan.priority = 1;
    }
    return plan;
  }
  if (f.kind === 'gradle-project') {
    plan.title = 'Review this project’s Gradle cache';
    plan.action = 'Close this project’s builds and IDE sessions. Inspect the cache for custom files. If you accept losing incremental build state, remove only this project’s .gradle directory using your file manager.';
    plan.recovery = 'Gradle recreates normal project cache state on a later build. Custom files and local state may not be recoverable.';
    plan.tradeoff = 'The next build may be slower. The clean task does not generally clear this project cache.';
  } else if (f.kind === 'python-venv') {
    plan.title = 'Establish a replacement environment first';
    plan.reason = `Project manifests: ${p?.markers.join(', ') || 'not recorded'}. Lockfiles: ${p?.lockfiles.join(', ') || 'none recorded'}. Installed and editable packages have not been inventoried.`;
    plan.action = 'Record the interpreter from pyvenv.cfg and the installed packages. Test a replacement environment from the project’s dependency definition before removing the old environment.';
    plan.recovery = 'Recreate with the recorded interpreter and verified dependency sources, including local/editable packages.';
    plan.tradeoff = 'A lockfile may omit manual installations. Keep the current environment until the replacement works.';
    plan.documentation = 'https://docs.python.org/3/library/venv.html';
  } else if (f.kind === 'python-bytecode' || f.kind === 'python-tool-cache') {
    plan.title = 'Review a regenerable Python cache';
    plan.action = f.kind === 'python-bytecode' ? 'Inspect the file samples and confirm the matching sources are backed up. After stopping running Python jobs, remove only the reviewed cache files.' : 'Check the folder for custom or tracked files. Close the owning tool before removing only its reviewed cache.';
    plan.recovery = f.kind === 'python-bytecode' ? 'Python recreates normal bytecode when matching source modules are imported.' : 'The owning Python tool normally recreates its cache on the next run.';
    plan.tradeoff = 'The next run may take longer while cache entries are regenerated.';
    plan.priority = 1;
  } else if (f.kind === 'gradle-cache' || f.kind === 'gradle-wrapper') {
    plan.title = 'Review Gradle retention and offline requirements';
    plan.reason = f.wrapperVersion ? `Distribution ${f.wrapperVersion}: ${f.wrapperReferences.length} matching project wrappers in this scan. Projects outside the scan remain unknown.` : 'This cache can be shared across projects, including projects outside the scan.';
    plan.action = 'Inspect the largest child folders, then review Gradle User Home cleanup settings in your trusted Gradle configuration. Prefer tool-managed retention over removing the shared cache wholesale.';
    plan.tradeoff = 'Removed dependencies or distributions must be downloaded again. Offline builds can stop working.';
    plan.documentation = 'https://docs.gradle.org/current/userguide/directory_layout.html';
  }
  return plan;
}

export function prioritizedCandidates(report: Report, protectedPaths: string[]): Finding[] {
  const projects = new Map(report.projects.map(p => [p.id, p]));
  const plans = new Map(report.findings.map(f => [f.id, projectPlan(f, projects.get(f.projectId ?? ''), protectedPaths)]));
  return report.findings.filter(f => f.complete && f.logicalBytes > 0 && !isProtected(f, protectedPaths))
    .sort((a, b) => plans.get(a.id)!.priority - plans.get(b.id)!.priority || b.logicalBytes - a.logicalBytes || a.path.localeCompare(b.path));
}
