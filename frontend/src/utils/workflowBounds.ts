import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData } from '../types';
import { getOutgoingEdges } from './workflowBranching';

export function isStartNode(node: Node<CommandNodeData>): boolean {
  return node.data.commandId === 'workflow-start';
}

export function isEndNode(node: Node<CommandNodeData>): boolean {
  return node.data.commandId === 'workflow-end';
}

export function isBoundaryNode(node: Node<CommandNodeData>): boolean {
  return isStartNode(node) || isEndNode(node);
}

export function segmentName(node: Node<CommandNodeData>, fallback: string): string {
  return node.data.params.segmentName?.trim() || fallback;
}

/** When Start is in candidates, return downstream scope. Otherwise null = no Start scoping. */
export function getStartScopedNodeIds(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  candidateIds: Set<string>,
): Set<string> | null {
  const startsInCandidates = nodes.filter((node) => isStartNode(node) && candidateIds.has(node.id));
  if (startsInCandidates.length === 0) {
    return null;
  }

  const scoped = new Set<string>();

  for (const start of startsInCandidates) {
    const queue = [start.id];
    scoped.add(start.id);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of getOutgoingEdges(current, edges)) {
        if (!candidateIds.has(edge.target) || scoped.has(edge.target)) continue;
        scoped.add(edge.target);
        queue.push(edge.target);
      }
    }
  }

  return scoped;
}

export function canvasHasStartNode(nodes: Node<CommandNodeData>[]): boolean {
  return nodes.some(isStartNode);
}

export function prioritizeStartNodes(order: Node<CommandNodeData>[]): Node<CommandNodeData>[] {
  const starts = order.filter(isStartNode);
  if (starts.length === 0) return order;
  const rest = order.filter((node) => !isStartNode(node));
  return [...starts, ...rest];
}

export function applyWorkflowBounds(
  order: Node<CommandNodeData>[],
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  candidateIds?: Set<string>,
): { order: Node<CommandNodeData>[]; error?: string } {
  const scopeIds = candidateIds ?? new Set(order.map((node) => node.id));
  const scope = getStartScopedNodeIds(nodes, edges, scopeIds);

  if (scope === null) {
    return { order };
  }

  if (scope.size === 0) {
    return { order: [], error: 'Add a Start node to the run or connect steps downstream of Start.' };
  }

  const filtered = order.filter((node) => scope.has(node.id));
  if (filtered.length === 0) {
    return { order: [], error: 'No steps reachable from Start node(s).' };
  }

  return { order: prioritizeStartNodes(filtered) };
}

export function markNodesOutsideScope(
  scope: Set<string>,
  candidateIds: Set<string>,
  nodes: Node<CommandNodeData>[],
  updateNodeStatus: (nodeId: string, status: CommandNodeData['runStatus']) => void,
) {
  for (const node of nodes) {
    if (!candidateIds.has(node.id)) continue;
    if (scope.has(node.id)) continue;
    updateNodeStatus(node.id, 'skipped');
  }
}
