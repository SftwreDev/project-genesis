import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Clock, Play, Timer, X } from 'lucide-react';
import { isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData } from '../types';
import { formatCommandPreview, getCustomParams, splitKubectlWithContext } from '../utils/commandPreview';
import { parseKubeContext } from '../utils/workflowContext';

const statusLabel: Record<CommandNodeData['runStatus'], string> = {
  idle: 'Ready',
  running: 'Running',
  success: 'Done',
  error: 'Failed',
};

type CommandNodeProps = NodeProps & {
  onRunNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  isRunning?: boolean;
};

function formatDelayTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes > 0) {
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

function CommandNode({ id, data, selected, onRunNode, onDeleteNode, isRunning }: CommandNodeProps) {
  const nodeData = data as CommandNodeData;
  const isTool = isWorkflowTool(nodeData.commandId);
  const isDelayRunning =
    nodeData.commandId === 'workflow-delay' &&
    nodeData.runStatus === 'running' &&
    nodeData.timerSeconds != null;
  const delayProgress =
    isDelayRunning &&
    nodeData.timerTotalSeconds &&
    nodeData.timerTotalSeconds > 0 &&
    nodeData.timerSeconds != null
      ? ((nodeData.timerTotalSeconds - nodeData.timerSeconds) / nodeData.timerTotalSeconds) * 100
      : 0;
  const kubeContext = parseKubeContext(nodeData.context ?? '');
  const kubectlParts = splitKubectlWithContext(nodeData.kubectl, nodeData.params, kubeContext);
  const customParams = getCustomParams(nodeData.commandId, nodeData.params);
  const preview = formatCommandPreview(
    nodeData.commandId,
    nodeData.kubectl,
    nodeData.params,
    kubeContext,
  );

  const toolSummary =
    nodeData.commandId === 'workflow-delay'
      ? `${nodeData.params.delaySeconds || '5'} second pause`
      : nodeData.commandId === 'workflow-schedule'
        ? nodeData.params.scheduledAt
          ? new Date(nodeData.params.scheduledAt).toLocaleString()
          : 'Set run time'
        : nodeData.label;

  return (
    <div
      className={`command-node${isTool ? ' command-node--tool' : ''} command-node--${nodeData.runStatus}${selected ? ' command-node--selected' : ''}${nodeData.workflowGroupId ? ' command-node--grouped' : ''}`}
      style={{
        borderColor: nodeData.workflowGroupColor ?? nodeData.color,
        width: 'max-content',
        minWidth: 280,
        maxWidth: 420,
        boxShadow: nodeData.workflowGroupColor
          ? `0 0 0 1px ${nodeData.workflowGroupColor}55, 0 10px 30px rgba(2, 6, 23, 0.35)`
          : undefined,
      }}
    >
      <button
        type="button"
        className="command-node__close"
        aria-label="Remove node"
        onClick={(event) => {
          event.stopPropagation();
          onDeleteNode?.(id);
        }}
      >
        <X size={12} />
      </button>
      <Handle type="target" position={Position.Top} className="command-node__handle" />
      {nodeData.workflowGroupName && (
        <div
          className="command-node__group-badge"
          style={{ backgroundColor: `${nodeData.workflowGroupColor ?? '#38bdf8'}22`, color: nodeData.workflowGroupColor }}
        >
          {nodeData.workflowGroupName}
        </div>
      )}
      <div className="command-node__category" style={{ color: nodeData.color }}>
        {nodeData.groupLabel}
      </div>
      <div className="command-node__title">{nodeData.label}</div>

      {isTool ? (
        <div className="command-node__tool">
          {nodeData.commandId === 'workflow-delay' ? <Timer size={14} /> : <Clock size={14} />}
          {isDelayRunning ? (
            <div className="command-node__delay-timer">
              <strong>{formatDelayTimer(nodeData.timerSeconds ?? 0)}</strong>
              <span>remaining</span>
              <div className="command-node__delay-bar">
                <div
                  className="command-node__delay-bar-fill"
                  style={{ width: `${Math.max(0, Math.min(100, delayProgress))}%` }}
                />
              </div>
            </div>
          ) : (
            <span>{toolSummary}</span>
          )}
        </div>
      ) : (
        <>
          <div className="command-node__kubectl" title={preview}>
            {kubectlParts.map((part, index) => (
              <span
                key={`${part.kind}-${index}`}
                className={
                  part.kind === 'value'
                    ? 'command-node__kubectl-value'
                    : part.kind === 'placeholder'
                      ? 'command-node__kubectl-placeholder'
                      : part.kind === 'flag'
                        ? 'command-node__kubectl-flag'
                        : undefined
                }
              >
                {part.text}
              </span>
            ))}
          </div>

          {customParams.length > 0 && (
            <div className="command-node__custom">
              {customParams.map(([key, value]) => (
                <span key={key} className="command-node__custom-chip" title={`${key}=${value}`}>
                  {key}={value}
                </span>
              ))}
            </div>
          )}

          <pre className="command-node__yaml">{nodeData.yamlContent}</pre>
        </>
      )}

      <div className="command-node__footer">
        <div className={`command-node__status command-node__status--${nodeData.runStatus}`}>
          {statusLabel[nodeData.runStatus]}
        </div>
        <button
          type="button"
          className="command-node__run"
          disabled={isRunning || nodeData.runStatus === 'running'}
          onClick={(event) => {
            event.stopPropagation();
            onRunNode?.(id);
          }}
        >
          <Play size={12} />
          Run
        </button>
      </div>
      <Handle type="source" position={Position.Bottom} className="command-node__handle" />
    </div>
  );
}

export default memo(CommandNode);
