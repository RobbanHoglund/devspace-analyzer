import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { record } from './protocol';
import { pathsOverlap } from '../../src/analysis';
import type { Report } from '../../src/types';
import type { CleanupAction, CleanupOutcome, CleanupPlan } from '../../src/cleanupTypes';

const actions = new Set(['npm-verify', 'npm-clean', 'pnpm-prune', 'pip-purge']);
export function cleanupRequest(report: Report | undefined, id: unknown, action: unknown, protectedPaths: string[]) {
  if (typeof action !== 'string' || !actions.has(action)) throw new Error('Unsupported cleanup action.');
  if (!report || !report.complete || report.cancelled) throw new Error('Complete a native scan before preparing cleanup.');
  const finding = report.findings.find(f => f.id === id);
  if (!finding) throw new Error('Finding is not in the current scan.');
  const kind = action.startsWith('npm-') ? 'npm-cache' : action === 'pnpm-prune' ? 'pnpm-store' : 'pip-cache';
  const cache = report.globalCaches.find(c => c.kind === kind && pathsOverlap(c.path, finding.path));
  if (!cache || report.projects.some(p => pathsOverlap(p.path, cache.path))) throw new Error('No isolated cache matches this finding.');
  // Rust rechecks exact cache identity, protection and the entire target tree.
  return { action: action as CleanupAction, finding, cache, protectedPaths: [...protectedPaths] };
}
type Waiter<T> = { resolve(value: T): void; reject(error: Error): void };
export class Cleanup {
  private child?: ChildProcessWithoutNullStreams;
  private plan?: CleanupPlan;
  private preparing?: Waiter<CleanupPlan>;
  private executing?: Waiter<CleanupOutcome>;
  private failure?: Error;
  get running(): boolean { return !!this.child; }
  constructor(private readonly binary: string, private readonly cwd: string, private readonly log: (text: string) => void) {}
  prepare(request: ReturnType<typeof cleanupRequest>): Promise<CleanupPlan> {
    if (this.child) return Promise.reject(new Error('A cleanup session is already open.'));
    this.failure = undefined; this.plan = undefined;
    return new Promise((resolve, reject) => {
      this.preparing = { resolve, reject };
      const child = spawn(this.binary, ['--cleanup'], { cwd: this.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let buffer = ''; const decoder = new StringDecoder('utf8'); let result: CleanupOutcome | undefined;
      const fail = (error: Error) => { this.failure ??= error; child.stdin.end(); };
      child.on('error', error => { this.failure = new Error(`Could not start cleanup: ${error.message}`); });
      child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
      child.stdout.on('data', (chunk: Buffer) => {
        buffer += decoder.write(chunk);
        if (Buffer.byteLength(buffer) > 2 * 1024 * 1024) { fail(new Error('Cleanup response exceeded its limit.')); return; }
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, index); buffer = buffer.slice(index + 1);
          try {
            const event: unknown = JSON.parse(line);
            if (!record(event) || result) throw new Error('Unexpected cleanup response.');
            if (event.type === 'plan' && this.preparing && validPlan(event.data)) {
              this.plan = event.data; this.preparing.resolve(event.data); this.preparing = undefined;
            } else if (event.type === 'log' && this.executing && typeof event.data === 'string' && event.data.length < 8192) this.log(event.data);
            else if (event.type === 'result' && this.executing && validResult(event.data)) result = event.data;
            else if (event.type === 'error' && typeof event.message === 'string') this.failure = new Error(event.message);
            else throw new Error('Invalid cleanup response.');
          } catch (error) { fail(error instanceof Error ? error : new Error('Invalid cleanup response.')); }
        }
      });
      child.on('close', code => {
        if (this.child === child) this.child = undefined;
        buffer += decoder.end();
        const error = this.failure ?? new Error('Cleanup ended before completing. Prepare a new preview.');
        this.preparing?.reject(error); this.preparing = undefined;
        if (!this.failure && code === 0 && !buffer.trim() && result) this.executing?.resolve(result);
        else this.executing?.reject(error);
        this.executing = undefined; this.plan = undefined; this.failure = error;
      });
      child.stdin.write(JSON.stringify({ protocolVersion: 1, request }) + '\n');
    });
  }
  run(id: unknown): Promise<CleanupOutcome> {
    if (!this.child || !this.plan || this.plan.id !== id || this.executing) return Promise.reject(this.failure ?? new Error('Prepare and review the current cleanup plan first.'));
    const child = this.child; this.plan = undefined;
    return new Promise((resolve, reject) => { this.executing = { resolve, reject }; child.stdin.write(JSON.stringify({ command: 'run', id }) + '\n'); });
  }
  cancel(): Promise<void> {
    const child = this.child; if (!child) return Promise.resolve();
    return new Promise(resolve => { child.once('close', () => resolve()); child.stdin.write('{"command":"cancel"}\n'); });
  }
  dispose(): void { this.child?.stdin.end(); }
}
function validPlan(value: unknown): value is CleanupPlan {
  return record(value) && ['id','title','toolVersion','cachePath','targetPath','executable','command','shell'].every(k => typeof value[k] === 'string')
    && actions.has(value.action as string) && [value.beforeBytes, value.beforeFiles].every(v => Number.isSafeInteger(v) && (v as number) >= 0)
    && ['arguments','effects'].every(k => Array.isArray(value[k]) && (value[k] as unknown[]).every(v => typeof v === 'string'));
}
function validResult(value: unknown): value is CleanupOutcome {
  return record(value) && ['succeeded','failed','cancelled','timed-out'].includes(value.status as string)
    && Number.isSafeInteger(value.beforeBytes) && (value.afterBytes === null || Number.isSafeInteger(value.afterBytes))
    && (value.exitCode === null || Number.isInteger(value.exitCode)) && (value.measurementError === null || typeof value.measurementError === 'string') && typeof value.log === 'string';
}
