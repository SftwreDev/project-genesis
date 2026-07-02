import { useEffect, useRef, useState } from 'react';
import { FolderKanban, Play, Trash2, X } from 'lucide-react';
import type { WorkflowGroup } from '../types';

type Props = {
  groups: WorkflowGroup[];
  selectedNodeIds: string[];
  runningGroupIds: Set<string>;
  onSaveGroup: (name: string, nodeIds: string[]) => void;
  onRunGroup: (groupId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onHighlightGroup: (groupId: string) => void;
};

export default function WorkflowGroupMenu({
  groups,
  selectedNodeIds,
  runningGroupIds,
  onSaveGroup,
  onRunGroup,
  onDeleteGroup,
  onHighlightGroup,
}: Props) {
  const [open, setOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
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

  const handleSave = () => {
    const name = groupName.trim();
    if (!name || selectedNodeIds.length === 0) return;
    onSaveGroup(name, selectedNodeIds);
    setGroupName('');
  };

  return (
    <div className="workflow-group-menu" ref={menuRef}>
      <button
        type="button"
        className={`btn btn--ghost workflow-group-menu__trigger${open ? ' workflow-group-menu__trigger--open' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <FolderKanban size={16} />
        Group
        {groups.length > 0 && <span className="workflow-group-menu__count">{groups.length}</span>}
      </button>

      {open && (
        <div className="workflow-group-menu__panel">
          <div className="workflow-group-menu__panel-header">
            <div>
              <h3>Group Workflow</h3>
              <p>Select nodes, name group, save, run per task.</p>
            </div>
            <button type="button" className="workflow-group-menu__close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>

          <p className="workflow-groups__hint">
            Drag on canvas to highlight nodes. Shift+click to add. Drag a selected node to move all together.
          </p>

          <div className="workflow-groups__save">
            <input
              type="text"
              value={groupName}
              onChange={(event) => setGroupName(event.target.value)}
              placeholder="Group name (e.g. Task 1)"
            />
            <button
              type="button"
              className="btn btn--ghost workflow-groups__save-btn"
              onClick={handleSave}
              disabled={!groupName.trim() || selectedNodeIds.length === 0}
            >
              Save Group ({selectedNodeIds.length})
            </button>
          </div>

          <div className="workflow-groups__list workflow-group-menu__list">
            {groups.length === 0 ? (
              <p className="workflow-groups__empty">No saved groups yet.</p>
            ) : (
              groups.map((group) => (
                <article
                  key={group.id}
                  className="workflow-groups__item"
                  style={{ borderLeftColor: group.color }}
                >
                  <button
                    type="button"
                    className="workflow-groups__item-main"
                    onClick={() => onHighlightGroup(group.id)}
                  >
                    <span className="workflow-groups__item-name">{group.name}</span>
                    <span className="workflow-groups__item-meta">{group.nodeIds.length} nodes</span>
                  </button>
                  <div className="workflow-groups__item-actions">
                    <button
                      type="button"
                      className="workflow-groups__run"
                      onClick={() => onRunGroup(group.id)}
                      disabled={runningGroupIds.has(group.id)}
                      title={`Run ${group.name}`}
                    >
                      <Play size={13} />
                    </button>
                    <button
                      type="button"
                      className="workflow-groups__delete"
                      onClick={() => onDeleteGroup(group.id)}
                      disabled={runningGroupIds.has(group.id)}
                      title={`Delete ${group.name}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
