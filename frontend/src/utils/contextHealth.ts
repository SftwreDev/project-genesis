import type { Edge, Node } from '@xyflow/react';
import { isIntegrationCommand, isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData } from '../types';
import { formatKubeContextLabel, resolveEffectiveKubeContext } from './workflowContext';

export type ContextHealthStatus = 'connected' | 'expired' | 'unreachable' | 'unknown' | 'idle';

export type ContextHealthResponse = {
  ok: boolean;
  context: string;
  needsReauth: boolean;
  message?: string;
  error?: string;
};

export type ContextHealthCheck = {
  contextName: string;
  label: string;
  status: ContextHealthStatus;
  message: string;
  needsReauth: boolean;
};

const HEALTH_POLL_MS = 5 * 60 * 1000;

export function contextHealthPollIntervalMs(): number {
  return HEALTH_POLL_MS;
}

export function formatContextHealthLabel(contextName: string): string {
  const trimmed = contextName.trim();
  return trimmed ? formatKubeContextLabel(trimmed) : 'default';
}

export function statusFromHealthResponse(response: ContextHealthResponse): ContextHealthStatus {
  if (response.ok) return 'connected';
  if (response.needsReauth) return 'expired';
  return 'unreachable';
}

export async function checkContextHealth(contextName: string): Promise<ContextHealthCheck> {
  const label = formatContextHealthLabel(contextName);
  const query = contextName.trim()
    ? `?context=${encodeURIComponent(contextName.trim())}`
    : '';

  try {
    const response = await fetch(`/api/contexts/health${query}`);
    const data = (await response.json()) as ContextHealthResponse;
    const status = statusFromHealthResponse(data);

    return {
      contextName: contextName.trim(),
      label,
      status,
      needsReauth: Boolean(data.needsReauth),
      message:
        data.message ||
        data.error ||
        (data.ok ? 'Context is connected.' : 'Context health check failed.'),
    };
  } catch (error) {
    return {
      contextName: contextName.trim(),
      label,
      status: 'unreachable',
      needsReauth: false,
      message: error instanceof Error ? error.message : 'Could not reach backend for context health check.',
    };
  }
}

export function collectWorkflowKubeContexts(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  globalContext = '',
): string[] {
  const contexts = new Set<string>();

  for (const node of nodes) {
    if (isIntegrationCommand(node.data.commandId) || isWorkflowTool(node.data.commandId)) {
      continue;
    }

    contexts.add(resolveEffectiveKubeContext(node.id, nodes, edges, globalContext).trim());
  }

  return [...contexts].sort((a, b) => a.localeCompare(b));
}

export async function validateWorkflowContexts(
  targetNodes: Node<CommandNodeData>[],
  allNodes: Node<CommandNodeData>[],
  edges: Edge[],
  globalContext = '',
): Promise<{ ok: true } | { ok: false; message: string }> {
  const contexts = new Set<string>();

  for (const node of targetNodes) {
    if (isIntegrationCommand(node.data.commandId) || isWorkflowTool(node.data.commandId)) {
      continue;
    }

    contexts.add(resolveEffectiveKubeContext(node.id, allNodes, edges, globalContext).trim());
  }

  const contextList = [...contexts].sort((a, b) => a.localeCompare(b));
  if (contextList.length === 0) {
    return { ok: true };
  }

  for (const contextName of contextList) {
    const result = await checkContextHealth(contextName);
    if (result.status === 'connected') continue;

    const prefix = result.label === 'default' ? 'Default kube context' : `Context "${result.label}"`;

    if (result.needsReauth) {
      return {
        ok: false,
        message: `❌ ${prefix} expired or unauthorized. Re-login with kubectl before running.`,
      };
    }

    return {
      ok: false,
      message: `❌ ${prefix} unreachable: ${result.message}`,
    };
  }

  return { ok: true };
}
