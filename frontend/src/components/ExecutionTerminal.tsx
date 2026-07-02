import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Columns2,
  GripHorizontal,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Square,
  Trash2,
  X,
} from 'lucide-react';
import type { TerminalLog, TerminalSession } from '../types';

type Props = {
  sessions: TerminalSession[];
  activeSessionId: string;
  height: number;
  onActiveSessionChange: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onClearSession: (sessionId: string) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onPauseRun?: (sessionId: string) => void;
  onResumeRun?: (sessionId: string) => void;
  onStopRun?: (sessionId: string) => void;
  onHeightChange: (height: number) => void;
};

type SplitPanes = { left: string; right: string };
type DropTarget = 'left' | 'right';

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

function pickOtherSessionId(sessions: TerminalSession[], excludeId: string, preferId?: string) {
  if (preferId && preferId !== excludeId && sessions.some((session) => session.id === preferId)) {
    return preferId;
  }
  return sessions.find((session) => session.id !== excludeId)?.id ?? null;
}

function applySplitDrop(
  sessionId: string,
  target: DropTarget,
  splitPanes: SplitPanes | null,
  anchorSessionId: string,
  sessions: TerminalSession[],
): SplitPanes | null {
  if (sessions.length < 2) return null;

  if (!splitPanes) {
    const otherId = pickOtherSessionId(sessions, sessionId, anchorSessionId);
    if (!otherId) return null;
    return target === 'left'
      ? { left: sessionId, right: otherId }
      : { left: otherId, right: sessionId };
  }

  const { left, right } = splitPanes;
  if (target === 'left') {
    if (sessionId === right) return { left: sessionId, right: left };
    if (sessionId === left) return splitPanes;
    return { left: sessionId, right };
  }

  if (sessionId === left) return { left: right, right: sessionId };
  if (sessionId === right) return splitPanes;
  return { left, right: sessionId };
}

function resolveDropTarget(clientX: number, clientY: number, contentEl: HTMLDivElement | null): DropTarget | null {
  if (!contentEl) return null;

  const rect = contentEl.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
    return null;
  }

  return clientX - rect.left < rect.width / 2 ? 'left' : 'right';
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

  return <span className={className}>{name}</span>;
}

type TerminalPaneProps = {
  session: TerminalSession;
  paneSide: 'left' | 'right';
  isFocused: boolean;
  isDropTarget?: boolean;
  renamingSessionId: string | null;
  renameDraft: string;
  onRenameDraftChange: (value: string) => void;
  onCommitRename: (sessionId: string) => void;
  onCancelRename: () => void;
  onFocus?: () => void;
  onClearSession: (sessionId: string) => void;
  onPauseRun?: (sessionId: string) => void;
  onResumeRun?: (sessionId: string) => void;
  onStopRun?: (sessionId: string) => void;
};

