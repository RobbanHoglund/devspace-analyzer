import { demoReport } from '../src/demo';
import type { Report, StorageDirectory } from '../src/types';

export function storageMapReport(): Report {
  const mib = 1024 ** 2;
  const report = demoReport(), root = 'C:/Workspace';
  const data: [number | null, string, number, number][] = [[null, root, 100, 90], [0, `${root}/build`, 60, 60], [0, `${root}/node_modules`, 30, 30], [0, `${root}/src`, 4, 0], [0, `${root}/docs`, 3, 0], [0, `${root}/assets`, 2, 0], [1, `${root}/build/classes`, 40, 40], [1, `${root}/build/reports`, 20, 20]];
  const directories: StorageDirectory[] = data.map(([parentId, path, size, classified], id) => ({ id, parentId, path, logicalBytes: size * mib, classifiedBytes: classified * mib, directClassifiedBytes: classified * mib, directFileBytes: size * mib, directFiles: 2, files: 2, complete: true, omittedDirectories: 0, largestFiles: [{ name: 'output.bin', logicalBytes: size * mib * .75 }] }));
  directories[0] = { ...directories[0], files: 14, directFileBytes: mib, directClassifiedBytes: 0, largestFiles: [{ name: 'README.md', logicalBytes: mib / 2 }] };
  directories[1] = { ...directories[1], files: 4, directFileBytes: 0, directClassifiedBytes: 0, directFiles: 0, largestFiles: [] };
  const findings = [{ ...report.findings[6], path: `${root}/build`, logicalBytes: 60 * mib, files: 4 }, { ...report.findings[1], path: `${root}/node_modules`, projectId: 'p0', logicalBytes: 30 * mib, files: 2 }];
  const projects = [{ ...report.projects[0], name: 'Workspace', path: root, ecosystems: ['Gradle', 'Node'], ownedLogicalBytes: 100 * mib, artifactBytes: 90 * mib }];
  return { ...report, findings, projects, roots: [root], globalCaches: [], complete: true, warningCount: 0, warnings: [], storage: { directories, truncated: false }, progress: { ...report.progress, files: 14, directories: directories.length, projects: 1, logicalBytes: 100 * mib } };
}
