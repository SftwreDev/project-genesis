import { useCallback, useEffect, useRef } from 'react';
import { GripHorizontal, Trash2, X } from 'lucide-react';
import type { TerminalSession } from '../types';

type Props = {
  sessions: TerminalSession[];
  activeSessionId: string;
  height: number;
  onActiveSessionChange: (sessionId: string) => void;
  onCloseSession: (sessionId: string) => void;
  onClearSession: (sessionId: string) => void;
  onHeightChange: (height: number) => void;
};

const MIN_HEIGHT = 120;

export default function ExecutionTerminal({
  sessions,
  activeSessionId,
  height,
  onActiveSessionChange,
  onCloseSession,
  onClearSession,
  onHeightChange,
}: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const startY = useRef(0);
  const startHeight = useRef(height);
  const maxHeight = Math.round(window.innerHeight * 0.65);

  const activeSession =
    sessions.find((session) => session.id === activeSessionId) ?? sessions[sessions.length - 1];

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = body.scrollHeight;
  }, [activeSession?.logs, activeSessionId]);

  const onMouseMove = useCallback(
    (event: MouseEvent) => {
      if (!dragging.current) return;
      const delta = startY.current - event.clientY;
      const next = Math.min(maxHeight, Math.max(MIN_HEIGHT, startHeight.current + delta));
      onHeightChange(next);
    },
    [maxHeight, onHeightChange],
  );

  const onMouseUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

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
    dragging.current = true;
    startY.current = event.clientY;
    startHeight.current = height;
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  };

  if (!activeSession) return null;

  return (
    <section className="terminal" style={{ height }}>
      <div
        className="terminal__resize"
        onMouseDown={startResize}
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
      >
        <GripHorizontal size={14} />
      </div>
      <header className="terminal__header">
        <div className="terminal__tabs">
          {sessions.map((session) => (
            <button
              key={session.id}
              type="button"
              className={`terminal__tab${session.id === activeSession.id ? ' terminal__tab--active' : ''}`}
              onClick={() => onActiveSessionChange(session.id)}
            >
              <span className="terminal__tab-name">{session.name}</span>
              <span className={`terminal__tab-status terminal__tab-status--${session.status}`} />
              {sessions.length > 1 && (
                <span
                  className="terminal__tab-close"
                  role="button"
                  tabIndex={0}
                  onClick={(event) => {
                    event.stopPropagation();
                    onCloseSession(session.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      onCloseSession(session.id);
                    }
                  }}
                >
                  <X size={11} />
                </span>
              )}
            </button>
          ))}
        </div>
        <button type="button" className="terminal__clear" onClick={() => onClearSession(activeSession.id)}>
          <Trash2 size={14} />
          Clear
        </button>
      </header>
      <div className="terminal__body" ref={bodyRef}>
        {activeSession.logs.map((log) => (
          <div key={log.id} className={`terminal__line terminal__line--${log.level}`}>
            {log.message}
          </div>
        ))}
      </div>
    </section>
  );
}
