import { useEffect, useRef } from 'react';
import { LoaderCircle, X } from 'lucide-react';

export type ProjectModalMode = 'save' | 'edit' | 'delete';

type Props = {
  open: boolean;
  mode: ProjectModalMode;
  title: string;
  description: string;
  error?: string;
  value: string;
  confirmLabel: string;
  busy?: boolean;
  danger?: boolean;
  onChange: (value: string) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export default function ProjectModal({
  open,
  mode,
  title,
  description,
  error = '',
  value,
  confirmLabel,
  busy = false,
  danger = false,
  onChange,
  onConfirm,
  onClose,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || mode === 'delete') return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [mode, open]);

  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, open]);

  if (!open) return null;

  return (
    <div className="project-modal" role="presentation" onClick={onClose}>
      <div
        className="project-modal__dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="project-modal__header">
          <div>
            <h3 id="project-modal-title">{title}</h3>
            <p>{description}</p>
            {error && <p className="project-modal__error">{error}</p>}
          </div>
          <button type="button" className="project-modal__close" onClick={onClose} disabled={busy}>
            <X size={16} />
          </button>
        </header>

        {mode !== 'delete' ? (
          <label className="project-modal__field">
            <span>Project name</span>
            <input
              ref={inputRef}
              type="text"
              value={value}
              onChange={(event) => onChange(event.target.value)}
              placeholder="e.g. staging rollout"
              disabled={busy}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && value.trim()) onConfirm();
              }}
            />
          </label>
        ) : (
          <p className="project-modal__warning">
            Delete <strong>{value}</strong>? If this project is open, canvas workflow clears too.
          </p>
        )}

        <footer className="project-modal__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={`btn${danger ? ' project-modal__confirm--danger' : ' btn--primary'}`}
            onClick={onConfirm}
            disabled={busy || (mode !== 'delete' && !value.trim())}
          >
            {busy ? <LoaderCircle size={14} className="spin" /> : null}
            {confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
