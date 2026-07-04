import {
  addEdge,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
  type Connection,
  type Edge,
  type Node,
} from '@xyflow/react';
import type { CommandNodeData } from '../types';
import { branchEdgeMeta } from './workflowBranching';

type NodeLike = Node<CommandNodeData>;

export function createWorkflowEdge(
  connection: Connection,
  nodes: NodeLike[],
  edges: Edge[],
): Edge | null {
  if (!connection.source || !connection.target || connection.source === connection.target) {
    return null;
  }

  const duplicate = edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      (edge.targetHandle ?? null) === (connection.targetHandle ?? null),
  );
  if (duplicate) return null;

  const sourceNode = nodes.find((node) => node.id === connection.source);
  const branchMeta = branchEdgeMeta(sourceNode, connection.sourceHandle);
  return {
    id: `${connection.source}-${connection.target}-${Date.now()}`,
    source: connection.source,
    target: connection.target,
    sourceHandle: connection.sourceHandle,
    targetHandle: connection.targetHandle,
    animated: true,
    data: branchMeta.data,
    label: branchMeta.label,
    style: branchMeta.style,
    labelStyle: branchMeta.labelStyle,
  };
}

export function reconnectEdgesAfterDelete(
  deletedNodes: NodeLike[],
  nodes: NodeLike[],
  edges: Edge[],
): Edge[] {
  const deletedIds = new Set(deletedNodes.map((node) => node.id));
  let nextEdges = edges.filter(
    (edge) => !deletedIds.has(edge.source) && !deletedIds.has(edge.target),
  );

  for (const deletedNode of deletedNodes) {
    const incomers = getIncomers(deletedNode, nodes, edges);
    const outgoers = getOutgoers(deletedNode, nodes, edges);
    const connected = getConnectedEdges([deletedNode], edges);

    for (const incomer of incomers) {
      for (const outgoer of outgoers) {
        const bridgeSource = connected.find((edge) => edge.source === incomer.id)?.sourceHandle ?? null;
        const created = createWorkflowEdge(
          {
            source: incomer.id,
            target: outgoer.id,
            sourceHandle: bridgeSource,
            targetHandle: null,
          },
          nodes,
          nextEdges,
        );
        if (created) {
          nextEdges = addEdge(created, nextEdges);
        }
      }
    }
  }

  return nextEdges;
}
