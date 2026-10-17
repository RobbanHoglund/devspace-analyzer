export type CleanupAction = 'npm-verify' | 'npm-clean' | 'pnpm-prune' | 'pip-purge';
export interface CleanupPlan {
  id: string; action: CleanupAction; title: string; toolVersion: string; cachePath: string; targetPath: string;
  executable: string; arguments: string[]; command: string; shell: string; beforeBytes: number; beforeFiles: number; effects: string[];
}
export interface CleanupOutcome {
  status: 'succeeded' | 'failed' | 'cancelled' | 'timed-out'; exitCode: number | null;
  beforeBytes: number; afterBytes: number | null; measurementError: string | null; log: string;
}
