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
  mock.workspace.isTrusted = true; mock.env.remoteName = 'ssh-remote';
  await assert.rejects(analyzer.request('scan', args), /local VS Code window/);
  delete mock.env.remoteName; analyzer.dispose();
});
test('host accepts only supported commands and current native finding IDs', async () => {
  const { analyzer, state } = make(); mock.workspace.isTrusted = true;
  await assert.rejects(analyzer.request('execute', { command: 'arbitrary' }), /Unknown/);
  await assert.rejects(analyzer.request('set_view', { tab: 'arbitrary' }), /Unknown/);
  await analyzer.request('set_view', { tab: 'findings' });
  assert.equal(analyzer.getStatus().activeTab, 'findings');
  await assert.rejects(analyzer.request('reveal_finding', { id: 'not-a-native-finding' }), /current scan/);
  await analyzer.request('save_preferences', { roots: [os.tmpdir()], protectedPaths: [], includeCaches: false });
  assert.equal(state.get('scope').includeCaches, false);
  await assert.rejects(analyzer.request('save_preferences', { roots: ['../unsafe'], protectedPaths: [], includeCaches: true }), /absolute/);
  assert.equal(state.get('scope').includeCaches, false); analyzer.dispose();
});
