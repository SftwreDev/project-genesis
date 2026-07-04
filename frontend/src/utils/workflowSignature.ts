import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData, WorkflowGroup, WorkflowGroupFrame } from '../types';

const NODE_WIDTH = 320;
const NODE_HEIGHT = 280;
const GROUP_PADDING = 28;
const GROUP_HEADER = 42;
const MIN_GROUP_WIDTH = 360;
const MIN_GROUP_HEIGHT = 220;

export function workflowSignature(nodeIds: string[], edges: Edge[]): string {
  const ids = [...nodeIds].sort();
  const edgeKeys = edges
    .filter((edge) => ids.includes(edge.source) && ids.includes(edge.target))
    .map((edge) => `${edge.source}>${edge.target}`)
    .sort();
  return `flow:${ids.join(',')}|${edgeKeys.join(',')}`;
}

export function fullCanvasSignature(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  return workflowSignature(
    nodes.map((node) => node.id),
    edges,
  );
}

export function singleNodeSignature(node: Node<CommandNodeData>): string {
  return `node:${node.id}:${node.data.commandId}`;
}

export function getNodeCardTitle(node: Pick<Node<CommandNodeData>, 'data'>): string {
  return node.data.cardTitle?.trim() || node.data.label;
}

export function parseSingleNodeSignature(
  signature?: string,
): { nodeId: string; commandId: string } | null {
  if (!signature?.startsWith('node:')) return null;

  const rest = signature.slice('node:'.length);
  const separator = rest.indexOf(':');
  if (separator <= 0) return null;

  return {
    nodeId: rest.slice(0, separator),
    commandId: rest.slice(separator + 1),
  };
}

export function groupSignature(groupId: string, nodeIds: string[], edges: Edge[]): string {
  return `group:${groupId}:${workflowSignature(nodeIds, edges)}`;
}

export function groupTerminalSignature(groupId: string): string {
  return `group:${groupId}`;
}

export function estimateGroupBounds(nodes: Node<CommandNodeData>[]) {
  if (nodes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const node of nodes) {
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + NODE_WIDTH);
    maxY = Math.max(maxY, node.position.y + NODE_HEIGHT);
  }

  return {
    x: minX - GROUP_PADDING,
    y: minY - GROUP_PADDING - GROUP_HEADER,
    width: maxX - minX + GROUP_PADDING * 2,
    height: maxY - minY + GROUP_PADDING * 2 + GROUP_HEADER,
  };
}

function unionFrames(a: WorkflowGroupFrame, b: WorkflowGroupFrame): WorkflowGroupFrame {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export function resolveGroupFrame(
  group: WorkflowGroup,
  groupNodes: Node<CommandNodeData>[],
): WorkflowGroupFrame | null {
  const auto = estimateGroupBounds(groupNodes);
  if (!auto && !group.frame) return null;
  if (!auto) return group.frame ?? null;
  if (!group.frame) return auto;
  return unionFrames(auto, group.frame);
}

export function clampGroupFrame(frame: WorkflowGroupFrame): WorkflowGroupFrame {
  return {
    ...frame,
    width: Math.max(MIN_GROUP_WIDTH, frame.width),
    height: Math.max(MIN_GROUP_HEIGHT, frame.height),
  };
}

export const GROUP_MIN_WIDTH = MIN_GROUP_WIDTH;
export const GROUP_MIN_HEIGHT = MIN_GROUP_HEIGHT;

export const GROUP_BACKGROUND_PREFIX = '__group-bg-';
