import { useCallback, useEffect, useRef, useState } from 'react';
import { FolderOpen, LoaderCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { WorkflowProjectSummary } from '../types';
import { formatProjectUpdatedAt, listWorkflowProjects } from '../utils/workflowProjects';

type Props = {
  activeProjectId: string | null;
  activeProjectName: string | null;
  isBusy: boolean;
  refreshKey: number;
  onLoadProject: (projectId: string) => Promise<void>;
  onNewProject: () => void;
  onRequestEdit: (project: WorkflowProjectSummary) => void;
  onRequestDelete: (project: WorkflowProjectSummary) => void;
};

export default function WorkflowProjectsMenu({
  activeProjectId,
  activeProjectName,
  isBusy,
  refreshKey,
  onLoadProject,
  onNewProject,
  onRequestEdit,
  onRequestDelete,
}: Props) {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<WorkflowProjectSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [actionId, setActionId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const next = await listWorkflowProjects();
      setProjects(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workflow projects.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void refreshProjects();
  }, [open, refreshKey, refreshProjects]);

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

  const runLoad = async (projectId: string) => {
    setActionId(projectId);
    setError('');
    try {
      await onLoadProject(projectId);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load workflow project.');
    } finally {
      setActionId(null);
    }
  };

  return (
    <div className="workflow-group-menu workflow-projects-menu" ref={menuRef}>
      <button
        type="button"
        className={`btn btn--ghost workflow-group-menu__trigger${open ? ' workflow-group-menu__trigger--open' : ''}${activeProjectName ? ' workflow-projects-menu__trigger--active' : ''}`}
        onClick={() => setOpen((current) => !current)}
        title={activeProjectName ? `Active project: ${activeProjectName}` : 'Open saved workflow projects'}
      >
        <FolderOpen size={16} />
        Projects
        {projects.length > 0 && <span className="workflow-group-menu__count">{projects.length}</span>}
        {activeProjectName && <span className="workflow-projects-menu__active">{activeProjectName}</span>}
      </button>

      {open && (
        <div className="workflow-group-menu__panel workflow-projects-menu__panel">
          <div className="workflow-group-menu__panel-header">
            <div>
              <h3>Workflow Projects</h3>
              <p>Start blank canvas or load saved project. Header Save updates active project.</p>
            </div>
            <button type="button" className="workflow-group-menu__close" onClick={() => setOpen(false)}>
              <X size={14} />
            </button>
          </div>

          <button
            type="button"
            className="btn btn--primary workflow-projects-menu__new"
            onClick={() => {
              onNewProject();
              setOpen(false);
            }}
            disabled={isBusy || actionId !== null}
          >
            <Plus size={14} />
            New Project
          </button>

          {error && <p className="workflow-projects-menu__error">{error}</p>}

          <div className="workflow-groups__list workflow-group-menu__list workflow-projects-menu__list">
            {loading ? (
              <p className="workflow-groups__empty">Loading projects...</p>
            ) : projects.length === 0 ? (
              <p className="workflow-groups__empty">No saved projects yet.</p>
            ) : (
              projects.map((project) => (
                <article
                  key={project.id}
                  className={`workflow-groups__item workflow-projects-menu__item${project.id === activeProjectId ? ' workflow-projects-menu__item--active' : ''}`}
                >
                  <button
                    type="button"
                    className="workflow-groups__item-main"
                    onClick={() => void runLoad(project.id)}
                    disabled={isBusy || actionId !== null}
                  >
                    <span className="workflow-groups__item-name">{project.name}</span>
                    <span className="workflow-groups__item-meta">
                      {project.nodeCount} nodes · {project.edgeCount} edges · {project.groupCount} groups
                    </span>
                    <span className="workflow-projects-menu__updated">
                      Updated {formatProjectUpdatedAt(project.updatedAt)}
                    </span>
                  </button>
                  <div className="workflow-groups__item-actions">
                    <button
                      type="button"
                      className="global-context-menu__edit-btn"
                      onClick={() => onRequestEdit(project)}
                      disabled={isBusy || actionId !== null}
                      title={`Rename ${project.name}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      type="button"
                      className="workflow-groups__delete"
                      onClick={() => onRequestDelete(project)}
                      disabled={isBusy || actionId !== null}
                      title={`Delete ${project.name}`}
                    >
                      {actionId === `delete-${project.id}` ? (
                        <LoaderCircle size={13} className="spin" />
                      ) : (
                        <Trash2 size={13} />
                      )}
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
