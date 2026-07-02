import type { Edge, Node } from '@xyflow/react';
import { getCommandById, isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData } from '../types';
import { generateYaml } from './commandPreview';

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

function downstreamNodeIds(sourceId: string, edges: Edge[]): string[] {
  const ordered: string[] = [];
  const visited = new Set<string>();
  const queue = [sourceId];

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const edge of edges) {
      if (edge.source !== current || visited.has(edge.target)) continue;
      visited.add(edge.target);
      ordered.push(edge.target);
      queue.push(edge.target);
    }
  }

  return ordered;
}

function parseNamespace(value: string | undefined): string {
  return value?.trim() ?? '';
}

export function nodeHasNamespaceField(node: Node<CommandNodeData>): boolean {
  const command = getCommandById(node.data.commandId);
  return Boolean(command?.fields.some((field) => field.key === 'namespace'));
}

export function namespaceDefaultForNode(node: Node<CommandNodeData>): string {
  const command = getCommandById(node.data.commandId);
  const field = command?.fields.find((item) => item.key === 'namespace');
  return field?.defaultValue?.trim() ?? '';
}

/** Namespace explicitly set on this node (factory default does not count). */
export function nodeOwnNamespace(node: Node<CommandNodeData>): string {
  if (!nodeHasNamespaceField(node)) return '';

  const raw = parseNamespace(node.data.params.namespace);
  if (!raw) return '';

  const defaultNs = namespaceDefaultForNode(node);
  if (defaultNs && raw === defaultNs) return '';

  return raw;
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

export function resolveInheritedNamespace(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  let inherited = '';

  for (const upstreamId of upstreamNodeIds(nodeId, edges)) {
    const upstream = nodes.find((node) => node.id === upstreamId);
    if (!upstream || !nodeHasNamespaceField(upstream)) continue;

    const effective = resolveEffectiveNamespace(upstreamId, nodes, edges);
    if (effective) inherited = effective;
  }

  return inherited;
}

export function resolveEffectiveKubeContext(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  globalContext = '',
): string {
  const own = parseKubeContext(nodes.find((node) => node.id === nodeId)?.data.context ?? '');
  if (own) return own;

  const inherited = resolveInheritedKubeContext(nodeId, nodes, edges);
  if (inherited) return inherited;

  return globalContext.trim();
}

export function resolveEffectiveNamespace(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node || !nodeHasNamespaceField(node)) return '';

  const own = nodeOwnNamespace(node);
  if (own) return own;

  return resolveInheritedNamespace(nodeId, nodes, edges);
}

export function resolveEffectiveParams(
  node: Node<CommandNodeData>,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  globalContext = '',
): Record<string, string> {
  const effective = { ...node.data.params };

  for (const [key, value] of Object.entries(node.data.params)) {
    if (value.trim()) {
      effective[key] = value.trim();
    }
  }

  const kubeContext = resolveEffectiveKubeContext(node.id, nodes, edges, globalContext);
  if (kubeContext) {
    effective.context = kubeContext;
  }

  const namespace = resolveEffectiveNamespace(node.id, nodes, edges);
  if (namespace) {
    effective.namespace = namespace;
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

export function getDirectInheritedNamespace(
  nodeId: string,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): string {
  return resolveInheritedNamespace(nodeId, nodes, edges);
}

function refreshNodeYaml(node: Node<CommandNodeData>, params: Record<string, string>): string {
  if (isWorkflowTool(node.data.commandId)) {
    return `# Workflow tool: ${node.data.label}`;
  }
  return generateYaml(node.data.commandId, params);
}

function applyInheritanceToNode(
  node: Node<CommandNodeData>,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  _globalContext = '',
): Node<CommandNodeData> {
  let params = node.data.params;
  let context = node.data.context ?? '';
  let changed = false;

  if (nodeHasNamespaceField(node) && !nodeOwnNamespace(node)) {
    const inheritedNs = resolveInheritedNamespace(node.id, nodes, edges);
    if (inheritedNs && params.namespace !== inheritedNs) {
      params = { ...params, namespace: inheritedNs };
      changed = true;
    }
  }

  if (!parseKubeContext(context)) {
    const inheritedCtx = resolveInheritedKubeContext(node.id, nodes, edges);
    if (inheritedCtx && context !== inheritedCtx) {
      context = inheritedCtx;
      changed = true;
    }
  }

  if (!changed) return node;

  return {
    ...node,
    data: {
      ...node.data,
      params,
      context,
      yamlContent: refreshNodeYaml(node, params),
    },
  };
}

/** Copy inherited namespace/context into node params when connected or upstream changes. */
export function syncWorkflowInheritance(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  startNodeId: string,
  globalContext = '',
): Node<CommandNodeData>[] {
  const ordered = [startNodeId, ...downstreamNodeIds(startNodeId, edges)];
  let next = nodes;

  for (const nodeId of ordered) {
    next = next.map((node) => {
      if (node.id !== nodeId) return node;
      return applyInheritanceToNode(node, next, edges, globalContext);
    });
  }

  return next;
}

/** Drop context values that were synced from a previous global default (not user/upstream overrides). */
export function clearBakedGlobalContext(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  previousGlobal: string,
): Node<CommandNodeData>[] {
  const prev = previousGlobal.trim();
  if (!prev) return nodes;

  return nodes.map((node) => {
    const own = parseKubeContext(node.data.context ?? '');
    if (own !== prev) return node;

    const inherited = resolveInheritedKubeContext(node.id, nodes, edges);
    if (inherited) return node;

    return {
      ...node,
      data: {
        ...node.data,
        context: '',
      },
    };
  });
}

/** Drop redundant copies of the active global context stored on node fields. */
export function clearRedundantGlobalContext(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  activeGlobal: string,
): Node<CommandNodeData>[] {
  const active = activeGlobal.trim();
  if (!active) return nodes;

  return nodes.map((node) => {
    const own = parseKubeContext(node.data.context ?? '');
    if (own !== active) return node;

    const inherited = resolveInheritedKubeContext(node.id, nodes, edges);
    if (inherited) return node;

    return {
      ...node,
      data: {
        ...node.data,
        context: '',
      },
    };
  });
}

export function refreshNodesForGlobalContext(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  previousGlobal: string,
  activeGlobal: string,
): Node<CommandNodeData>[] {
  let next = clearBakedGlobalContext(nodes, edges, previousGlobal);
  next = clearRedundantGlobalContext(next, edges, activeGlobal);
  return syncAllWorkflowInheritance(next, edges, activeGlobal);
}

/** Re-apply inheritance for every node after global context changes. */
export function syncAllWorkflowInheritance(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  globalContext = '',
): Node<CommandNodeData>[] {
  let next = nodes;
  for (const node of nodes) {
    next = syncWorkflowInheritance(next, edges, node.id, globalContext);
  }
  return next;
}