function TerminalPane({
  session,
  paneSide,
  isFocused,
  isDropTarget = false,
  renamingSessionId,
  renameDraft,
  onRenameDraftChange,
  onCommitRename,
  onCancelRename,
  onFocus,
  onClearSession,
  onPauseRun,
  onResumeRun,
  onStopRun,
}: TerminalPaneProps) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [session.logs]);

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
        <span className="terminal__pane-label">{paneSide === 'left' ? 'Left' : 'Right'}</span>
        <RenameField
          sessionId={session.id}
          name={session.name}
          className="terminal__pane-name"
          renamingSessionId={renamingSessionId}
          renameDraft={renameDraft}
          onRenameDraftChange={onRenameDraftChange}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
        />
        <span className={`terminal__tab-status terminal__tab-status--${session.status}`} />
        <div className="terminal__pane-actions">
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
      <div className="terminal__body" ref={bodyRef}>
        {session.logs.map((log) => (
          <div key={log.id} className={`terminal__line terminal__line--${log.level}`}>
            <span className="terminal__line-badge">{LOG_BADGE[log.level]}</span>
            <span className="terminal__line-text">{log.message}</span>
          </div>
        ))}
      </div>
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
  onPauseRun,
  onResumeRun,
  onStopRun,
  onHeightChange,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const heightDragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(height);
  const pendingTabDrag = useRef<{ sessionId: string; x: number; y: number } | null>(null);
  const tabDragged = useRef(false);
  const dragAnchorSessionIdRef = useRef(activeSessionId);
  const maxHeight = Math.round(window.innerHeight * 0.65);
  const [splitPanes, setSplitPanes] = useState<SplitPanes | null>(null);
  const [focusedPane, setFocusedPane] = useState<'left' | 'right'>('left');
  const [tabDrag, setTabDrag] = useState<{ sessionId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [ghostPosition, setGhostPosition] = useState({ x: 0, y: 0 });
  const [maximized, setMaximized] = useState(false);
  const restoredHeightRef = useRef(height);
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const pendingTabClickRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[sessions.length - 1];

  const leftSession = splitPanes
    ? sessions.find((session) => session.id === splitPanes.left) ?? null
    : null;
  const rightSession = splitPanes
    ? sessions.find((session) => session.id === splitPanes.right) ?? null
    : null;
  const showSplit = Boolean(splitPanes && leftSession && rightSession && leftSession.id !== rightSession.id);

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
    if (!splitPanes) return;

    if (sessions.length < 2) {
      setSplitPanes(null);
      return;
    }

    const leftValid = sessions.some((session) => session.id === splitPanes.left);
    const rightValid = sessions.some((session) => session.id === splitPanes.right);

    if (!leftValid || !rightValid || splitPanes.left === splitPanes.right) {
      setSplitPanes(null);
    }
  }, [sessions, splitPanes]);

  useEffect(() => {
    if (showSplit) return;
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [activeSession?.logs, activeSessionId, showSplit]);

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
      setDropTarget(resolveDropTarget(event.clientX, event.clientY, contentRef.current));
    },
    [maxHeight, onHeightChange, sessions.length, tabDrag],
  );

  const onMouseUp = useCallback(() => {
    if (tabDrag && dropTarget) {
      const nextSplit = applySplitDrop(
        tabDrag.sessionId,
        dropTarget,
        splitPanes,
        dragAnchorSessionIdRef.current,
        sessions,
      );
      if (nextSplit) {
        setSplitPanes(nextSplit);
        setFocusedPane(dropTarget);
        onActiveSessionChange(tabDrag.sessionId);
      }
    }

    heightDragging.current = false;
    pendingTabDrag.current = null;
    setTabDrag(null);
    setDropTarget(null);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, [dropTarget, onActiveSessionChange, sessions, splitPanes, tabDrag]);

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

    if (showSplit && splitPanes) {
      if (sessionId === splitPanes.left) {
        setFocusedPane('left');
        onActiveSessionChange(sessionId);
        return;
      }
      if (sessionId === splitPanes.right) {
        setFocusedPane('right');
        onActiveSessionChange(sessionId);
        return;
      }

      setSplitPanes((current) => {
        if (!current) return current;
        return focusedPane === 'left'
          ? { ...current, left: sessionId }
          : { ...current, right: sessionId };
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
    cancelPendingTabClick();
    event.preventDefault();
    event.stopPropagation();
    startRename(sessionId, name);
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
    setRenameDraft('');
  };

  const renameFieldProps = {
    renamingSessionId,
    renameDraft,
    onRenameDraftChange: setRenameDraft,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
  };

  const collapseSplit = () => {
    setSplitPanes(null);
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

  const draggedSession = tabDrag ? sessions.find((session) => session.id === tabDrag.sessionId) : null;

  if (!activeSession) return null;

  const renderTab = (session: TerminalSession) => {
    const inLeft = showSplit && session.id === leftSession?.id;
    const inRight = showSplit && session.id === rightSession?.id;
    const isActive = session.id === activeSessionId;
    const isRenaming = renamingSessionId === session.id;

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
          inLeft && 'terminal__tab--split-left',
          inRight && 'terminal__tab--split-right',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(event) => startTabDrag(session.id, event)}
        onClick={() => scheduleTabClick(session.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleTabClick(session.id);
          }
        }}
        title="Double-click tab name to rename. Drag tab to pin split pane."
      >
        {isRenaming ? (
          <RenameField sessionId={session.id} name={session.name} className="terminal__tab-name" {...renameFieldProps} />
        ) : (
          <span
            className="terminal__tab-name"
            onDoubleClick={(event) => handleTabRename(session.id, session.name, event)}
          >
            {session.name}
          </span>
        )}
        {inLeft && <span className="terminal__tab-pin">L</span>}
        {inRight && <span className="terminal__tab-pin terminal__tab-pin--right">R</span>}
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

  const renderRailItem = (session: TerminalSession, options?: { pinned?: 'left' | 'right' }) => {
    const isActive = session.id === activeSessionId;
    const isRenaming = renamingSessionId === session.id;

    return (
      <div
        key={session.id}
        role="button"
        tabIndex={0}
        className={[
          'terminal__session-rail-item',
          options?.pinned && 'terminal__session-rail-item--pinned',
          options?.pinned === 'right' && 'terminal__session-rail-item--pinned-right',
          isActive && 'terminal__session-rail-item--active',
        ]
          .filter(Boolean)
          .join(' ')}
        onMouseDown={(event) => startTabDrag(session.id, event)}
        onClick={() => scheduleTabClick(session.id)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            handleTabClick(session.id);
          }
        }}
      >
        {options?.pinned && (
          <span
            className={[
              'terminal__session-rail-pin',
              options.pinned === 'right' && 'terminal__session-rail-pin--right',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {options.pinned === 'left' ? 'L' : 'R'}
          </span>
        )}
        {isRenaming ? (
          <RenameField
            sessionId={session.id}
            name={session.name}
            className="terminal__session-rail-name"
            {...renameFieldProps}
          />
        ) : (
          <span
            className="terminal__session-rail-name"
            onDoubleClick={(event) => handleTabRename(session.id, session.name, event)}
          >
            {session.name}
          </span>
        )}
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
        showSplit && 'terminal--split',
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
          {!showSplit && (activeSession.status === 'running' || activeSession.status === 'paused') && (
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
          {!showSplit && (
            <button type="button" className="terminal__clear" onClick={() => onClearSession(activeSession.id)}>
              <Trash2 size={14} />
              Clear
            </button>
          )}
          {showSplit && (
            <button
              type="button"
              className="terminal__split-toggle terminal__split-toggle--active"
              onClick={collapseSplit}
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
          {showSplit && leftSession && rightSession ? (
            <div className="terminal__panes">
              {tabDrag && (
                <div className="terminal__drop-overlay" aria-hidden="true">
                  <div
                    className={`terminal__drop-zone terminal__drop-zone--left${dropTarget === 'left' ? ' terminal__drop-zone--active' : ''}`}
                  >
                    <span>Pin left pane</span>
                  </div>
                  <div
                    className={`terminal__drop-zone terminal__drop-zone--right${dropTarget === 'right' ? ' terminal__drop-zone--active' : ''}`}
                  >
                    <span>Pin right pane</span>
                  </div>
                </div>
              )}
              <TerminalPane
                key={leftSession.id}
                session={leftSession}
                paneSide="left"
                isFocused={focusedPane === 'left'}
                isDropTarget={Boolean(tabDrag && dropTarget === 'left')}
                {...renameFieldProps}
                onFocus={() => {
                  setFocusedPane('left');
                  onActiveSessionChange(leftSession.id);
                }}
                onClearSession={onClearSession}
                onPauseRun={onPauseRun}
                onResumeRun={onResumeRun}
                onStopRun={onStopRun}
              />
              <TerminalPane
                key={rightSession.id}
                session={rightSession}
                paneSide="right"
                isFocused={focusedPane === 'right'}
                isDropTarget={Boolean(tabDrag && dropTarget === 'right')}
                {...renameFieldProps}
                onFocus={() => {
                  setFocusedPane('right');
                  onActiveSessionChange(rightSession.id);
                }}
                onClearSession={onClearSession}
                onPauseRun={onPauseRun}
                onResumeRun={onResumeRun}
                onStopRun={onStopRun}
              />
            </div>
          ) : (
            <div className="terminal__body terminal__body--single" ref={bodyRef}>
              {activeSession.logs.map((log) => (
                <div key={log.id} className={`terminal__line terminal__line--${log.level}`}>
                  <span className="terminal__line-badge">{LOG_BADGE[log.level]}</span>
                  <span className="terminal__line-text">{log.message}</span>
                </div>
              ))}
              {tabDrag && (
                <div className="terminal__drop-overlay" aria-hidden="true">
                  <div
                    className={`terminal__drop-zone terminal__drop-zone--left${dropTarget === 'left' ? ' terminal__drop-zone--active' : ''}`}
                  >
                    <span>Pin left pane</span>
                  </div>
                  <div
                    className={`terminal__drop-zone terminal__drop-zone--right${dropTarget === 'right' ? ' terminal__drop-zone--active' : ''}`}
                  >
                    <span>Pin right pane</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <aside className="terminal__session-rail" aria-label="Terminal sessions">
          {showSplit && leftSession && rightSession && (
            <div className="terminal__session-rail-group">
              <span className="terminal__session-rail-group-label">Split</span>
              {renderRailItem(leftSession, { pinned: 'left' })}
              {renderRailItem(rightSession, { pinned: 'right' })}
            </div>
          )}
          <div className="terminal__session-rail-list">
            {sessions
              .filter(
                (session) =>
                  !showSplit ||
                  (session.id !== leftSession?.id && session.id !== rightSession?.id),
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
