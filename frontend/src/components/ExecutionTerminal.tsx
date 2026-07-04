import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Columns2,
  FolderOpen,
  GripHorizontal,
  LayoutGrid,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Search,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { TerminalLog, TerminalSession } from '../types';
import { openLogsBrowser } from '../utils/runLogs';
import {
  COLLAGE_PANE_MIN_HEIGHT,
  collageVisibleRowCount,
  applyCollageDrop,
  collageGridSize,
  dropZoneLabel,
  isDropTargetActive,
  normalizeCollageSessions,
  resolveCollageDropTarget,
  type CollageDropTarget,
} from '../utils/terminalCollage';

type Props = {
  sessions: TerminalSession[];
  activeSessionId: string;
  height: number;
  onActiveSessionChange: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onClearSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  canRenameSession?: (sessionId: string) => boolean;
  onPauseRun?: (sessionId: string) => void;
  onResumeRun?: (sessionId: string) => void;
  onStopRun?: (sessionId: string) => void;
  onToggleSaveLogs: (sessionId: string) => void;
  onHeightChange: (height: number) => void;
};

const MIN_HEIGHT = 120;
const DRAG_THRESHOLD = 6;

const LOG_BADGE: Record<TerminalLog['level'], string> = {
  system: 'SYS',
  run: 'RUN',
  success: 'OK',
  error: 'ERR',
  output: 'OUT',
  warn: 'WARN',
};

type SessionSearch = {
  query: string;
  matchIndex: number;
};

const EMPTY_SEARCH: SessionSearch = { query: '', matchIndex: 0 };

function findMatchingLogIds(logs: TerminalLog[], query: string): string[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const matches: string[] = [];
  for (const log of logs) {
    if (log.message.toLowerCase().includes(needle)) {
      matches.push(log.id);
    }
  }
  return matches;
}

function highlightMessage(message: string, query: string, isActive: boolean): ReactNode {
  const trimmed = query.trim();
  if (!trimmed) return message;

  const needle = trimmed.toLowerCase();
  const lower = message.toLowerCase();
  const parts: ReactNode[] = [];
  let start = 0;
  let index = lower.indexOf(needle, start);

  while (index !== -1) {
    if (index > start) {
      parts.push(message.slice(start, index));
    }
    parts.push(
      <mark
        key={`${index}-${start}`}
        className={isActive ? 'terminal__mark terminal__mark--active' : 'terminal__mark'}
      >
        {message.slice(index, index + trimmed.length)}
      </mark>,
    );
    start = index + trimmed.length;
    index = lower.indexOf(needle, start);
  }

  if (start < message.length) {
    parts.push(message.slice(start));
  }

  return parts.length > 0 ? parts : message;
}

type SaveLogsToggleProps = {
  session: TerminalSession;
  onToggleSaveLogs: (sessionId: string) => void;
  compact?: boolean;
};

function SaveLogsToggle({ session, onToggleSaveLogs, compact = false }: SaveLogsToggleProps) {
  return (
    <label
      className={[
        'terminal__save-toggle',
        session.saveLogsEnabled && 'terminal__save-toggle--active',
        compact && 'terminal__save-toggle--compact',
      ]
        .filter(Boolean)
        .join(' ')}
      title={
        session.saveLogsEnabled
          ? 'Live log capture on — writes to file until turned off or tab closes'
          : 'Capture all terminal logs live to a file'
      }
      onClick={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <span className="terminal__save-toggle-label">Save</span>
      <input
        type="checkbox"
        checked={Boolean(session.saveLogsEnabled)}
        onChange={() => onToggleSaveLogs(session.id)}
      />
      <span className="terminal__save-toggle-track" aria-hidden="true">
        <span className="terminal__save-toggle-thumb" />
      </span>
    </label>
  );
}

type TerminalLogSearchProps = {
  query: string;
  matchIndex: number;
  matchCount: number;
  onQueryChange: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onClear: () => void;
  inputRef?: (element: HTMLInputElement | null) => void;
};

function TerminalLogSearch({
  query,
  matchIndex,
  matchCount,
  onQueryChange,
  onNextMatch,
  onPrevMatch,
  onClear,
  inputRef,
}: TerminalLogSearchProps) {
  return (
    <div className="terminal__search">
      <Search size={12} className="terminal__search-icon" aria-hidden="true" />
      <input
        ref={inputRef}
        type="search"
        className="terminal__search-input"
        placeholder="Find in logs..."
        value={query}
        spellCheck={false}
        autoComplete="off"
        aria-label="Search logs"
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) onPrevMatch();
            else onNextMatch();
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onClear();
          }
        }}
      />
      {query.trim() && (
        <>
          <span className="terminal__search-count" aria-live="polite">
            {matchCount === 0 ? '0/0' : `${matchIndex + 1}/${matchCount}`}
          </span>
          <button
            type="button"
            className="terminal__search-nav"
            title="Previous match (Shift+Enter)"
            aria-label="Previous match"
            onClick={onPrevMatch}
          >
            <ChevronUp size={12} />
          </button>
          <button
            type="button"
            className="terminal__search-nav"
            title="Next match (Enter)"
            aria-label="Next match"
            onClick={onNextMatch}
          >
            <ChevronDown size={12} />
          </button>
          <button
            type="button"
            className="terminal__search-clear"
            title="Clear search (Esc)"
            aria-label="Clear search"
            onClick={onClear}
          >
            <X size={12} />
          </button>
        </>
      )}
    </div>
  );
}

