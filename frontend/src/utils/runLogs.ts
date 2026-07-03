import type { TerminalLog } from '../types';

export function slugifySessionName(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'untitled';
}

function formatLogTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`
  );
}

export function buildNewLogFilename(sessionName: string, date = new Date()): string {
  return `${slugifySessionName(sessionName)}-${formatLogTimestamp(date)}.txt`;
}

export function buildRenamedLogFilename(sessionName: string, currentFile: string): string | null {
  const base = currentFile.split('/').pop() ?? currentFile;
  const match = new RegExp('^(.+)-(\\d{4}-\\d{2}-\\d{2}_\\d{2}-\\d{2}-\\d{2})\\.txt$').exec(base);
  if (!match) return null;

  const next = `${slugifySessionName(sessionName)}-${match[2]}.txt`;
  return next === base ? null : next;
}

export function formatLogsForSave(logs: TerminalLog[]): Array<{ level: string; message: string }> {
  return logs.map((log) => ({
    level: log.level,
    message: log.message,
  }));
}

export async function syncRunLogs(
  name: string,
  logs: TerminalLog[],
  file?: string,
): Promise<{ file: string; path: string; root: string }> {
  const response = await fetch('/api/logs/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name,
      logs: formatLogsForSave(logs),
      file: file?.trim() || undefined,
    }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error?.trim() || 'Could not save logs');
  }

  return (await response.json()) as { file: string; path: string; root: string };
}

export async function renameRunLog(
  from: string,
  to: string,
): Promise<{ file: string; path: string }> {
  const response = await fetch('/api/logs/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to }),
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error?.trim() || 'Could not rename log');
  }

  return (await response.json()) as { file: string; path: string };
}

export function openLogsBrowser(): void {
  window.open('/api/logs/browser', '_blank', 'noopener,noreferrer');
}
