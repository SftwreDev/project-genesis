import type { TerminalSession } from '../types';

export const COLLAGE_COLUMNS = 3;
export const COLLAGE_VISIBLE_ROWS_MAX = 2;
export const COLLAGE_PANE_MIN_HEIGHT = 120;

export type CollageDropTarget = { kind: 'pane'; index: number } | { kind: 'append' };

export function collageGridCols(): number {
  return COLLAGE_COLUMNS;
}

export function collageVisibleRowCount(paneCount: number): number {
  if (paneCount <= 3) return 1;
  return COLLAGE_VISIBLE_ROWS_MAX;
}

export function collageGridSize(count: number): { cols: number; rows: number } {
  const cols = collageGridCols();
  return { cols, rows: Math.max(1, Math.ceil(count / cols)) };
}

export function normalizeCollageSessions(
  ids: string[],
  sessions: TerminalSession[],
): string[] {
  const valid = new Set(sessions.map((session) => session.id));
  const unique: string[] = [];

  for (const id of ids) {
    if (!valid.has(id) || unique.includes(id)) continue;
    unique.push(id);
  }

  return unique;
}

export function pickOtherSessionId(
  sessions: TerminalSession[],
  excludeId: string,
  preferId?: string,
): string | null {
  if (preferId && preferId !== excludeId && sessions.some((session) => session.id === preferId)) {
    return preferId;
  }
  return sessions.find((session) => session.id !== excludeId)?.id ?? null;
}

export function applyCollageDrop(
  sessionId: string,
  target: CollageDropTarget | null,
  collageSessions: string[] | null,
  anchorSessionId: string,
  sessions: TerminalSession[],
): string[] | null {
  if (sessions.length < 2) return null;

  const withoutDragged = (ids: string[]) => ids.filter((id) => id !== sessionId);

  if (!collageSessions || collageSessions.length === 0) {
    const otherId = pickOtherSessionId(sessions, sessionId, anchorSessionId);
    if (!otherId) return null;

    const startIndex = target?.kind === 'pane' ? target.index : 0;
    if (startIndex >= 1) {
      return normalizeCollageSessions([otherId, sessionId], sessions);
    }
    return normalizeCollageSessions([sessionId, otherId], sessions);
  }

  const current = normalizeCollageSessions(collageSessions, sessions);
  const existingIndex = current.indexOf(sessionId);

  if (target?.kind === 'append') {
    if (existingIndex >= 0) return current;
    return normalizeCollageSessions([...current, sessionId], sessions);
  }

  if (target?.kind === 'pane') {
    const index = Math.max(0, Math.min(target.index, current.length - 1));
    const next = withoutDragged(current);

    if (index < next.length) {
      next[index] = sessionId;
      return normalizeCollageSessions(next, sessions);
    }

    return normalizeCollageSessions([...next, sessionId], sessions);
  }

  return current;
}

export function resolveCollageDropTarget(
  clientX: number,
  clientY: number,
  contentEl: HTMLDivElement | null,
  scrollEl: HTMLDivElement | null,
  collageSessions: string[] | null,
  isCollage: boolean,
  rowHeight = COLLAGE_PANE_MIN_HEIGHT,
): CollageDropTarget | null {
  const targetEl = isCollage && scrollEl ? scrollEl : contentEl;
  if (!targetEl) return null;

  const rect = targetEl.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }

  const paneCount = collageSessions?.length ?? 0;
  const cols = isCollage ? COLLAGE_COLUMNS : 2;
  const cellW = rect.width / cols;
  const cellH = isCollage ? rowHeight : rect.height;
  const scrollTop = scrollEl?.scrollTop ?? 0;

  const relX = clientX - rect.left;
  const relY = clientY - rect.top + scrollTop;
  const col = Math.min(cols - 1, Math.max(0, Math.floor(relX / cellW)));
  const row = Math.max(0, Math.floor(relY / cellH));
  const index = row * cols + col;

  if (!isCollage) {
    return { kind: 'pane', index: index >= 1 ? 1 : 0 };
  }

  if (index >= paneCount) {
    return { kind: 'append' };
  }

  return { kind: 'pane', index };
}

export function isDropTargetActive(
  target: CollageDropTarget | null,
  slotIndex: number,
  paneCount: number,
): boolean {
  if (!target) return false;
  if (target.kind === 'append') return slotIndex === paneCount;
  return target.index === slotIndex;
}

export function dropZoneLabel(slotIndex: number, paneCount: number, isCollage: boolean): string {
  if (isCollage && slotIndex >= paneCount) {
    return 'Add pane';
  }
  if (!isCollage && slotIndex === 0) return 'Pin left';
  if (!isCollage && slotIndex === 1) return 'Pin right';
  return `Pane ${slotIndex + 1}`;
}
