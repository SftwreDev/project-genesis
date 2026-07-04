import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, Position, type Edge, type Node, type NodeProps } from '@xyflow/react';
import {
  CircleStop,
  Clock,
  GitBranch,
  MessageSquare,
  Play,
  PlayCircle,
  Timer,
  X,
} from 'lucide-react';
import { isIntegrationCommand, isWorkflowTool, getCommandAccentColor } from '../data/k8sCommands';
import type { CommandNodeData } from '../types';
import { formatCommandPreview, getCustomParams, splitKubectlWithContext } from '../utils/commandPreview';
import { describeSchedule } from '../utils/scheduleRecurrence';
import { getNodeCardTitle } from '../utils/workflowSignature';
import {
  resolveEffectiveKubeContext,
  resolveEffectiveNamespace,
} from '../utils/workflowContext';

const statusLabel: Record<CommandNodeData['runStatus'], string> = {
  idle: 'Ready',
  running: 'Running',
  success: 'Done',
  error: 'Failed',
  skipped: 'Skipped',
};

type CommandNodeProps = NodeProps & {
  onRunNode?: (nodeId: string) => void;
  onDeleteNode?: (nodeId: string) => void;
  onRenameCardTitle?: (nodeId: string, cardTitle: string) => void;
  isRunning?: boolean;
  globalContext?: string;
  workflowNodes?: Node<CommandNodeData>[];
  workflowEdges?: Edge[];
};

function formatDelayTimer(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes > 0) {
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
  }
  return `${seconds}s`;
}

