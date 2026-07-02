import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData } from '../types';

/** Parse optional kube context name from node context field (kubectl --context). */
export function parseKubeContext(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (trimmed.startsWith('context=')) {
      return trimmed.slice('context='.length).trim();
    }

    return trimmed;
  }

  return '';
}

export function formatKubeContextLabel(context: string): string {
  return context.trim();
}

function upstreamNodeIds(targetId: string, edges: Edge[]): string[] {
  const visited = new Set<string>();
  const ordered: string[] = [];

  function visit(nodeId: string) {
    for (const edge of edges) {
      if (edge.target !== nodeId) continue;
      const source = edge.source;
      if (visited.has(source)) continue;
      visited.add(source);
      visit(source);
      ordered.push(source);
    }
  }

  visit(targetId);
  return ordered;
}

export function resolveInheritedKubeContext(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  let inherited = '';

  for (const upstreamId of upstreamNodeIds(nodeId, edges)) {
    const upstream = nodes.find((node) => node.id === upstreamId);
    const ctx = parseKubeContext(upstream?.data.context ?? '');
    if (ctx) inherited = ctx;
  }

  return inherited;
}

export function resolveEffectiveKubeContext(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  const own = parseKubeContext(nodes.find((node) => node.id === nodeId)?.data.context ?? '');
  if (own) return own;
  return resolveInheritedKubeContext(nodeId, nodes, edges);
}

export function resolveEffectiveParams(
  node: Node<CommandNodeData>,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): Record<string, string> {
  const effective = { ...node.data.params };

  for (const [key, value] of Object.entries(node.data.params)) {
    if (value.trim()) {
      effective[key] = value.trim();
    }
  }

  const kubeContext = resolveEffectiveKubeContext(node.id, nodes, edges);
  if (kubeContext) {
    effective.context = kubeContext;
  }

  return effective;
}

export function getDirectInheritedContext(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  return resolveInheritedKubeContext(nodeId, nodes, edges);
}
