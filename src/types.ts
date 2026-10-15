export type Risk = 'low' | 'review' | 'protected';
export interface Progress { files: number; directories: number; logicalBytes: number; projects: number; currentPath: string }
export interface Finding {
  id: string; path: string; label: string; ecosystem: string; kind: string; risk: Risk; confidence: string;
  logicalBytes: number; files: number; latestModified: number | null; projectId: string | null;
  evidence: string[]; reason: string; recovery: string; caveats: string[]; complete: boolean;
  userProtected: boolean; wrapperVersion: string | null; wrapperReferences: string[];
  protectedDescendants?: { path: string; label: string }[]; protectedDescendantCount?: number;
}
export interface Project {
  id: string; name: string; path: string; ecosystems: string[]; markers: string[]; lockfiles: string[];
  gitKind: string | null; branch: string | null; wrapperVersion: string | null; workspace: boolean;
  ownedLogicalBytes: number; artifactBytes: number;
  contextOnly?: boolean;
}
export interface Report {
  schemaVersion: number; startedAt: number; durationMs: number; roots: string[];
  globalCaches: { path: string; ecosystem: string; kind: string; source: string }[];
  findings: Finding[]; projects: Project[]; progress: Progress;
  warnings: { path: string; code: string; message: string }[]; warningCount: number;
  complete: boolean; cancelled: boolean; sizeBasis: string; limitations: string[];
}
