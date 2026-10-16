import * as vscode from 'vscode';
import * as path from 'node:path';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { lstat } from 'node:fs/promises';
import { Scanner } from './scanner';
import { paths, record, scanRequest } from './protocol';
import { exportContent, writeNewReport } from './export';
import type { Report } from '../../src/types';
import type { ScanScope } from '../../src/scanScope';
import { makeSnapshot, readSnapshot, type ScanSnapshot } from '../../src/scanComparison';

type Tab = 'overview' | 'storage' | 'findings' | 'projects' | 'coverage';
type Action = { tab?: Tab; scanRoots?: string[]; cancel?: boolean; availability?: string };
type Preferences = { roots: string[]; protectedPaths: string[]; includeCaches: boolean };
const tabs: [Tab, string, string][] = [['overview', 'Overview', 'dashboard'], ['storage', 'Storage', 'database'], ['findings', 'Findings', 'list-unordered'], ['projects', 'Projects', 'folder'], ['coverage', 'Scan coverage', 'shield']];

function unavailable(): string {
  if (vscode.env.remoteName) return 'This first release scans local folders in a local VS Code window. Open a local window to use DevSpace.';
  if (!vscode.workspace.isTrusted) return 'Filesystem scanning requires a trusted workspace. You can explore the demo in Restricted Mode.';
  return '';
}
function requireLocal(): void { const reason = unavailable(); if (reason) throw new Error(reason); }
function escapeAttribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

class Navigation implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.change.event;
  description = 'Choose a folder to begin';
  readonly views = new Map(tabs.map(([id, label, icon]) => {
    const item = new vscode.TreeItem(label); item.id = id; item.iconPath = new vscode.ThemeIcon(icon);
    item.command = { command: `devspace.${id}`, title: label }; return [id, item];
  }));
  refresh(): void { this.change.fire(); }
  dispose(): void { this.change.dispose(); }
  getTreeItem(item: vscode.TreeItem): vscode.TreeItem { return item; }
  getParent(): undefined { return undefined; }
  getChildren(): vscode.TreeItem[] {
    const scan = new vscode.TreeItem('Scan workspace'); scan.iconPath = new vscode.ThemeIcon('search');
    scan.command = { command: 'devspace.scanWorkspace', title: 'Scan workspace' };
    const folder = new vscode.TreeItem('Choose folder to scan…'); folder.iconPath = new vscode.ThemeIcon('folder-opened');
    folder.command = { command: 'devspace.scanFolder', title: 'Choose folder to scan' };
    const status = new vscode.TreeItem(this.description); status.iconPath = new vscode.ThemeIcon('info');
    status.tooltip = 'All reported sizes are logical bytes, not guaranteed recoverable disk space.';
    return [...this.views.values(), scan, folder, status];
  }
}

export class Analyzer implements vscode.Disposable {
  private panel?: vscode.WebviewPanel;
  private ready = false;
  private pending?: Action;
  private report?: Report;
  private reportScope?: ScanScope;
  private baseline: ScanSnapshot | null = null;
  private comparisonBaseline: ScanSnapshot | null = null;
  private readonly scanner: Scanner;
  private readonly navigation = new Navigation();
  private readonly tree: vscode.TreeView<vscode.TreeItem>;
  private activeTab: Tab = 'overview';
  private readonly disposables: vscode.Disposable[] = [];
  private preferences: Preferences;
  private preferenceWrite: Promise<void> = Promise.resolve();

