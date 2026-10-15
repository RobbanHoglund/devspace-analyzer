import { open } from 'node:fs/promises';
import * as path from 'node:path';

export function exportContent(content: unknown, extension: unknown): { content: string; extension: 'json' | 'md' } {
  if (extension !== 'json' && extension !== 'md') throw new Error('Unsupported report format.');
  if (typeof content !== 'string' || Buffer.byteLength(content) > 32 * 1024 * 1024) throw new Error('Report exceeds the 32 MiB export limit. Narrow the scan scope.');
  if (extension === 'json') { try { JSON.parse(content); } catch { throw new Error('Invalid JSON report.'); } }
  return { content, extension };
}
export async function writeNewReport(destination: string, content: string, extension: 'json' | 'md'): Promise<string> {
  if (!path.extname(destination)) destination += `.${extension}`;
  if (path.extname(destination).toLowerCase() !== `.${extension}`) throw new Error(`Choose a .${extension} filename.`);
  // Atomic create: neither an existing file nor a symlink at the destination is overwritten.
  const file = await open(destination, 'wx', 0o600).catch(() => { throw new Error('Report not saved. Choose a new filename; existing files are never overwritten.'); });
  try { await file.writeFile(content, 'utf8'); await file.sync(); }
  catch { throw new Error('Report write failed; the new report may be incomplete.'); }
  finally { await file.close(); }
  return destination;
}
