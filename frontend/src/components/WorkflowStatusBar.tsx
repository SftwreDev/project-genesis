import { CircleDot, CircleCheck } from 'lucide-react';

type Props = {
  projectName: string | null;
  globalContext: string;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  selectedCount: number;
  isDirty: boolean;
  hasSavedProject: boolean;
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="workflow-status__stat">
      <strong>{value}</strong> {label}
    </span>
  );
}

export default function WorkflowStatusBar({
  projectName,
  globalContext,
  nodeCount,
  edgeCount,
  groupCount,
  selectedCount,
  isDirty,
  hasSavedProject,
}: Props) {
  const saveLabel = isDirty
    ? hasSavedProject
      ? 'Unsaved changes'
      : 'Unsaved draft'
    : hasSavedProject
      ? 'Saved'
      : 'Ready';

  return (
    <div className="workflow-status" aria-label="Workflow status">
      <div className="workflow-status__start">
        <span className="workflow-status__project" title="Active workflow">
          {projectName ?? 'Untitled workflow'}
        </span>

        <span className="workflow-status__sep" aria-hidden="true">
          ·
        </span>
        <span
          className={`workflow-status__context${globalContext ? '' : ' workflow-status__context--empty'}`}
          title={globalContext ? 'Active kube context' : 'No global kube context enabled'}
        >
          {globalContext || 'No context'}
        </span>

        <span className="workflow-status__sep" aria-hidden="true">
          ·
        </span>

        <div className="workflow-status__stats">
          <Stat label="nodes" value={nodeCount} />
          <Stat label="edges" value={edgeCount} />
          <Stat label="groups" value={groupCount} />
          {selectedCount > 0 && <Stat label="selected" value={selectedCount} />}
        </div>
      </div>

      <div
        className={`workflow-status__save workflow-status__save--${isDirty ? 'dirty' : hasSavedProject ? 'clean' : 'idle'}`}
        title={saveLabel}
      >
        {isDirty ? <CircleDot size={14} /> : hasSavedProject ? <CircleCheck size={14} /> : null}
        <span>{saveLabel}</span>
      </div>
    </div>
  );
}
