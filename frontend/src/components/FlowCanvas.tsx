import { useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  MiniMap,
  Controls,
  Background,
  BackgroundVariant,
  useReactFlow,
  type Connection,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps,
  type OnEdgesChange,
  type OnNodesChange,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import CommandNode from './CommandNode';
import GroupBackgroundNode from './GroupBackgroundNode';
import { DRAG_TYPE } from './CommandPalette';
import { createCommandNodeData, getCommandAccentColor, getCommandById } from '../data/k8sCommands';
import type { CommandNodeData, WorkflowGroup } from '../types';
import {
  GROUP_BACKGROUND_PREFIX,
  resolveGroupFrame,
} from '../utils/workflowSignature';

type Props = {
  nodes: Node<CommandNodeData>[];
  edges: Edge[];
  workflowGroups: WorkflowGroup[];
  onNodesChange: OnNodesChange<Node<CommandNodeData>>;
  onEdgesChange: OnEdgesChange<Edge>;
  setNodes: React.Dispatch<React.SetStateAction<Node<CommandNodeData>[]>>;
  onNodeSelect: (node: Node<CommandNodeData> | null) => void;
  onSelectionChange: (nodeIds: string[]) => void;
  onRunNode: (nodeId: string) => void;
  onDeleteNode: (nodeId: string) => void;
  onRenameCardTitle: (nodeId: string, cardTitle: string) => void;
  onRunGroup: (groupId: string) => void;
  onUngroupGroup: (groupId: string) => void;
  onDeleteGroupNodes: (groupId: string) => void;
  onResizeGroup: (groupId: string, frame: import('../types').WorkflowGroupFrame) => void;
  onNodesDelete: (deleted: Node<CommandNodeData>[]) => void;
  highlightedGroupId: string | null;
  runningGroupIds: Set<string>;
  isRunning: boolean;
  globalContext?: string;
  onConnect: (connection: Connection) => void;
  onRecordHistory?: () => void;
};

function isGroupBackgroundNode(id: string) {
  return id.startsWith(GROUP_BACKGROUND_PREFIX);
}

export default function FlowCanvas({
  nodes,
  edges,
  workflowGroups,
  onNodesChange,
  onEdgesChange,
  setNodes,
  onNodeSelect,
  onSelectionChange,
  onRunNode,
  onDeleteNode,
  onRenameCardTitle,
  onRunGroup,
  onUngroupGroup,
  onDeleteGroupNodes,
  onResizeGroup,
  onNodesDelete,
  highlightedGroupId,
  runningGroupIds,
  isRunning,
  globalContext = '',
  onConnect: onConnectProp,
  onRecordHistory,
}: Props) {
  const { screenToFlowPosition } = useReactFlow();
  const commandCallbacksRef = useRef({
    onRunNode,
    onDeleteNode,
    onRenameCardTitle,
    isRunning,
    globalContext,
    nodes,
    edges,
  });
  commandCallbacksRef.current = {
    onRunNode,
    onDeleteNode,
    onRenameCardTitle,
    isRunning,
    globalContext,
    nodes,
    edges,
  };

  const groupCallbacksRef = useRef({
    onRunGroup,
    onUngroupGroup,
    onDeleteGroupNodes,
    onResizeGroup,
  });
  groupCallbacksRef.current = {
    onRunGroup,
    onUngroupGroup,
    onDeleteGroupNodes,
    onResizeGroup,
  };

  const groupBackgroundNodes = useMemo(() => {
    return workflowGroups.flatMap((group) => {
      const groupNodes = nodes.filter((node) => group.nodeIds.includes(node.id));
      const frame = resolveGroupFrame(group, groupNodes);
      if (!frame) return [];

      return [
        {
          id: `${GROUP_BACKGROUND_PREFIX}${group.id}`,
          type: 'groupBackground',
          position: { x: frame.x, y: frame.y },
          data: {
            groupId: group.id,
            label: group.name,
            color: group.color,
            nodeCount: group.nodeIds.length,
            isRunning: runningGroupIds.has(group.id),
            isHighlighted: highlightedGroupId === group.id,
            frame,
          },
          style: {
            width: frame.width,
            height: frame.height,
            zIndex: 0,
          },
          draggable: false,
          selectable: false,
          focusable: false,
          connectable: false,
        } satisfies Node,
      ];
    });
  }, [highlightedGroupId, nodes, runningGroupIds, workflowGroups]);

  const commandNodes = useMemo(
    () => nodes,
    [nodes],
  );

  const displayNodes = useMemo(
    () => [...groupBackgroundNodes, ...commandNodes] as Node<CommandNodeData>[],
    [commandNodes, groupBackgroundNodes],
  );

  const nodeTypes = useMemo(
    () => ({
      command: (props: NodeProps) => {
        const callbacks = commandCallbacksRef.current;
        return (
          <CommandNode
            {...props}
            onRunNode={callbacks.onRunNode}
            onDeleteNode={callbacks.onDeleteNode}
            onRenameCardTitle={callbacks.onRenameCardTitle}
            isRunning={callbacks.isRunning}
            globalContext={callbacks.globalContext}
            workflowNodes={callbacks.nodes}
            workflowEdges={callbacks.edges}
          />
        );
      },
      groupBackground: (props: NodeProps) => {
        const callbacks = groupCallbacksRef.current;
        return (
          <GroupBackgroundNode
            {...props}
            onRunGroup={callbacks.onRunGroup}
            onUngroupGroup={callbacks.onUngroupGroup}
            onDeleteGroupNodes={callbacks.onDeleteGroupNodes}
            onResizeGroup={callbacks.onResizeGroup}
          />
        );
      },
    }),
    [],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange[]) => {
      const filtered = changes.filter(
        (change) => !('id' in change && isGroupBackgroundNode(change.id)),
      ) as NodeChange<Node<CommandNodeData>>[];
      if (filtered.length > 0) {
        onNodesChange(filtered);
      }
    },
    [onNodesChange],
  );

  const onConnect = useCallback(
    (params: Connection) => onConnectProp(params),
    [onConnectProp],
  );

  const handleNodesDelete = useCallback(
    (deleted: Node[]) => {
      const commandNodesDeleted = deleted.filter(
        (node) => !isGroupBackgroundNode(node.id),
      ) as Node<CommandNodeData>[];
      if (commandNodesDeleted.length === 0) return;
      onNodesDelete(commandNodesDeleted);
    },
    [onNodesDelete],
  );

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const commandId = event.dataTransfer.getData(DRAG_TYPE);
      const command = getCommandById(commandId);
      if (!command) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      const id = `${command.id}-${Date.now()}`;

      onRecordHistory?.();
      setNodes((nds) => {
        const newNode: Node<CommandNodeData> = {
          id,
          type: 'command',
          position,
          data: createCommandNodeData(command),
        };
        onNodeSelect(newNode);
        return nds.concat(newNode);
      });
    },
    [onNodeSelect, onRecordHistory, screenToFlowPosition, setNodes],
  );

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selectedNodes }) => {
      const commandNodesSelected = selectedNodes.filter((node) => !isGroupBackgroundNode(node.id));
      onSelectionChange(commandNodesSelected.map((node) => node.id));
      if (commandNodesSelected.length === 1) {
        onNodeSelect(commandNodesSelected[0] as Node<CommandNodeData>);
      } else {
        onNodeSelect(null);
      }
    },
    [onNodeSelect, onSelectionChange],
  );

  return (
    <div className="flow-canvas" onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={displayNodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onNodesDelete={handleNodesDelete}
        onSelectionChange={handleSelectionChange}
        deleteKeyCode={['Backspace', 'Delete']}
        edgesFocusable
        edgesReconnectable={false}
        connectOnClick={false}
        onNodeClick={(_, node) => {
          if (isGroupBackgroundNode(node.id)) return;
          onNodeSelect(node as Node<CommandNodeData>);
        }}
        onPaneClick={() => onNodeSelect(null)}
        nodesDraggable
        elementsSelectable
        selectionOnDrag
        panOnDrag={[1, 2]}
        multiSelectionKeyCode="Shift"
        elevateNodesOnSelect
        minZoom={0.15}
        maxZoom={2}
        defaultEdgeOptions={{
          animated: true,
          style: { stroke: '#569cd6', strokeWidth: 2 },
          interactionWidth: 24,
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Controls className="flow-canvas__controls" />
        <MiniMap
          className="flow-canvas__minimap"
          nodeColor={(node) => {
            if (isGroupBackgroundNode(node.id)) {
              return (node.data as { color?: string }).color ?? '#38bdf8';
            }
            const data = node.data as CommandNodeData;
            return getCommandAccentColor(data.commandId);
          }}
          maskColor="rgba(15, 23, 42, 0.75)"
        />
        <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#334155" />
      </ReactFlow>

      {nodes.length === 0 && (
        <div className="flow-canvas__empty">
          <h3>Build your kubectl workflow</h3>
          <p>Drag commands from the left panel, connect nodes top to bottom, configure inputs on the right, then run.</p>
        </div>
      )}
    </div>
  );
}
