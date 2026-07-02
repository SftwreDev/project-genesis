import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData } from '../types';

function compareCanvasPosition(
  a: Node<CommandNodeData>,
  b: Node<CommandNodeData>,
): number {
  if (a.position.y !== b.position.y) return a.position.y - b.position.y;
  return a.position.x - b.position.x;
}

function componentAnchor(
  nodes: Node<CommandNodeData>[],
  component: Set<string>,
): { y: number; x: number } {
  let minY = Infinity;
  let minX = Infinity;

  for (const node of nodes) {
    if (!component.has(node.id)) continue;
    if (node.position.y < minY || (node.position.y === minY && node.position.x < minX)) {
      minY = node.position.y;
      minX = node.position.x;
    }
  }

  return { y: minY, x: minX };
}

function sortComponentsByCanvas(
  components: Set<string>[],
  nodes: Node<CommandNodeData>[],
): Set<string>[] {
  return [...components].sort((left, right) => {
    const anchorLeft = componentAnchor(nodes, left);
    const anchorRight = componentAnchor(nodes, right);
    if (anchorLeft.y !== anchorRight.y) return anchorLeft.y - anchorRight.y;
    return anchorLeft.x - anchorRight.x;
  });
}

function topologicalSortNodes(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): { order: Node<CommandNodeData>[]; error?: string } {
  if (nodes.length === 0) {
    return { order: [], error: 'Add at least one command node to the canvas.' };
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const nodeIds = new Set(nodes.map((node) => node.id));
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

  const sortQueue = (ids: string[]) =>
    ids.sort((leftId, rightId) =>
      compareCanvasPosition(nodeById.get(leftId)!, nodeById.get(rightId)!),
    );

  const queue = sortQueue(
    nodes.filter((node) => (inDegree.get(node.id) ?? 0) === 0).map((node) => node.id),
  );

  const sorted: Node<CommandNodeData>[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    const node = nodeById.get(id);
    if (node) sorted.push(node);

    for (const next of adjacency.get(id) ?? []) {
      const degree = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, degree);
      if (degree === 0) {
        queue.push(next);
        sortQueue(queue);
      }
    }
  }

  if (sorted.length !== nodes.length) {
    return { order: [], error: 'Workflow has a cycle. Fix connections before running.' };
  }

  return { order: sorted };
}

type NodeIdSet = Set<string>;

function buildUndirectedAdjacency(nodeIds: NodeIdSet, edges: Edge[]): Map<string, Set<string>> {
  const neighbors = new Map<string, Set<string>>();

  for (const id of nodeIds) {
    neighbors.set(id, new Set());
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    neighbors.get(edge.source)?.add(edge.target);
    neighbors.get(edge.target)?.add(edge.source);
  }

  return neighbors;
}

function weaklyConnectedComponents(nodeIds: NodeIdSet, edges: Edge[]): NodeIdSet[] {
  const neighbors = buildUndirectedAdjacency(nodeIds, edges);
  const visited = new Set<string>();
  const components: NodeIdSet[] = [];

  for (const startId of nodeIds) {
    if (visited.has(startId)) continue;

    const component = new Set<string>();
    const queue = [startId];
    component.add(startId);
    visited.add(startId);

    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const next of neighbors.get(current) ?? []) {
        if (visited.has(next)) continue;
        visited.add(next);
        component.add(next);
        queue.push(next);
      }
    }

    components.push(component);
  }

  return components;
}

/** Use exact canvas selection only — do not pull in connected but unselected nodes. */
export function expandRunSelection(
  selectedIds: string[],
  nodes: Node<CommandNodeData>[],
  _edges: Edge[],
): string[] {
  const canvasIds = new Set(nodes.map((node) => node.id));
  return [...new Set(selectedIds.filter((id) => canvasIds.has(id)))];
}

export function topologicalSort(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): { order: Node<CommandNodeData>[]; error?: string } {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const components = weaklyConnectedComponents(nodeIds, edges);

  if (components.length <= 1) {
    return topologicalSortNodes(nodes, edges);
  }

  const order: Node<CommandNodeData>[] = [];

  for (const component of sortComponentsByCanvas(components, nodes)) {
    const islandNodes = nodes.filter((node) => component.has(node.id));
    const islandEdges = edges.filter(
      (edge) => component.has(edge.source) && component.has(edge.target),
    );
    const result = topologicalSortNodes(islandNodes, islandEdges);
    if (result.error) return result;
    order.push(...result.order);
  }

  return { order };
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