function CommandNode({
  id,
  data,
  selected,
  onRunNode,
  onDeleteNode,
  onRenameCardTitle,
  isRunning,
  globalContext = '',
  workflowNodes = [],
  workflowEdges = [],
}: CommandNodeProps) {
  const nodeData = data as CommandNodeData;
  const cardTitle = getNodeCardTitle({ data: nodeData });
  const cardAccentColor =
    nodeData.workflowGroupColor ?? getCommandAccentColor(nodeData.commandId);
  const renameLocked = Boolean(nodeData.workflowGroupId);
  const isTool = isWorkflowTool(nodeData.commandId);
  const isIntegration = isIntegrationCommand(nodeData.commandId);
  const isCondition = nodeData.commandId === 'workflow-condition';
  const isStart = nodeData.commandId === 'workflow-start';
  const isEnd = nodeData.commandId === 'workflow-end';
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(cardTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleOpenedAtRef = useRef(0);

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

  useEffect(() => {
    if (!isEditingTitle) {
      setTitleDraft(cardTitle);
    }
  }, [cardTitle, isEditingTitle]);

  useEffect(() => {
    if (!isEditingTitle) return;
    titleOpenedAtRef.current = Date.now();
    requestAnimationFrame(() => {
      const input = titleInputRef.current;
      if (!input) return;
      input.focus();
      input.select();
    });
  }, [isEditingTitle]);

  const previewParams = useMemo(() => {
    const effectiveNamespace = resolveEffectiveNamespace(id, workflowNodes, workflowEdges);
    if (!effectiveNamespace) return nodeData.params;
    return { ...nodeData.params, namespace: effectiveNamespace };
  }, [id, nodeData.params, workflowEdges, workflowNodes]);

  const kubeContext = useMemo(
    () => resolveEffectiveKubeContext(id, workflowNodes, workflowEdges, globalContext),
    [globalContext, id, workflowEdges, workflowNodes],
  );

  const kubectlParts = splitKubectlWithContext(nodeData.kubectl, previewParams, kubeContext);
  const customParams = getCustomParams(nodeData.commandId, previewParams);
  const preview = formatCommandPreview(
    nodeData.commandId,
    nodeData.kubectl,
    previewParams,
    kubeContext,
  );

  const toolSummary =
    nodeData.commandId === 'workflow-delay'
      ? `${nodeData.params.delaySeconds || '5'} second pause`
      : nodeData.commandId === 'workflow-schedule'
        ? describeSchedule(nodeData.params)
        : nodeData.commandId === 'workflow-condition'
          ? 'Route on upstream success or failure'
          : nodeData.commandId === 'workflow-start'
            ? nodeData.params.segmentName?.trim() || 'Main Workflow'
            : nodeData.commandId === 'workflow-end'
              ? nodeData.params.segmentName?.trim() || 'Main Workflow'
              : nodeData.commandId === 'slack-notify'
                ? nodeData.params.message?.trim() || nodeData.params.channel || 'Slack message'
                : nodeData.label;

  const beginTitleEdit = () => {
    if (renameLocked || isEditingTitle) return;
    setTitleDraft(cardTitle);
    setIsEditingTitle(true);
  };

  const handleTitleDoubleClick = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (renameLocked) return;
    beginTitleEdit();
  };

  const commitTitle = () => {
    const trimmed = titleDraft.trim();
    setIsEditingTitle(false);
    if (!trimmed || trimmed === cardTitle || renameLocked) return;
    onRenameCardTitle?.(id, trimmed);
  };

  const cancelTitleEdit = () => {
    setTitleDraft(cardTitle);
    setIsEditingTitle(false);
  };

  return (
    <div
      className={`command-node${isTool ? ' command-node--tool' : ''}${isIntegration ? ' command-node--integration' : ''}${isCondition ? ' command-node--condition' : ''}${isStart ? ' command-node--start' : ''}${isEnd ? ' command-node--end' : ''} command-node--${nodeData.runStatus}${selected ? ' command-node--selected' : ''}${nodeData.workflowGroupId ? ' command-node--grouped' : ''}`}
      style={{ ['--node-accent' as string]: cardAccentColor }}
    >
      <div className="command-node__accent-bar" style={{ backgroundColor: cardAccentColor }} />

      {!isStart && (
        <Handle
          type="target"
          position={Position.Top}
          className="command-node__handle command-node__handle--in nodrag nopan"
          style={{ background: cardAccentColor }}
        />
      )}
      {!isEnd && !isCondition && (
        <Handle
          type="source"
          position={Position.Bottom}
          className="command-node__handle command-node__handle--out nodrag nopan"
          style={{ background: cardAccentColor }}
        />
      )}

      <div className="command-node__surface">
      <div className="command-node__header">
        <div className="command-node__title-block nodrag nopan nowheel">
          {isEditingTitle && !renameLocked ? (
            <input
              ref={titleInputRef}
              className="command-node__title-input"
              value={titleDraft}
              onChange={(event) => setTitleDraft(event.target.value)}
              onBlur={() => {
                window.setTimeout(() => {
                  if (Date.now() - titleOpenedAtRef.current < 150) return;
                  commitTitle();
                }, 0);
              }}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === 'Enter') {
                  event.preventDefault();
                  commitTitle();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelTitleEdit();
                }
              }}
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            />
          ) : (
            <span
              className="command-node__title-text"
              title={
                renameLocked
                  ? 'Ungroup to rename this workflow node'
                  : 'Double-click to rename'
              }
              onMouseDown={(event) => event.stopPropagation()}
              onDoubleClick={handleTitleDoubleClick}
            >
              {cardTitle}
            </span>
          )}
        </div>

        <button
          type="button"
          className="command-node__icon-btn command-node__icon-btn--danger nodrag nopan"
          aria-label="Remove node"
          onClick={(event) => {
            event.stopPropagation();
            onDeleteNode?.(id);
          }}
        >
          <X size={12} />
        </button>
      </div>

      {nodeData.workflowGroupName && (
        <div
          className="command-node__group-badge"
          style={{ backgroundColor: `${nodeData.workflowGroupColor ?? '#38bdf8'}22`, color: nodeData.workflowGroupColor }}
        >
          {nodeData.workflowGroupName}
        </div>
      )}

      <div className="command-node__meta">
        <span className="command-node__color-dot" style={{ backgroundColor: cardAccentColor }} />
        <span className="command-node__template-label">{nodeData.label}</span>
      </div>

      <div className="command-node__body">
        {isTool ? (
          <div className="command-node__summary">
            {nodeData.commandId === 'workflow-delay' ? (
              <Timer size={14} />
            ) : nodeData.commandId === 'workflow-condition' ? (
              <GitBranch size={14} />
            ) : nodeData.commandId === 'workflow-start' ? (
              <PlayCircle size={14} />
            ) : nodeData.commandId === 'workflow-end' ? (
              <CircleStop size={14} />
            ) : (
              <Clock size={14} />
            )}
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
        ) : isIntegration ? (
          <div className="command-node__summary">
            <MessageSquare size={14} />
            <span>{toolSummary}</span>
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
          </>
        )}
      </div>

      <div className="command-node__footer">
        <div className={`command-node__status command-node__status--${nodeData.runStatus}`}>
          {statusLabel[nodeData.runStatus]}
        </div>
        <button
          type="button"
          className="command-node__run nodrag nopan"
          disabled={isRunning || nodeData.runStatus === 'running' || isStart || isEnd}
          onClick={(event) => {
            event.stopPropagation();
            onRunNode?.(id);
          }}
        >
          <Play size={12} />
          Run
        </button>
      </div>
      </div>

      {isCondition ? (
        <>
          <Handle
            type="source"
            position={Position.Bottom}
            id="success"
            className="command-node__handle command-node__handle--success nodrag nopan"
          />
          <span className="command-node__branch-label command-node__branch-label--success">success</span>
          <Handle
            type="source"
            position={Position.Bottom}
            id="failure"
            className="command-node__handle command-node__handle--failure nodrag nopan"
          />
          <span className="command-node__branch-label command-node__branch-label--failure">failure</span>
        </>
      ) : null}
    </div>
  );
}

export default memo(CommandNode);
