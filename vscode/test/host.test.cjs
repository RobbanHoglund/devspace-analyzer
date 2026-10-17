const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs/promises');
const callbacks = new Map();
const disposable = { dispose() {} };
const mock = {
  env: {}, workspace: { isTrusted: false, workspaceFolders: [], onDidGrantWorkspaceTrust: () => disposable },
  window: { createTreeView: () => ({ ...disposable, visible: false, selection: [], onDidChangeVisibility: () => disposable, reveal: async () => {} }), showErrorMessage: async () => {} },
  commands: { registerCommand: (name, fn) => { callbacks.set(name, fn); return disposable; }, executeCommand: async () => {} },
  EventEmitter: class { event = () => disposable; fire() {} dispose() {} },
  TreeItem: class { constructor(label) { this.label = label; } }, ThemeIcon: class { constructor(id) { this.id = id; } },
};
const load = Module._load;
Module._load = function (request, ...args) { return request === 'vscode' ? mock : load.call(this, request, ...args); };
const { Analyzer } = require('../dist/vscode/src/extension.js');
Module._load = load;
function make() {
  const state = new Map();
  const memento = { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => { state.set(key, value); } };
  return { analyzer: new Analyzer({ extensionPath: path.resolve(__dirname, '..'), workspaceState: memento, globalState: memento }), state };
}
test('host enforces Restricted Mode and remote-window guards independently of disabled UI', async () => {
  const { analyzer } = make();
  const args = { request: { roots: [os.tmpdir()], includeGlobalCaches: false, protectedPaths: [] } };
  await assert.rejects(analyzer.request('scan', args), /trusted workspace/);
  await assert.rejects(analyzer.request('choose_folders', {}), /trusted workspace/);
  await assert.rejects(analyzer.request('reveal_finding', { id: 'f0' }), /trusted workspace/);
  await assert.rejects(analyzer.request('reveal_storage', { id: 0 }), /trusted workspace/);
  mock.workspace.isTrusted = true; mock.env.remoteName = 'ssh-remote';
  await assert.rejects(analyzer.request('scan', args), /local VS Code window/);
  delete mock.env.remoteName; analyzer.dispose();
});
test('host accepts only supported commands and current native finding IDs', async () => {
  const { analyzer, state } = make(); mock.workspace.isTrusted = true;
  for (const command of ['execute','prepare_cleanup','run_cleanup','cancel_cleanup']) await assert.rejects(analyzer.request(command, { command: 'arbitrary', id: 'forged' }), /Unknown/);
  for (const url of ['file:///private', 'javascript:alert(1)', 'https://example.com', 'https://pnpm.io/cli/store?injected=true']) await assert.rejects(analyzer.request('open_documentation', {url}), /Unsupported/);
  await assert.rejects(analyzer.request('set_view', { tab: 'arbitrary' }), /Unknown/);
  await analyzer.request('set_view', { tab: 'findings' });
  assert.equal(analyzer.getStatus().activeTab, 'findings');
  await assert.rejects(analyzer.request('reveal_finding', { id: 'not-a-native-finding' }), /current scan/);
  await assert.rejects(analyzer.request('reveal_storage', { id: 0 }), /current scan/);
  await assert.rejects(analyzer.request('copy_text', { text: 'x'.repeat(8193) }), /Invalid/);
  await analyzer.request('save_preferences', { roots: [os.tmpdir()], protectedPaths: [], includeCaches: false });
  assert.equal(state.get('scope').includeCaches, false);
  await assert.rejects(analyzer.request('save_preferences', { roots: ['../unsafe'], protectedPaths: [], includeCaches: true }), /absolute/);
  assert.equal(state.get('scope').includeCaches, false); analyzer.dispose();
});
test('complete baselines persist across host restarts while partial scans keep the last complete baseline', async () => {
  const { analyzer, state } = make(); mock.workspace.isTrusted = true;
  const report = { schemaVersion: 2, startedAt: 1, complete: true, cancelled: false, roots: [os.tmpdir()], findings: [], projects: [], progress: { logicalBytes: 100 } };
  analyzer.scanner.scan = async () => report;
  const args = { request: { roots: [os.tmpdir()], includeGlobalCaches: false, protectedPaths: [] } };
  await analyzer.request('scan', args);
  assert.equal(state.get('baseline').logicalBytes, 100);
  const memento = { get: (key, fallback) => state.get(key) ?? fallback, update: async (key, value) => { state.set(key, value); } };
  const reopened = new Analyzer({ extensionPath: path.resolve(__dirname, '..'), workspaceState: memento, globalState: memento });
  assert.equal(reopened.baseline.logicalBytes, 100);
  reopened.scanner.scan = async () => ({ ...report, complete: false, progress: { logicalBytes: 10 } });
  await reopened.request('scan', args);
  assert.equal(reopened.comparisonBaseline.logicalBytes, 100);
  assert.equal(state.get('baseline').logicalBytes, 100);
  analyzer.dispose(); reopened.dispose();
});

test('folder reveal rejects a link inserted into a previously scanned ancestor', async t => {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'devspace-reveal-')));
  t.after(() => fs.rm(root,{recursive:true,force:true}));
  const target=path.join(root,'target'); await fs.mkdir(path.join(target,'cache'),{recursive:true});
  const alias=path.join(root,'alias'); await fs.symlink(target,alias,process.platform==='win32'?'junction':'dir');
  const {analyzer}=make();t.after(()=>analyzer.dispose());mock.workspace.isTrusted=true;
  analyzer.report={findings:[{id:'f0',path:path.join(alias,'cache')}],storage:{directories:[{id:0,path:path.join(alias,'cache')}]}};
  await assert.rejects(analyzer.request('reveal_finding',{id:'f0'}),/contains a link/);
  await assert.rejects(analyzer.request('reveal_storage',{id:0}),/contains a link/);
});
