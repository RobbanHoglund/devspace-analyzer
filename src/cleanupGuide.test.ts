import { describe, expect, it } from 'vitest';
import { cacheCommand, guidanceActions, guidanceBlocked } from './cleanupGuide';
import { demoReport } from './demo';

function fixture() {
  const report = demoReport();
  const finding = { ...report.findings[0], path: 'C:/Cache/npm/_cacache', kind: 'npm-cache', risk: 'review' as const, complete: true, userProtected: false, protectedDescendantCount: 0, protectedDescendants: [], projectId: null };
  report.findings = [finding]; report.projects = [];
  report.globalCaches = [{ path: 'C:/Cache/npm', kind: 'npm-cache', ecosystem: 'Node', source: 'fixture' }];
  return { finding, report };
}
describe('copy-only cache guidance', () => {
  it('scopes npm to the configured root and handles PowerShell apostrophes and extended paths', () => {
    const command = cacheCommand('npm-clean', "\\\\?\\C:\\Robert's cache\\npm")!;
    expect(command.shell).toBe('PowerShell');
    expect(command.text).toBe("npm.cmd '--cache=C:\\Robert''s cache\\npm' --logs-max=0 cache clean --force");
    expect(command.check).toContain('config get cache');
  });
  it('quotes POSIX shell substitutions as literal path text', () => {
    const command = cacheCommand('pip-purge', "/home/robert/a'b;$(touch injected)")!;
    expect(command.text).toBe("python3 -m pip '--cache-dir=/home/robert/a'\"'\"'b;$(touch injected)' cache purge");
    expect(command.check).toContain('cache dir');
    expect(cacheCommand('pnpm-prune','/home/robert/store')!.text).toBe("pnpm '--store-dir=/home/robert/store' store prune");
  });
  it('withholds commands for ambiguous and control-character paths', () => {
    for (const path of ['relative','/','C:/','C:/cache/../other','C:/cache&other','C:/cache%HOME%','/cache\ncommand','\\\\server\\share']) expect(cacheCommand('npm-clean',path)).toBeNull();
  });
  it('requires an exact cache finding, not a descendant or another npm directory', () => {
    const {finding,report}=fixture();
    expect(guidanceActions(finding,report)).toEqual(['npm-verify','npm-clean']);
    for (const suffix of ['_logs','_npx','_cacache/content-v2']) expect(guidanceActions({...finding,path:`C:/Cache/npm/${suffix}`},report)).toEqual([]);
  });
  it('withholds cleanup text when the full command scope overlaps protected or project data', () => {
    const {finding,report}=fixture();
    expect(guidanceBlocked(finding,report,[])).toBe('');
    expect(guidanceBlocked(finding,report,['C:/Cache/npm/_logs'])).toContain('protected');
    report.projects=[{...demoReport().projects[0],path:'C:/Cache/npm/custom-project'}];
    expect(guidanceBlocked(finding,report,[])).toContain('project');
  });
  it('a complete cache can have guidance in a partial report; an incomplete or protected cache cannot', () => {
    const {finding,report}=fixture();report.complete=false;
    expect(guidanceBlocked(finding,report,[])).toBe('');
    expect(guidanceBlocked({...finding,complete:false},report,[])).toContain('partly measured');
    expect(guidanceBlocked({...finding,risk:'protected'},report,[])).toContain('protected');
  });
});
