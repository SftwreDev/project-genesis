import { useEffect, useRef, useState } from 'react';
import { Eraser, MoreHorizontal, X } from 'lucide-react';

type Props = {
  onClearCanvas: () => void;
  clearDisabled?: boolean;
};

export default function ToolbarOverflowMenu({ onClearCanvas, clearDisabled }: Props) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as HTMLElement)) {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  return (
    <div className="toolbar-overflow" ref={menuRef}>
      <button
        type="button"
        className={`btn btn--ghost btn--icon toolbar-overflow__trigger${open ? ' toolbar-overflow__trigger--open' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title="More canvas actions"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <MoreHorizontal size={16} />
      </button>

      {open && (
        <div className="toolbar-overflow__panel" role="menu">
          <div className="toolbar-overflow__panel-header">
            <span>Canvas</span>
            <button type="button" className="workflow-group-menu__close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>
          <button
            type="button"
            role="menuitem"
            className="toolbar-overflow__item toolbar-overflow__item--danger"
            onClick={() => {
              onClearCanvas();
              setOpen(false);
            }}
            disabled={clearDisabled}
          >
            <Eraser size={15} />
            Clear canvas
          </button>
        </div>
      )}
    </div>
  );
}
