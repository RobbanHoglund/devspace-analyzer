import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { isProgress, isReport, record, scanRequest, type ScanRequest } from './protocol';
import type { Progress, Report } from '../../src/types';

const MAX_RECORD = 64 * 1024 * 1024;
/** The only executable is the scanner shipped inside this extension. No shell or workspace executable. */
export class Scanner {
  private child?: ChildProcessWithoutNullStreams;
  private forceTimer?: NodeJS.Timeout;
  get running(): boolean { return !!this.child; }
  constructor(private readonly binary: string, private readonly cwd: string) {}

  scan(input: ScanRequest, progress: (value: Progress) => void): Promise<Report> {
    if (this.child) return Promise.reject(new Error('A scan is already running.'));
    const request = scanRequest(input);
    return new Promise((resolve, reject) => {
      const child = spawn(this.binary, [], { cwd: this.cwd, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      this.child = child;
      let buffer = ''; let recordBytes = 0; let report: Report | undefined; let failure: Error | undefined;
      const decoder = new StringDecoder('utf8');
      const fail = (error: Error) => { failure ??= error; child.kill(); };
      child.on('error', error => { failure = new Error(`Could not start the bundled scanner: ${error.message}`); });
      child.stdin.on('error', () => { /* Exit/error handler supplies the useful diagnostic. */ });
      child.stderr.on('data', () => { /* Drain diagnostics without logging private filesystem paths. */ });
      child.stdout.on('data', (chunk: Buffer) => {
        if (failure) return;
        recordBytes += chunk.length;
        if (recordBytes > MAX_RECORD) { fail(new Error('Scanner report exceeds 64 MiB. Narrow the scan scope.')); return; }
        buffer += decoder.write(chunk);
        let boundary: number;
        while ((boundary = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 1);
          recordBytes = Buffer.byteLength(buffer);
          try {
            const event: unknown = JSON.parse(line);
            if (!record(event) || report) throw new Error('Unexpected scanner response.');
            if (event.type === 'progress' && isProgress(event.data)) progress(event.data);
            else if (event.type === 'report' && isReport(event.data)) report = event.data;
            else if (event.type === 'error' && typeof event.message === 'string') failure = new Error(event.message);
            else throw new Error('Invalid scanner response.');
          } catch (error) { fail(error instanceof Error ? error : new Error('Invalid scanner response.')); return; }
        }
      });
      child.on('close', (code, signal) => {
        if (this.child === child) this.child = undefined;
        clearTimeout(this.forceTimer); this.forceTimer = undefined;
        buffer += decoder.end();
        if (failure) reject(failure);
        else if (code !== 0 || signal || buffer.trim() || !report) reject(new Error('Scanner stopped before completing a report. The previous report is retained.'));
        else resolve(report);
      });
      child.stdin.write(JSON.stringify({ protocolVersion: 1, request }) + '\n');
    });
  }
  cancel(): void {
    if (!this.child || this.forceTimer) return;
    const child = this.child;
    child.stdin.write('{"command":"cancel"}\n');
    this.forceTimer = setTimeout(() => child.kill(), 5000);
    this.forceTimer.unref();
  }
  dispose(): void { clearTimeout(this.forceTimer); this.child?.kill(); }
}
