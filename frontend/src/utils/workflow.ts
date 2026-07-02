import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData } from '../types';

export function topologicalSort(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): { order: Node<CommandNodeData>[]; error?: string } {
  if (nodes.length === 0) {
    return { order: [], error: 'Add at least one command node to the canvas.' };
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const inDegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const queue = nodes
    .filter((n) => (inDegree.get(n.id) ?? 0) === 0)
    .map((n) => n.id)
    .sort();

  const sorted: Node<CommandNodeData>[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodes.find((n) => n.id === id);
    if (node) sorted.push(node);

    for (const next of adjacency.get(id) ?? []) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
        queue.sort();
      }
    }
  }

  if (sorted.length !== nodes.length) {
    return { order: [], error: 'Workflow has a cycle. Fix connections before running.' };
  }

  return { order: sorted };
}

export function topologicalSortSubset(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  nodeIds: string[],
): { order: Node<CommandNodeData>[]; error?: string } {
  const allowed = new Set(nodeIds);
  const subsetNodes = nodes.filter((node) => allowed.has(node.id));
  const subsetEdges = edges.filter(
    (edge) => allowed.has(edge.source) && allowed.has(edge.target),
  );

  if (subsetNodes.length === 0) {
    return { order: [], error: 'This workflow group has no nodes left on the canvas.' };
  }

  return topologicalSort(subsetNodes, subsetEdges);
}

export const WORKFLOW_GROUP_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#fb923c', '#facc15'];

export function nextWorkflowGroupColor(existingCount: number): string {
  return WORKFLOW_GROUP_COLORS[existingCount % WORKFLOW_GROUP_COLORS.length];
}
