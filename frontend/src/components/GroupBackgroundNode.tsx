import { memo } from 'react';
import { Play, Trash2, Unlink } from 'lucide-react';
import { useReactFlow, type NodeProps } from '@xyflow/react';
import type { WorkflowGroupFrame } from '../types';
import { GROUP_MIN_HEIGHT, GROUP_MIN_WIDTH } from '../utils/workflowSignature';

export type GroupBackgroundData = {
  groupId: string;
  label: string;
  color: string;
  nodeCount: number;
  isRunning: boolean;
  isHighlighted?: boolean;
  frame: WorkflowGroupFrame;
};

type GroupBackgroundNodeProps = NodeProps & {
  onRunGroup?: (groupId: string) => void;
  onUngroupGroup?: (groupId: string) => void;
  onDeleteGroupNodes?: (groupId: string) => void;
  onResizeGroup?: (groupId: string, frame: WorkflowGroupFrame) => void;
};

function GroupBackgroundNode({
  data,
  onRunGroup,
  onUngroupGroup,
  onDeleteGroupNodes,
  onResizeGroup,
}: GroupBackgroundNodeProps) {
  const groupData = data as GroupBackgroundData;
  const { getZoom } = useReactFlow();

  const startResize = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    const startY = event.clientY;
    const startWidth = groupData.frame.width;
    const startHeight = groupData.frame.height;
    const frameX = groupData.frame.x;
    const frameY = groupData.frame.y;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const zoom = getZoom() || 1;
      const deltaX = (moveEvent.clientX - startX) / zoom;
      const deltaY = (moveEvent.clientY - startY) / zoom;

      onResizeGroup?.(groupData.groupId, {
        x: frameX,
        y: frameY,
        width: Math.max(GROUP_MIN_WIDTH, startWidth + deltaX),
        height: Math.max(GROUP_MIN_HEIGHT, startHeight + deltaY),
      });
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'nwse-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      className={`workflow-group-box${groupData.isHighlighted ? ' workflow-group-box--highlighted' : ''}${groupData.isRunning ? ' workflow-group-box--running' : ''}`}
      style={{
        borderColor: groupData.color,
        backgroundColor: `${groupData.color}${groupData.isHighlighted ? '22' : '14'}`,
      }}
    >
      <div className="workflow-group-box__header nodrag nopan">
        <span className="workflow-group-box__label" style={{ color: groupData.color }}>
          {groupData.label}
          <span className="workflow-group-box__count">{groupData.nodeCount} nodes</span>
        </span>

        <div className="workflow-group-box__actions">
          <button
            type="button"
            className="workflow-group-box__btn workflow-group-box__btn--run"
            title={`Run ${groupData.label}`}
            disabled={groupData.isRunning}
            onClick={(event) => {
              event.stopPropagation();
              onRunGroup?.(groupData.groupId);
            }}
          >
            <Play size={12} />
            Run
          </button>
          <button
            type="button"
            className="workflow-group-box__btn"
            title={`Ungroup ${groupData.label} (keep nodes)`}
            disabled={groupData.isRunning}
            onClick={(event) => {
              event.stopPropagation();
              onUngroupGroup?.(groupData.groupId);
            }}
          >
            <Unlink size={12} />
            Ungroup
          </button>
          <button
            type="button"
            className="workflow-group-box__btn workflow-group-box__btn--danger"
            title={`Delete ${groupData.label} and all nodes inside`}
            disabled={groupData.isRunning}
            onClick={(event) => {
              event.stopPropagation();
              onDeleteGroupNodes?.(groupData.groupId);
            }}
          >
            <Trash2 size={12} />
            Delete
          </button>
        </div>
      </div>

      <div
        className="workflow-group-box__resize nodrag nopan"
        onMouseDown={startResize}
        title="Drag to resize group area"
      />
    </div>
  );
}

export default memo(GroupBackgroundNode);
