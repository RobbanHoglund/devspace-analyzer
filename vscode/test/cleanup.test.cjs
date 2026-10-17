const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '../..');
const name = process.platform === 'win32' ? 'devspace-scan.exe' : 'devspace-scan';
const binary = existsSync(path.join(root, 'vscode/bin', name)) ? path.join(root, 'vscode/bin', name) : path.join(root, 'target/debug', name);

async function fixture(t, kind = 'npm-cache') {
  const dir = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'devspace-cleanup-test-')));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home'); await fs.mkdir(home);
  const cache = path.join(dir, "cache space & quote' ;"); await fs.mkdir(cache);
  const config = path.join(home, 'npmrc'); await fs.writeFile(config, '');
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(npm_config_|pip_|node_options|pythonpath)/i.test(key)));
  Object.assign(env, { HOME: home, USERPROFILE: home, npm_config_userconfig: config });
  env[kind === 'npm-cache' ? 'npm_config_cache' : kind === 'pnpm-store' ? 'npm_config_store_dir' : 'PIP_CACHE_DIR'] = cache;
  const target = kind === 'npm-cache' ? path.join(cache, '_cacache') : cache;
  await fs.mkdir(target, { recursive: true });
  const scan = session(env, false); t.after(() => scan.child.stdin.end());
  scan.send({ protocolVersion: 1, request: { roots: [cache], includeGlobalCaches: false, protectedPaths: [] } });
  const report = (await scan.next('report')).data;
  await scan.closed;
  assert.equal(report.complete, true, JSON.stringify(report.warnings));
  const finding = report.findings.find(f => f.kind === kind);
  assert.ok(finding, JSON.stringify(report));
  const location = report.globalCaches.find(c => c.kind === kind);
  const request = action => ({ action, finding, cache: location, protectedPaths: [] });
  return { dir, home, cache, target, env, request };
}
function session(env, cleanup = true) {
  const child = spawn(binary, cleanup ? ['--cleanup'] : [], { env, cwd: root, shell: false, windowsHide: true, stdio: ['pipe','pipe','pipe'] });
  let buffer = ''; const events = []; const waiters = [];
  child.stdout.setEncoding('utf8'); child.stderr.resume(); child.stdin.on('error', () => {});
  child.stdout.on('data', text => {
    buffer += text;
    let i;
    while ((i = buffer.indexOf('\n')) >= 0) {
      const event = JSON.parse(buffer.slice(0,i)); buffer = buffer.slice(i+1);
      const waiter = waiters.find(w => w.type === event.type || event.type === 'error');
      if (waiter) { waiters.splice(waiters.indexOf(waiter),1); clearTimeout(waiter.timer); event.type === 'error' && waiter.type !== 'error' ? waiter.reject(new Error(event.message)) : waiter.resolve(event); }
      else events.push(event);
    }
  });
  const closed = new Promise(resolve => child.once('close', resolve));
  return { child, closed, send(value) { child.stdin.write(JSON.stringify(value)+'\n'); }, next(type) {
    const i = events.findIndex(e => e.type === type || e.type === 'error');
    if (i >= 0) { const event=events.splice(i,1)[0]; return event.type === 'error' && type !== 'error' ? Promise.reject(new Error(event.message)) : Promise.resolve(event); }
    return new Promise((resolve,reject) => { const waiter = { type,resolve,reject,timer:setTimeout(() => { child.stdin.end(); reject(new Error(`Timed out waiting for ${type}`)); },30000) }; waiters.push(waiter); });
  } };
}
async function prepare(t, f, action, edit) {
  const s = session(f.env); t.after(() => s.child.stdin.end());
  const request = f.request(action); edit?.(request);
  s.send({ protocolVersion:1, request });
  return { s, plan: (await s.next('plan')).data };
}
test('npm preview and cancellation leave cache content unchanged; a wrong token cannot execute', async t => {
  const f = await fixture(t); const file = path.join(f.target,'content'); await fs.writeFile(file,'keep');
  const { s,plan } = await prepare(t,f,'npm-clean');
  assert.equal(plan.beforeBytes,4); assert.ok(plan.command.includes('--cache='));
  assert.equal(await fs.readFile(file,'utf8'),'keep');
  s.send({command:'run',id:'not-the-plan'});
  assert.match((await s.next('error')).message,/current plan ID/); await s.closed;
  assert.equal(await fs.readFile(file,'utf8'),'keep');
  const again=await prepare(t,f,'npm-clean'); again.s.send({command:'cancel'}); await again.s.closed;
  assert.equal(await fs.readFile(file,'utf8'),'keep');
});
test('npm clean uses an exact argv cache target and measures it; npx, logs and adjacent data survive', async t => {
  const f = await fixture(t); await fs.writeFile(path.join(f.target,'content'),'cache-data');
  for (const name of ['_npx','_logs']) { await fs.mkdir(path.join(f.cache,name)); await fs.writeFile(path.join(f.cache,name,'keep'),'keep'); }
  await fs.writeFile(path.join(f.dir,'keep'),'outside');
  const {s,plan}=await prepare(t,f,'npm-clean'); s.send({command:'run',id:plan.id});
  const result=(await s.next('result')).data; await s.closed;
  assert.equal(result.status,'succeeded',result.log); assert.equal(result.beforeBytes,10); assert.equal(result.afterBytes,0);
  for (const name of ['_npx','_logs']) assert.equal(await fs.readFile(path.join(f.cache,name,'keep'),'utf8'),'keep');
  assert.equal(await fs.readFile(path.join(f.dir,'keep'),'utf8'),'outside');
});
test('npm verify is an explicit mutating action with a measured result', async t => {
  const f=await fixture(t); const {s,plan}=await prepare(t,f,'npm-verify');
  assert.ok(plan.effects.some(s=>s.includes('not a dry run')));
  s.send({command:'run',id:plan.id}); const result=(await s.next('result')).data; await s.closed;
  assert.equal(result.status,'succeeded',result.log); assert.equal(typeof result.afterBytes,'number');
});
test('changed cache contents and new links invalidate a reviewed plan', async t => {
  const f=await fixture(t); const {s,plan}=await prepare(t,f,'npm-clean');
  await fs.writeFile(path.join(f.target,'new-data'),'new'); s.send({command:'run',id:plan.id});
  assert.match((await s.next('error')).message,/changed since/); await s.closed;
  const second=await prepare(t,f,'npm-clean');
  await fs.symlink(f.home,path.join(f.target,'link'),process.platform === 'win32' ? 'junction' : 'dir');
  second.s.send({command:'run',id:second.plan.id});
  assert.match((await second.s.next('error')).message,/link|protected/); await second.s.closed;
  assert.equal(await fs.readFile(path.join(f.target,'new-data'),'utf8'),'new');
});
test('backend rejects protected paths and partial findings before invoking maintenance', async t => {
  const f=await fixture(t);
  await assert.rejects(prepare(t,f,'npm-clean',r=>{r.protectedPaths=[path.join(f.target,'not-created')];}),/protected/);
  await assert.rejects(prepare(t,f,'npm-clean',r=>{r.finding.complete=false;}),/complete/);
});
test('pip purges only a disposable explicitly selected cache', async t => {
  const f=await fixture(t,'pip-cache'); await fs.mkdir(path.join(f.target,'wheels'));
  await fs.writeFile(path.join(f.target,'wheels','fixture-1.0-py3-none-any.whl'),'cached-wheel'); await fs.writeFile(path.join(f.dir,'keep'),'outside');
  const {s,plan}=await prepare(t,f,'pip-purge'); s.send({command:'run',id:plan.id});
  const result=(await s.next('result')).data; await s.closed;
  assert.equal(result.status,'succeeded',result.log); assert.equal(result.afterBytes,0);
  assert.equal(await fs.readFile(path.join(f.dir,'keep'),'utf8'),'outside');
});
test('pnpm binds its versioned store and preserves other store versions', async t => {
  const f=await fixture(t,'pnpm-store');
  await fs.mkdir(path.join(f.target,'v10','files','00'),{recursive:true}); await fs.mkdir(path.join(f.target,'v10','index'));
  await fs.writeFile(path.join(f.target,'v10','files','00','fixture'),'unreferenced');
  await fs.mkdir(path.join(f.target,'v3')); await fs.writeFile(path.join(f.target,'v3','keep'),'old-store');
  const {s,plan}=await prepare(t,f,'pnpm-prune');
  assert.match(plan.targetPath,/[\\/]v10$/); s.send({command:'run',id:plan.id});
  const result=(await s.next('result')).data; await s.closed;
  assert.equal(result.status,'succeeded',result.log); assert.equal(result.afterBytes,0);
  assert.equal(await fs.readFile(path.join(f.target,'v3','keep'),'utf8'),'old-store');
});
