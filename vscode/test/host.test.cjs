const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const os = require('node:os');
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
  await assert.rejects(analyzer.request('prepare_cleanup', { id: 'f0', action: 'npm-clean' }), /trusted workspace/);
  await assert.rejects(analyzer.request('run_cleanup', { id: 'forged' }), /trusted workspace/);
  mock.workspace.isTrusted = true; mock.env.remoteName = 'ssh-remote';
  await assert.rejects(analyzer.request('scan', args), /local VS Code window/);
  await assert.rejects(analyzer.request('prepare_cleanup', { id: 'f0', action: 'npm-clean' }), /local VS Code window/);
  delete mock.env.remoteName; analyzer.dispose();
});
test('cleanup uses native findings, current protection, and excludes overlapping scan sessions', async () => {
  const { analyzer } = make(); mock.workspace.isTrusted = true;
  await assert.rejects(analyzer.request('run_cleanup', { id:'unreviewed' }), /Prepare and review/);
  const cache=path.join(os.tmpdir(),'cache'); const finding={id:'f0',path:path.join(cache,'_cacache'),kind:'npm-cache'};
  analyzer.report={complete:true,cancelled:false,findings:[finding],projects:[],globalCaches:[{path:cache,kind:'npm-cache'}]};
  let calls=0;
  analyzer.cleanup.prepare=async request=>{calls++;assert.deepEqual(request.protectedPaths,[cache]);return 'plan';};
  await analyzer.request('save_preferences',{roots:[],protectedPaths:[cache],includeCaches:false});
  await assert.rejects(analyzer.request('prepare_cleanup',{id:'f0',expectedPath:'wrong',action:'npm-clean'}),/changed/);
  await assert.rejects(analyzer.request('prepare_cleanup',{id:'f0',expectedPath:finding.path,action:'arbitrary'}),/Unsupported/);
  analyzer.report.complete=false;
  await assert.rejects(analyzer.request('prepare_cleanup',{id:'f0',expectedPath:finding.path,action:'npm-clean'}),/Complete/);
  analyzer.report.complete=true;
  await analyzer.request('prepare_cleanup',{id:'f0',expectedPath:finding.path,action:'npm-clean'}); assert.equal(calls,1);
  Object.defineProperty(analyzer.cleanup,'running',{get:()=>true});
  await assert.rejects(analyzer.request('scan',{request:{roots:[os.tmpdir()],includeGlobalCaches:false,protectedPaths:[]}}),/Finish/);
  await assert.rejects(analyzer.request('save_preferences',{roots:[],protectedPaths:[],includeCaches:false}),/Finish cleanup/);
  analyzer.dispose();
});
test('host accepts only supported commands and current native finding IDs', async () => {
  const { analyzer, state } = make(); mock.workspace.isTrusted = true;
  await assert.rejects(analyzer.request('execute', { command: 'arbitrary' }), /Unknown/);
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
