import type {Report} from './types';
/** Scanner aggregates use the same measured file lengths without child findings.
 * Only subtract safe, consistent integers; never estimate unread/sparse allocation. */
export function unclassifiedMeasuredBytes(report: Report): number | null {
  const measured = report.progress.logicalBytes;
  if (!Number.isSafeInteger(measured) || measured < 0) return null;
  let identified = 0;
  for (const finding of report.findings) {
    if (!Number.isSafeInteger(finding.logicalBytes) || finding.logicalBytes < 0) return null;
    identified += finding.logicalBytes;
    if (!Number.isSafeInteger(identified) || identified > measured) return null;
  }
  return measured - identified;
}
