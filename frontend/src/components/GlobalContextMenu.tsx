import { useEffect, useRef, useState } from 'react';
import { Globe2, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { SavedKubeContext } from '../types';

type Props = {
  contexts: SavedKubeContext[];
  activeContextName: string;
  onAddContext: (name: string) => void;
  onUpdateContext: (id: string, name: string) => void;
  onDeleteContext: (id: string) => void;
  onToggleContext: (id: string, enabled: boolean) => void;
};

export default function GlobalContextMenu({
  contexts,
  activeContextName,
  onAddContext,
  onUpdateContext,
  onDeleteContext,
  onToggleContext,
}: Props) {
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as HTMLElement)) {
        setOpen(false);
        setEditingId(null);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    return () => window.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onAddContext(name);
    setNewName('');
  };

  const startEdit = (context: SavedKubeContext) => {
    setEditingId(context.id);
    setEditName(context.name);
  };

  const saveEdit = () => {
    if (!editingId) return;
    const name = editName.trim();
    if (!name) return;
    onUpdateContext(editingId, name);
    setEditingId(null);
    setEditName('');
  };

  return (
    <div className="workflow-group-menu global-context-menu" ref={menuRef}>
      <button
        type="button"
        className={`btn btn--ghost workflow-group-menu__trigger${open ? ' workflow-group-menu__trigger--open' : ''}${activeContextName ? ' global-context-menu__trigger--active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title={activeContextName ? `Global context: ${activeContextName}` : 'Manage kube contexts'}
      >
        <Globe2 size={16} />
        Context
        {contexts.length > 0 && (
          <span className="workflow-group-menu__count">{contexts.length}</span>
        )}
        {activeContextName && (
          <span className="global-context-menu__active">{activeContextName}</span>
        )}
      </button>

      {open && (
        <div className="workflow-group-menu__panel global-context-menu__panel">
          <div className="workflow-group-menu__panel-header">
            <div>
              <h3>Kube Contexts</h3>
              <p>Enable one to apply --context globally. Node overrides in the right panel win.</p>
            </div>
            <button
              type="button"
              className="workflow-group-menu__close"
              onClick={() => {
                setOpen(false);
                setEditingId(null);
              }}
            >
              <X size={14} />
            </button>
          </div>

          <div className="global-context-menu__add">
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Context name (e.g. test-prod)"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAdd();
              }}
            />
            <button type="button" className="btn btn--ghost global-context-menu__add-btn" onClick={handleAdd}>
              <Plus size={14} />
              Add
            </button>
          </div>

          <div className="workflow-groups__list workflow-group-menu__list global-context-menu__list">
            {contexts.length === 0 ? (
              <p className="workflow-groups__empty">No saved contexts yet.</p>
            ) : (
              contexts.map((context) => (
                <article
                  key={context.id}
                  className={`workflow-groups__item global-context-menu__item${context.enabled ? ' global-context-menu__item--enabled' : ''}`}
                >
                  {editingId === context.id ? (
                    <div className="global-context-menu__edit">
                      <input
                        type="text"
                        value={editName}
                        onChange={(event) => setEditName(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') saveEdit();
                          if (event.key === 'Escape') setEditingId(null);
                        }}
                        autoFocus
                      />
                      <button type="button" className="global-context-menu__save-edit" onClick={saveEdit}>
                        Save
                      </button>
                    </div>
                  ) : (
                    <>
                      <label className="global-context-menu__toggle" title={context.enabled ? 'Disable global context' : 'Enable global context'}>
                        <input
                          type="checkbox"
                          checked={context.enabled}
                          onChange={(event) => onToggleContext(context.id, event.target.checked)}
                        />
                        <span className="global-context-menu__toggle-ui" />
                      </label>
                      <div className="global-context-menu__meta">
                        <code>--context {context.name}</code>
                        {context.enabled && <span className="global-context-menu__enabled-badge">Active</span>}
                      </div>
                      <div className="workflow-groups__item-actions">
                        <button
                          type="button"
                          className="global-context-menu__edit-btn"
                          onClick={() => startEdit(context)}
                          title={`Edit ${context.name}`}
                        >
                          <Pencil size={13} />
                        </button>
                        <button
                          type="button"
                          className="workflow-groups__delete"
                          onClick={() => onDeleteContext(context.id)}
                          title={`Delete ${context.name}`}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