type TerminalLogBodyProps = {
  session: TerminalSession;
  query: string;
  matchIndex: number;
  onQueryChange: (query: string) => void;
  onNextMatch: () => void;
  onPrevMatch: () => void;
  onClearSearch: () => void;
  registerSearchInput?: (element: HTMLInputElement | null) => void;
};

function TerminalLogBody({
  session,
  query,
  matchIndex,
  onQueryChange,
  onNextMatch,
  onPrevMatch,
  onClearSearch,
  registerSearchInput,
}: TerminalLogBodyProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const lineRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const hasSearch = query.trim().length > 0;

  const matchIds = useMemo(() => findMatchingLogIds(session.logs, query), [session.logs, query]);
  const matchSet = useMemo(() => new Set(matchIds), [matchIds]);
  const matchCount = matchIds.length;
  const activeMatchId =
    matchCount > 0 ? matchIds[((matchIndex % matchCount) + matchCount) % matchCount] : null;

  useEffect(() => {
    if (hasSearch) {
      if (activeMatchId) {
        const line = lineRefs.current.get(activeMatchId);
        line?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      return;
    }

    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [activeMatchId, hasSearch, session.logs]);

  useEffect(() => {
    if (hasSearch) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [hasSearch, session.logs]);

  return (
    <div className="terminal__log-view">
      <TerminalLogSearch
        query={query}
        matchIndex={matchIndex}
        matchCount={matchCount}
        onQueryChange={onQueryChange}
        onNextMatch={onNextMatch}
        onPrevMatch={onPrevMatch}
        onClear={onClearSearch}
        inputRef={registerSearchInput}
      />
      <div className="terminal__body" ref={bodyRef}>
        {session.logs.map((log) => {
          const isMatch = matchSet.has(log.id);
          const isActive = log.id === activeMatchId;

          return (
            <div
              key={log.id}
              ref={(element) => {
                if (element) lineRefs.current.set(log.id, element);
                else lineRefs.current.delete(log.id);
              }}
              className={[
                'terminal__line',
                `terminal__line--${log.level}`,
                isMatch && 'terminal__line--match',
                isActive && 'terminal__line--match-active',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <span className="terminal__line-badge">{LOG_BADGE[log.level]}</span>
              <span className="terminal__line-text">
                {isMatch ? highlightMessage(log.message, query, isActive) : log.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

type RenameFieldProps = {
  sessionId: string;
  name: string;
  className?: string;
  renamingSessionId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (sessionId: string) => void;
  onCancelRename: () => void;
  onDoubleClickRename?: (event: React.MouseEvent) => void;
  renameTitle?: string;
};

function RenameField({
  sessionId,
  name,
  className = '',
  renamingSessionId,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onDoubleClickRename,
  renameTitle = 'Double-click to rename',
}: RenameFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const openedAtRef = useRef(0);

  useEffect(() => {
    if (renamingSessionId !== sessionId) return;
    openedAtRef.current = Date.now();
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, [renamingSessionId, sessionId]);

  if (renamingSessionId === sessionId) {
    return (
      <input
        ref={inputRef}
        className={`terminal__rename-input ${className}`.trim()}
        value={renameDraft}
        onChange={(event) => onRenameDraftChange(event.target.value)}
        onBlur={() => {
          window.setTimeout(() => {
            if (Date.now() - openedAtRef.current < 150) return;
            onCommitRename(sessionId);
          }, 0);
        }}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommitRename(sessionId);
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancelRename();
          }
        }}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      />
    );
  }

  return (
    <span
      className={className}
      title={renameTitle}
      onDoubleClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDoubleClickRename?.(event);
      }}
    >
      {name}
    </span>
  );
}

type TerminalPaneProps = {
  session: TerminalSession;
  paneIndex: number;
  isFocused: boolean;
  isDropTarget?: boolean;
  renamingSessionId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (sessionId: string) => void;
  onCancelRename: () => void;
  searchQuery: string;
  searchMatchIndex: number;
  onSearchQueryChange: (query: string) => void;
  onSearchNextMatch: () => void;
  onSearchPrevMatch: () => void;
  onSearchClear: () => void;
  registerSearchInput?: (element: HTMLInputElement | null) => void;
  onFocus?: () => void;
  onClearSession: (sessionId: string) => void;
  onPauseRun?: (sessionId: string) => void;
  onResumeRun?: (sessionId: string) => void;
  onStopRun?: (sessionId: string) => void;
  onToggleSaveLogs: (sessionId: string) => void;
  onSessionRenameStart?: (sessionId: string, name: string, event: React.MouseEvent) => void;
  sessionRenameTitle?: (sessionId: string) => string;
};

function TerminalPane({
  session,
  paneIndex,
  isFocused,
  isDropTarget = false,
  renamingSessionId,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  searchQuery,
  searchMatchIndex,
  onSearchQueryChange,
  onSearchNextMatch,
  onSearchPrevMatch,
  onSearchClear,
  registerSearchInput,
  onFocus,
  onClearSession,
  onPauseRun,
  onResumeRun,
  onStopRun,
  onToggleSaveLogs,
  onSessionRenameStart,
  sessionRenameTitle,
}: TerminalPaneProps) {
  return (
    <div
      key={session.id}
      className={[
        'terminal__pane',
        isFocused && 'terminal__pane--active',
        isDropTarget && 'terminal__pane--drop-target',
      ]
        .filter(Boolean)
        .join(' ')}
      onMouseDown={() => onFocus?.()}
    >
      <div className="terminal__pane-header">
        <span className="terminal__pane-label">Pane {paneIndex + 1}</span>
        <RenameField
          sessionId={session.id}
          name={session.name}
          className="terminal__pane-name"
          renamingSessionId={renamingSessionId}
          renameDraft={renameDraft}
          onRenameDraftChange={onRenameDraftChange}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onDoubleClickRename={(event) => onSessionRenameStart?.(session.id, session.name, event)}
          renameTitle={sessionRenameTitle?.(session.id)}
        />
        <span className={`terminal__tab-status terminal__tab-status--${session.status}`} />
        <div className="terminal__pane-actions">
          <SaveLogsToggle session={session} onToggleSaveLogs={onToggleSaveLogs} compact />
          {(session.status === 'running' || session.status === 'paused') && (
            <div className="terminal__controls">
              {session.status === 'running' ? (
                <button
                  type="button"
                  className="terminal__control terminal__control--pause"
                  onClick={() => onPauseRun?.(session.id)}
                >
                  <Pause size={12} />
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="terminal__control terminal__control--resume"
                  onClick={() => onResumeRun?.(session.id)}
                >
                  <Play size={12} />
                  Resume
                </button>
              )}
              <button
                type="button"
                className="terminal__control terminal__control--stop"
                onClick={() => onStopRun?.(session.id)}
              >
                <Square size={12} />
                Stop
              </button>
            </div>
          )}
          <button type="button" className="terminal__clear" onClick={() => onClearSession(session.id)}>
            <Trash2 size={12} />
            Clear
          </button>
        </div>
      </div>
      <TerminalLogBody
        session={session}
        query={searchQuery}
        matchIndex={searchMatchIndex}
        onQueryChange={onSearchQueryChange}
        onNextMatch={onSearchNextMatch}
        onPrevMatch={onSearchPrevMatch}
        onClearSearch={onSearchClear}
        registerSearchInput={registerSearchInput}
      />
    </div>
  );
}

export default function ExecutionTerminal({
  sessions,
  activeSessionId,
  height,
  onActiveSessionChange,
  onCloseSession,
  onClearSession,
  onRenameSession,
  canRenameSession,
  onPauseRun,
  onResumeRun,
  onStopRun,
  onToggleSaveLogs,
  onHeightChange,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  const panesScrollRef = useRef<HTMLDivElement>(null);
  const heightDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(height);
  const pendingTabDrag = useRef<{ sessionId: string; x: number; y: number } | null>(null);
  const tabDragged = useRef(false);
  const dragAnchorSessionIdRef = useRef(activeSessionId);
  const maxHeight = Math.round(window.innerHeight * 0.65);
  const [collageSessions, setCollageSessions] = useState<string[] | null>(null);
  const [focusedPaneIndex, setFocusedPaneIndex] = useState(0);
  const [tabDrag, setTabDrag] = useState<{ sessionId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<CollageDropTarget | null>(null);
  const [ghostPosition, setGhostPosition] = useState({ x: 0, y: 0 });
  const [maximized, setMaximized] = useState(false);
  const restoredHeightRef = useRef(height);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [searchBySession, setSearchBySession] = useState<Record<string, SessionSearch>>({});
  const [collageRowHeight, setCollageRowHeight] = useState(COLLAGE_PANE_MIN_HEIGHT);
  const pendingTabClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchInputRefs = useRef<Map<string, HTMLInputElement>>(new Map());

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[sessions.length - 1];

  const collagePaneSessions = useMemo(() => {
    if (!collageSessions || collageSessions.length < 2) return [];
    return collageSessions
      .map((sessionId) => sessions.find((session) => session.id === sessionId) ?? null)
      .filter((session): session is TerminalSession => session !== null);
  }, [collageSessions, sessions]);

  const showCollage = collagePaneSessions.length >= 2;
  const collageGrid = useMemo(
    () => collageGridSize(showCollage ? collagePaneSessions.length : 2),
    [collagePaneSessions.length, showCollage],
  );
  const collageVisibleRows = useMemo(
    () => collageVisibleRowCount(showCollage ? collagePaneSessions.length : 1),
    [collagePaneSessions.length, showCollage],
  );

  useEffect(() => {
    if (!showCollage) return;

    const el = panesScrollRef.current;
    if (!el) return;

    const updateRowHeight = () => {
      const next = Math.max(
        COLLAGE_PANE_MIN_HEIGHT,
        Math.floor(el.clientHeight / collageVisibleRows),
      );
      setCollageRowHeight(next);
      el.style.setProperty('--collage-row-height', `${next}px`);
    };

    updateRowHeight();
    const observer = new ResizeObserver(updateRowHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [collageVisibleRows, height, maximized, showCollage]);

  useEffect(() => {
    if (!maximized) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMaximized(false);
        onHeightChange(restoredHeightRef.current);
      }
    };

    document.body.classList.add('terminal-maximized');
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.classList.remove('terminal-maximized');
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [maximized, onHeightChange]);

  useEffect(() => {
    if (!collageSessions) return;

    if (sessions.length < 2) {
      setCollageSessions(null);
      return;
    }

    const normalized = normalizeCollageSessions(collageSessions, sessions);
    if (normalized.length < 2) {
      setCollageSessions(null);
      return;
    }

    if (
      normalized.length !== collageSessions.length ||
      normalized.some((sessionId, index) => sessionId !== collageSessions[index])
    ) {
      setCollageSessions(normalized);
    }
  }, [collageSessions, sessions]);

  useEffect(() => {
    if (!showCollage) return;
    setFocusedPaneIndex((current) => Math.min(current, collagePaneSessions.length - 1));
  }, [collagePaneSessions.length, showCollage]);

  const getSessionSearch = useCallback(
    (sessionId: string): SessionSearch => searchBySession[sessionId] ?? EMPTY_SEARCH,
    [searchBySession],
  );

  const setSessionSearchQuery = useCallback((sessionId: string, query: string) => {
    setSearchBySession((current) => ({
      ...current,
      [sessionId]: { query, matchIndex: 0 },
    }));
  }, []);

  const clearSessionSearch = useCallback((sessionId: string) => {
    setSearchBySession((current) => ({
      ...current,
      [sessionId]: EMPTY_SEARCH,
    }));
  }, []);

  const stepSessionSearchMatch = useCallback(
    (sessionId: string, direction: 1 | -1) => {
      setSearchBySession((current) => {
        const state = current[sessionId] ?? EMPTY_SEARCH;
        const session = sessions.find((item) => item.id === sessionId);
        const matches = findMatchingLogIds(session?.logs ?? [], state.query);
        if (matches.length === 0) return current;

        const nextIndex = (state.matchIndex + direction + matches.length) % matches.length;
        return {
          ...current,
          [sessionId]: { ...state, matchIndex: nextIndex },
        };
      });
    },
    [sessions],
  );

  const registerSearchInput = useCallback((sessionId: string, element: HTMLInputElement | null) => {
    if (element) searchInputRefs.current.set(sessionId, element);
    else searchInputRefs.current.delete(sessionId);
  }, []);

  const focusSessionSearch = useCallback(
    (sessionId: string) => {
      const input = searchInputRefs.current.get(sessionId);
      if (!input) return;
      input.focus();
      input.select();
    },
    [],
  );

  const startRename = useCallback((sessionId: string, name: string) => {
    pendingTabDrag.current = null;
    tabDragged.current = false;
    setRenamingSessionId(sessionId);
    setRenameDraft(name);
  }, []);

  useEffect(
    () => () => {
      if (pendingTabClickRef.current) clearTimeout(pendingTabClickRef.current);
    },
    [],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'f') return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;

      event.preventDefault();
      if (showCollage && collageSessions) {
        const focusedSessionId = collageSessions[focusedPaneIndex] ?? collageSessions[0];
        if (focusedSessionId) {
          focusSessionSearch(focusedSessionId);
        }
        return;
      }
      focusSessionSearch(activeSessionId);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeSessionId, collageSessions, focusSessionSearch, focusedPaneIndex, showCollage]);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (heightDragging.current) {
        const delta = startY.current - event.clientY;
        const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, startHeight.current + delta));
        onHeightChange(next);
        return;
      }

      if (pendingTabDrag.current && !tabDrag) {
        const dx = event.clientX - pendingTabDrag.current.x;
        const dy = event.clientY - pendingTabDrag.current.y;
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        if (sessions.length < 2) {
          pendingTabDrag.current = null;
          return;
        }

        tabDragged.current = true;
        setTabDrag({ sessionId: pendingTabDrag.current.sessionId });
        setGhostPosition({ x: event.clientX, y: event.clientY });
        pendingTabDrag.current = null;
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
      }

      if (!tabDrag) return;

      setGhostPosition({ x: event.clientX, y: event.clientY });
      setDropTarget(
          resolveCollageDropTarget(
          event.clientX,
          event.clientY,
          contentRef.current,
          panesScrollRef.current,
          collageSessions,
          showCollage,
          collageRowHeight,
        ),
      );
    },
    [collageRowHeight, collageSessions, maxHeight, onHeightChange, sessions.length, showCollage, tabDrag],
  );

  const onMouseUp = useCallback(() => {
    if (tabDrag && dropTarget) {
      const nextCollage = applyCollageDrop(
        tabDrag.sessionId,
        dropTarget,
        collageSessions,
        dragAnchorSessionIdRef.current,
        sessions,
      );
      if (nextCollage) {
        setCollageSessions(nextCollage);
        const nextIndex =
          dropTarget.kind === 'pane'
            ? Math.min(dropTarget.index, nextCollage.length - 1)
            : nextCollage.length - 1;
        setFocusedPaneIndex(nextIndex);
        onActiveSessionChange(tabDrag.sessionId);
      }
    }

    heightDragging.current = false;
    pendingTabDrag.current = null;
    setTabDrag(null);
    setDropTarget(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [collageSessions, dropTarget, onActiveSessionChange, sessions, tabDrag]);

  useEffect(() => {
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [onMouseMove, onMouseUp]);

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    heightDragging.current = true;
    startY.current = event.clientY;
    startHeight.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  const startTabDrag = (sessionId: string, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    if (renamingSessionId) return;
    if ((event.target as HTMLElement).closest('.terminal__rename-input')) return;
    if ((event.target as HTMLElement).closest('.terminal__tab-close')) return;
    if ((event.target as HTMLElement).closest('.terminal__session-rail-close')) return;

    dragAnchorSessionIdRef.current = activeSessionId;
    pendingTabDrag.current = { sessionId, x: event.clientX, y: event.clientY };
    tabDragged.current = false;
  };

  const handleTabClick = (sessionId: string) => {
    if (renamingSessionId) return;
    if (tabDragged.current) {
      tabDragged.current = false;
      return;
    }

    if (showCollage && collageSessions) {
      const paneIndex = collageSessions.indexOf(sessionId);
      if (paneIndex >= 0) {
        setFocusedPaneIndex(paneIndex);
        onActiveSessionChange(sessionId);
        return;
      }

      setCollageSessions((current) => {
        if (!current) return current;
        const next = [...current];
        const replaceIndex = Math.min(focusedPaneIndex, next.length - 1);
        next[replaceIndex] = sessionId;
        return normalizeCollageSessions(next, sessions);
      });
      onActiveSessionChange(sessionId);
      return;
    }

    onActiveSessionChange(sessionId);
  };

  const cancelPendingTabClick = () => {
    if (!pendingTabClickRef.current) return;
    clearTimeout(pendingTabClickRef.current);
    pendingTabClickRef.current = null;
  };

  const scheduleTabClick = (sessionId: string) => {
    cancelPendingTabClick();
    pendingTabClickRef.current = setTimeout(() => {
      pendingTabClickRef.current = null;
      handleTabClick(sessionId);
    }, 250);
  };

  const handleTabRename = (sessionId: string, name: string, event: React.MouseEvent) => {
    handleRenameStart(sessionId, name, event);
  };

  const commitRename = (sessionId: string) => {
    const trimmed = renameDraft.trim();
    if (trimmed) {
      onRenameSession(sessionId, trimmed);
    }
    setRenamingSessionId(null);
    setRenameDraft('');
  };

  const cancelRename = () => {
    setRenamingSessionId(null);
  };

  const renameDisabledTitle = 'Rename disabled while node is in a workflow group';

  const handleRenameStart = (sessionId: string, name: string, event: React.MouseEvent) => {
    if (canRenameSession && !canRenameSession(sessionId)) return;
    cancelPendingTabClick();
    event.preventDefault();
    event.stopPropagation();
    startRename(sessionId, name);
  };

  const renameFieldProps = {
    renamingSessionId,
    renameDraft,
    onRenameDraftChange: setRenameDraft,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
  };

  const sessionRenameTitle = (sessionId: string) =>
    canRenameSession && !canRenameSession(sessionId)
      ? renameDisabledTitle
      : 'Double-click to rename';

  const collapseCollage = () => {
    setCollageSessions(null);
    setFocusedPaneIndex(0);
  };

  const openCollageGrid = () => {
    if (sessions.length < 2) return;
    const next = normalizeCollageSessions(
      sessions.map((session) => session.id),
      sessions,
    );
    if (next.length < 2) return;
    setCollageSessions(next);
    setFocusedPaneIndex(0);
    onActiveSessionChange(next[0]);
  };

  const toggleMaximize = () => {
    setMaximized((current) => {
      if (current) {
        onHeightChange(restoredHeightRef.current);
        return false;
      }
      restoredHeightRef.current = height;
      return true;
    });
  };

  const renderDropOverlay = (paneCount: number, isCollageView: boolean) => {
    const slotCount = isCollageView ? paneCount + 1 : 2;
    const grid = collageGridSize(slotCount);

    return (
      <div
        className="terminal__drop-overlay"
        style={{
          ['--collage-cols' as string]: grid.cols,
          ['--collage-rows' as string]: grid.rows,
          ['--collage-row-height' as string]: `${collageRowHeight}px`,
          minHeight: isCollageView ? grid.rows * collageRowHeight : undefined,
        }}
        aria-hidden="true"
      >
        {Array.from({ length: slotCount }, (_, slotIndex) => (
          <div
            key={`drop-${slotIndex}`}
            className={[
              'terminal__drop-zone',
              isDropTargetActive(dropTarget, slotIndex, paneCount) && 'terminal__drop-zone--active',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span>{dropZoneLabel(slotIndex, paneCount, isCollageView)}</span>
          </div>
        ))}
      </div>
    );
  };

  const draggedSession = tabDrag ? sessions.find((session) => session.id === tabDrag.sessionId) : null;

  if (!activeSession) return null;

  const searchPropsFor = (sessionId: string) => {
    const search = getSessionSearch(sessionId);
    return {
      searchQuery: search.query,
      searchMatchIndex: search.matchIndex,
      onSearchQueryChange: (query: string) => setSessionSearchQuery(sessionId, query),
      onSearchNextMatch: () => stepSessionSearchMatch(sessionId, 1),
      onSearchPrevMatch: () => stepSessionSearchMatch(sessionId, -1),
      onSearchClear: () => clearSessionSearch(sessionId),
      registerSearchInput: (element: HTMLInputElement | null) => registerSearchInput(sessionId, element),
    };
  };

  const activeSearch = searchPropsFor(activeSession.id);

  const renderTab = (session: TerminalSession) => {
    const collageIndex = showCollage ? collageSessions?.indexOf(session.id) ?? -1 : -1;
    const isActive = session.id === activeSessionId;

    return (
      <div
        key={session.id}
        role="tab"
        tabIndex={0}
        aria-selected={isActive}
        className={[
          'terminal__tab',
          isActive && 'terminal__tab--active',
          tabDrag?.sessionId === session.id && 'terminal__tab--dragging',
          collageIndex >= 0 && 'terminal__tab--in-collage',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(event) => startTabDrag(session.id, event)}
        onClick={() => scheduleTabClick(session.id)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('.terminal__tab-close')) return;
          handleTabRename(session.id, session.name, event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleTabClick(session.id);
          }
        }}
        title={
          canRenameSession && !canRenameSession(session.id)
            ? renameDisabledTitle
            : 'Double-click tab name to rename. Drag tab into grid pane. Cmd/Ctrl+F search logs.'
        }
      >
        <RenameField
          sessionId={session.id}
          name={session.name}
          className="terminal__tab-name"
          {...renameFieldProps}
          onDoubleClickRename={(event) => handleTabRename(session.id, session.name, event)}
          renameTitle={sessionRenameTitle(session.id)}
        />
        {collageIndex >= 0 && <span className="terminal__tab-pin">{collageIndex + 1}</span>}
        <span className={`terminal__tab-status terminal__tab-status--${session.status}`} />
        {sessions.length > 1 && (
          <button
            type="button"
            className="terminal__tab-close"
            title="Close terminal"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCloseSession(session.id);
            }}
          >
            <X size={11} />
          </button>
        )}
      </div>
    );
  };

  const renderRailItem = (session: TerminalSession, options?: { collageIndex?: number }) => {
    const isActive = session.id === activeSessionId;

    return (
      <div
        key={session.id}
        role="button"
        tabIndex={0}
        className={[
          'terminal__session-rail-item',
          options?.collageIndex !== undefined && 'terminal__session-rail-item--pinned',
          isActive && 'terminal__session-rail-item--active',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(event) => startTabDrag(session.id, event)}
        onClick={() => scheduleTabClick(session.id)}
        onDoubleClick={(event) => {
          if ((event.target as HTMLElement).closest('.terminal__session-rail-close')) return;
          handleTabRename(session.id, session.name, event);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleTabClick(session.id);
          }
        }}
      >
        {options?.collageIndex !== undefined && (
          <span className="terminal__session-rail-pin">{options.collageIndex + 1}</span>
        )}
        <RenameField
          sessionId={session.id}
          name={session.name}
          className="terminal__session-rail-name"
          {...renameFieldProps}
          onDoubleClickRename={(event) => handleTabRename(session.id, session.name, event)}
          renameTitle={sessionRenameTitle(session.id)}
        />
        <span className={`terminal__tab-status terminal__tab-status--${session.status}`} />
        {sessions.length > 1 && (
          <button
            type="button"
            className="terminal__session-rail-close"
            title="Close terminal"
            aria-label={`Close ${session.name}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCloseSession(session.id);
            }}
          >
            <X size={12} strokeWidth={2.25} />
          </button>
        )}
      </div>
    );
  };

  return (
    <section
      className={[
        'terminal',
        showCollage && 'terminal--collage',
        tabDrag && 'terminal--dragging',
        maximized && 'terminal--maximized',
      ]
        .filter(Boolean)
        .join(' ')}
      style={maximized ? undefined : { height }}
    >
      {!maximized && (
        <div
          className="terminal__resize"
          onMouseDown={startResize}
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal"
        >
          <GripHorizontal size={14} />
        </div>
      )}
      <header className="terminal__header">
        <div className="terminal__tabs" role="tablist">
          {sessions.map((session) => renderTab(session))}
        </div>
        <div className="terminal__header-actions">
          {!showCollage && (activeSession.status === 'running' || activeSession.status === 'paused') && (
            <div className="terminal__controls">
              {activeSession.status === 'running' ? (
                <button
                  type="button"
                  className="terminal__control terminal__control--pause"
                  onClick={() => onPauseRun?.(activeSession.id)}
                >
                  <Pause size={14} />
                  Pause
                </button>
              ) : (
                <button
                  type="button"
                  className="terminal__control terminal__control--resume"
                  onClick={() => onResumeRun?.(activeSession.id)}
                >
                  <Play size={14} />
                  Resume
                </button>
              )}
              <button
                type="button"
                className="terminal__control terminal__control--stop"
                onClick={() => onStopRun?.(activeSession.id)}
              >
                <Square size={14} />
                Stop
              </button>
            </div>
          )}
          {!showCollage && (
            <SaveLogsToggle session={activeSession} onToggleSaveLogs={onToggleSaveLogs} />
          )}
          {!showCollage && (
            <button type="button" className="terminal__clear" onClick={() => onClearSession(activeSession.id)}>
              <Trash2 size={14} />
              Clear
            </button>
          )}
          <button
            type="button"
            className="terminal__split-toggle"
            onClick={openLogsBrowser}
            title="Open saved log files"
          >
            <FolderOpen size={14} />
            Logs
          </button>
          {sessions.length >= 2 && !showCollage && (
            <button
              type="button"
              className="terminal__split-toggle"
              onClick={openCollageGrid}
              title="Show all terminals in a scrollable grid"
            >
              <LayoutGrid size={14} />
              Grid
            </button>
          )}
          {showCollage && (
            <button
              type="button"
              className="terminal__split-toggle terminal__split-toggle--active"
              onClick={collapseCollage}
              title="Merge back to single terminal"
            >
              <Columns2 size={14} />
              Merge
            </button>
          )}
          <button
            type="button"
            className={`terminal__split-toggle${maximized ? ' terminal__split-toggle--active' : ''}`}
            onClick={toggleMaximize}
            title={maximized ? 'Restore terminal size (Esc)' : 'Maximize terminal'}
            aria-pressed={maximized}
          >
            {maximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            {maximized ? 'Minimize' : 'Maximize'}
          </button>
        </div>
      </header>

      <div className="terminal__body-row">
        <div className="terminal__content" ref={contentRef}>
          {showCollage ? (
            <div className="terminal__panes-scroll" ref={panesScrollRef}>
              <div
                className="terminal__panes"
                style={{
                  ['--collage-cols' as string]: collageGrid.cols,
                  ['--collage-rows' as string]: collageGrid.rows,
                  ['--collage-row-height' as string]: `${collageRowHeight}px`,
                  minHeight: collageGrid.rows * collageRowHeight,
                }}
              >
                {tabDrag && renderDropOverlay(collagePaneSessions.length, true)}
                {collagePaneSessions.map((session, index) => (
                  <TerminalPane
                    key={session.id}
                    session={session}
                    paneIndex={index}
                    isFocused={focusedPaneIndex === index}
                    isDropTarget={Boolean(
                      tabDrag &&
                        dropTarget?.kind === 'pane' &&
                        dropTarget.index === index,
                    )}
                    {...renameFieldProps}
                    {...searchPropsFor(session.id)}
                    onFocus={() => {
                      setFocusedPaneIndex(index);
                      onActiveSessionChange(session.id);
                    }}
                    onClearSession={onClearSession}
                    onPauseRun={onPauseRun}
                    onResumeRun={onResumeRun}
                    onStopRun={onStopRun}
                    onToggleSaveLogs={onToggleSaveLogs}
                    onSessionRenameStart={handleTabRename}
                    sessionRenameTitle={sessionRenameTitle}
                  />
                ))}
              </div>
            </div>
          ) : (
            <div className="terminal__single-view terminal__body--single">
              <TerminalLogBody
                session={activeSession}
                query={activeSearch.searchQuery}
                matchIndex={activeSearch.searchMatchIndex}
                onQueryChange={activeSearch.onSearchQueryChange}
                onNextMatch={activeSearch.onSearchNextMatch}
                onPrevMatch={activeSearch.onSearchPrevMatch}
                onClearSearch={activeSearch.onSearchClear}
                registerSearchInput={activeSearch.registerSearchInput}
              />
              {tabDrag && renderDropOverlay(0, false)}
            </div>
          )}
        </div>

        <aside className="terminal__session-rail" aria-label="Terminal sessions">
          {showCollage && collagePaneSessions.length > 0 && (
            <div className="terminal__session-rail-group">
              <span className="terminal__session-rail-group-label">Grid</span>
              {collagePaneSessions.map((session, index) =>
                renderRailItem(session, { collageIndex: index }),
              )}
            </div>
          )}
          <div className="terminal__session-rail-list">
            {sessions
              .filter(
                (session) =>
                  !showCollage || !collageSessions?.includes(session.id),
              )
              .map((session) => renderRailItem(session))}
          </div>
        </aside>
      </div>

      {tabDrag && draggedSession && (
        <div
          className="terminal__tab-ghost"
          style={{ transform: `translate(calc(${ghostPosition.x}px - 50%), calc(${ghostPosition.y}px - 50%))` }}
        >
          {draggedSession.name}
        </div>
      )}
    </section>
  );
}
