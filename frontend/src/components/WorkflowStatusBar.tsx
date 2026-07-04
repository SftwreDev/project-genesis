import { CircleDot, CircleCheck } from 'lucide-react';
import type { ContextHealthStatus } from '../utils/contextHealth';

type Props = {
  projectName: string | null;
  globalContext: string;
  contextHealth?: ContextHealthStatus;
  contextHealthMessage?: string;
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

function contextHealthTitle(
  globalContext: string,
  status: ContextHealthStatus,
  message: string,
): string {
  if (!globalContext.trim()) {
    return 'No global kube context enabled';
  }

  switch (status) {
    case 'connected':
      return message || `Context "${globalContext}" is connected`;
    case 'expired':
      return message || `Context "${globalContext}" expired — re-login with kubectl`;
    case 'unreachable':
      return message || `Context "${globalContext}" unreachable`;
    case 'unknown':
      return `Checking context "${globalContext}"...`;
    default:
      return `Active kube context: ${globalContext}`;
  }
}

export default function WorkflowStatusBar({
  projectName,
  globalContext,
  contextHealth = 'idle',
  contextHealthMessage = '',
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

  const showHealth = Boolean(globalContext.trim()) && contextHealth !== 'idle';

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
          title={contextHealthTitle(globalContext, contextHealth, contextHealthMessage)}
        >
          {showHealth && (
            <span
              className={`workflow-status__context-dot workflow-status__context-dot--${contextHealth}`}
              aria-hidden="true"
            />
          )}
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