  constructor(private readonly context: vscode.ExtensionContext) {
    this.baseline = readSnapshot(context.workspaceState.get('baseline'));
    const roots = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath).slice(0, 32) ?? [];
    const saved = context.workspaceState.get<{ roots: string[]; includeCaches: boolean }>('scope');
    this.preferences = { roots: saved?.roots ?? roots, includeCaches: saved?.includeCaches ?? false, protectedPaths: context.globalState.get<string[]>('protectedPaths', []) };
    const binary = path.join(context.extensionPath, 'bin', process.platform === 'win32' ? 'devspace-scan.exe' : 'devspace-scan');
    this.scanner = new Scanner(binary, context.extensionPath);
    this.tree = vscode.window.createTreeView('devspace.navigation', { treeDataProvider: this.navigation });
    this.disposables.push(this.tree, this.tree.onDidChangeVisibility(() => this.syncView()));
    this.disposables.push(vscode.workspace.onDidGrantWorkspaceTrust(() => this.event('host-action', { availability: unavailable() })));
    this.register('devspace.open', () => this.show());
    for (const [tab] of tabs) this.register(`devspace.${tab}`, () => this.action({ tab }));
    this.register('devspace.scanWorkspace', async () => {
      requireLocal();
      if (this.scanner.running) throw new Error('A scan is already running.');
      const roots = vscode.workspace.workspaceFolders?.filter(f => f.uri.scheme === 'file').map(f => f.uri.fsPath) ?? [];
      if (roots.length) this.action({ scanRoots: paths(roots, 32) });
      else await this.scanFolder();
    });
    this.register('devspace.scanFolder', (uri?: vscode.Uri) => this.scanFolder(uri));
    this.register('devspace.cancel', () => { this.scanner.cancel(); this.event('host-action', { cancel: true }); });
  }
  private register(name: string, callback: (...args: any[]) => unknown): void {
    this.disposables.push(vscode.commands.registerCommand(name, async (...args: any[]) => {
      try { return await callback(...args); }
      catch (error) { await vscode.window.showErrorMessage(error instanceof Error ? error.message : String(error)); }
    }));
  }
  private async folders(): Promise<string[] | null> {
    requireLocal();
    const selected = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, canSelectMany: true, openLabel: 'Choose scan folders', title: 'DevSpace: choose developer folders' });
    if (!selected) return null;
    if (selected.some(uri => uri.scheme !== 'file')) throw new Error('Choose local folders.');
    return paths(selected.map(uri => uri.fsPath), 32);
  }
  private async scanFolder(uri?: vscode.Uri): Promise<void> {
    requireLocal();
    if (this.scanner.running) throw new Error('A scan is already running.');
    if (uri && uri.scheme !== 'file') throw new Error('Choose a local folder.');
    const selected = uri ? paths([uri.fsPath], 32) : await this.folders();
    if (selected?.length) this.action({ scanRoots: selected });
  }
  private action(action: Action): void {
    const existed = !!this.panel; this.show();
    if (existed && this.ready) this.event('host-action', action);
    else this.pending = action;
  }
  show(): void {
    if (this.panel) { this.panel.reveal(); return; }
    const media = vscode.Uri.joinPath(this.context.extensionUri, 'media');
    const panel = vscode.window.createWebviewPanel('devspace.analyzer', 'DevSpace Analyzer', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [media], enableCommandUris: false,
    });
    this.panel = panel; this.ready = false;
    const nonce = randomBytes(24).toString('base64');
    const script = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'assets', 'index.js'));
    const style = panel.webview.asWebviewUri(vscode.Uri.joinPath(media, 'assets', 'index.css'));
    const bootstrap = JSON.stringify({ ...this.preferences, report: this.report, reportScope: this.reportScope, baseline: this.baseline, comparisonBaseline: this.comparisonBaseline, unavailable: unavailable() }).replace(/</g, '\\u003c');
    panel.webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${panel.webview.cspSource} data:; style-src ${panel.webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${panel.webview.cspSource}; connect-src 'none';"><title>DevSpace Analyzer</title><link rel="stylesheet" href="${escapeAttribute(style.toString())}"></head><body><div id="root"></div><script type="application/json" id="devspace-bootstrap">${bootstrap}</script><script nonce="${nonce}" type="module" src="${escapeAttribute(script.toString())}"></script></body></html>`;
    const active = new Set<number>();
    const messages = panel.webview.onDidReceiveMessage(async (message: unknown) => {
      if (!record(message) || message.type !== 'request' || !Number.isSafeInteger(message.id) || typeof message.command !== 'string' || !record(message.args)) return;
      const id = message.id as number;
      if (active.has(id)) return;
      if (active.size >= 64) { void panel.webview.postMessage({ type: 'response', id, error: 'Too many pending requests.' }); return; }
      active.add(id);
      try { const result = await this.request(message.command, message.args); if (this.panel === panel) await panel.webview.postMessage({ type: 'response', id, result }); }
      catch (error) { if (this.panel === panel) await panel.webview.postMessage({ type: 'response', id, error: error instanceof Error ? error.message : String(error) }); }
      finally { active.delete(id); }
    });
    panel.onDidDispose(() => {
      messages.dispose(); if (this.panel === panel) { this.panel = undefined; this.ready = false; this.pending = undefined; this.scanner.dispose(); }
    });
  }
  private event(name: string, payload: unknown): void { if (this.panel) void this.panel.webview.postMessage({ type: 'event', name, payload }); }
  private syncView(): void {
    const item = this.navigation.views.get(this.activeTab);
    if (item && this.tree.visible) void this.tree.reveal(item, { select: true, focus: false }).then(undefined, () => {});
  }
  private async request(command: string, args: Record<string, unknown>): Promise<unknown> {
    switch (command) {
      case 'ready': {
        this.ready = true; const action = this.pending; this.pending = undefined;
        if (action) this.event('host-action', action); return null;
      }
      case 'set_view': {
        if (!tabs.some(([tab]) => tab === args.tab)) throw new Error('Unknown DevSpace view.');
        this.activeTab = args.tab as Tab; this.syncView(); return null;
      }
      case 'choose_folders': return this.folders();
      case 'save_preferences': {
        if (typeof args.includeCaches !== 'boolean') throw new Error('Invalid scan preferences.');
        this.preferences = { roots: paths(args.roots, 32), protectedPaths: paths(args.protectedPaths, 20000), includeCaches: args.includeCaches };
        const saved = this.preferences;
        // Serialize memento writes so a slow prior update cannot restore stale choices.
        this.preferenceWrite = this.preferenceWrite.catch(() => {}).then(async () => {
          await this.context.workspaceState.update('scope', { roots: saved.roots, includeCaches: saved.includeCaches });
          await this.context.globalState.update('protectedPaths', saved.protectedPaths);
        });
        await this.preferenceWrite; return null;
      }
      case 'scan': {
        requireLocal(); const request = scanRequest(args.request);
        if (this.scanner.running) throw new Error('A scan is already running.');
        this.navigation.description = 'Scanning…'; this.navigation.refresh();
        void vscode.commands.executeCommand('setContext', 'devspace.scanning', true);
        try {
          const result = await this.scanner.scan(request, progress => this.event('scan-progress', progress));
          this.comparisonBaseline = this.baseline;
          this.report = result; this.reportScope = { roots: request.roots, includeCaches: request.includeGlobalCaches };
          const snapshot = makeSnapshot(result, this.reportScope);
          if (snapshot) {
            this.baseline = snapshot;
            await this.context.workspaceState.update('baseline', snapshot).then(undefined, () => vscode.window.showWarningMessage('The scan completed, but its comparison baseline could not be saved for the next session.'));
          }
          this.navigation.description = `${result.cancelled ? 'Cancelled' : result.complete ? 'Complete' : 'Partial'} · ${result.findings.length} findings · ${result.projects.length} projects`;
          return result;
        } catch (error) { this.navigation.description = this.report ? 'Scan failed · previous report retained' : 'Scan failed'; throw error; }
        finally { void vscode.commands.executeCommand('setContext', 'devspace.scanning', false); this.navigation.refresh(); }
      }
      case 'copy_text': {
        if (typeof args.text !== 'string' || args.text.length > 8192) throw new Error('Invalid clipboard text.');
        await vscode.env.clipboard.writeText(args.text); return null;
      }
      case 'reveal_storage': {
        requireLocal(); if (this.scanner.running) throw new Error('Wait for the scan to finish.');
        const directory = this.report?.storage?.directories.find(d => d.id === args.id);
        if (!directory) throw new Error('Folder is not in the current scan.');
        let cursor = directory.path;
        for (;;) {
          const stat = await lstat(cursor);
          if (stat.isSymbolicLink()) throw new Error('This location now contains a link. Scan again before opening it.');
          const parent = path.dirname(cursor); if (parent === cursor) break; cursor = parent;
        }
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(directory.path)); return null;
      }
      case 'cancel_scan': this.scanner.cancel(); return null;
      case 'reveal_finding': {
        requireLocal(); if (this.scanner.running) throw new Error('Wait for the scan to finish.');
        const finding = this.report?.findings.find(f => f.id === args.id);
        if (!finding) throw new Error('Finding is not in the current scan.');
        const stat = await lstat(finding.path);
        if (stat.isSymbolicLink()) throw new Error('This location is now a link. Scan again before opening it.');
        await vscode.commands.executeCommand('revealFileInOS', vscode.Uri.file(finding.path)); return null;
      }
      case 'save_export': {
        const { content, extension } = exportContent(args.content, args.extension);
        const destination = await vscode.window.showSaveDialog({ title: 'Export a new DevSpace report', defaultUri: vscode.Uri.file(path.join(homedir(), `devspace-report.${extension}`)), filters: { 'DevSpace report': [extension] } });
        if (!destination) return null;
        if (destination.scheme !== 'file') throw new Error('Choose a local filename.');
        return writeNewReport(destination.fsPath, content, extension);
      }
      default: throw new Error('Unknown DevSpace command.');
    }
  }
  /** Non-sensitive lifecycle status for consumers and integration checks. Reports stay in memory. */
  getStatus() { return { ready: this.ready, scanning: this.scanner.running, findings: this.report?.findings.length, projects: this.report?.projects.length, complete: this.report?.complete, activeTab: this.activeTab, selectedTab: this.tree.selection[0]?.id }; }
  dispose(): void { this.panel?.dispose(); this.scanner.dispose(); this.navigation.dispose(); this.disposables.forEach(item => item.dispose()); }
}

let analyzer: Analyzer | undefined;
export function activate(context: vscode.ExtensionContext) {
  analyzer = new Analyzer(context); context.subscriptions.push(analyzer);
  return { getStatus: () => analyzer!.getStatus() };
}
export function deactivate(): void { analyzer?.dispose(); analyzer = undefined; }
