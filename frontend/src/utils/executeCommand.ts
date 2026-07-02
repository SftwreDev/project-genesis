import type { Edge, Node } from '@xyflow/react';
import { getCommandById, isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData, CommandResponse, TerminalLog } from '../types';
import { formatCommandPreview } from './commandPreview';
import { executeDelayNode, executeScheduleNode } from './workflowExecution';
import {
  formatKubeContextLabel,
  getDirectInheritedContext,
  getDirectInheritedNamespace,
  parseKubeContext,
  resolveEffectiveKubeContext,
  resolveEffectiveNamespace,
  resolveEffectiveParams,
} from './workflowContext';
import type { RunController } from './runControl';

export type ExecuteGraph = {
  nodes: Node<CommandNodeData>[];
  edges: Edge[];
  globalContext?: string;
};

export function formatOutput(output: unknown): string {
  if (Array.isArray(output)) return output.map(String).join('\n');
  if (typeof output === 'string') return output;
  return JSON.stringify(output, null, 2);
}

export function appendCommandOutput(
  appendLog: (level: TerminalLog['level'], message: string) => void,
  output: unknown,
) {
  if (output === undefined || output === null) return;

  const text = formatOutput(output).trimEnd();
  if (!text) return;

  appendLog('output', '── output ──');
  appendLog('output', text);
}

type ExecuteCallbacks = {
  appendLog: (level: TerminalLog['level'], message: string) => void;
  updateNodeStatus: (nodeId: string, status: CommandNodeData['runStatus']) => void;
  updateNodeTimer?: (
    nodeId: string,
    timer: { seconds: number | null; totalSeconds?: number | null },
  ) => void;
  control?: RunController;
};

function toolPreview(node: Node<CommandNodeData>): string {
  if (node.data.commandId === 'workflow-delay') {
    return `wait ${node.data.params.delaySeconds || '5'}s`;
  }
  if (node.data.commandId === 'workflow-schedule') {
    return `schedule ${node.data.params.scheduledAt || '<time>'}`;
  }
  return node.data.label;
}

async function streamPodLogsToTerminal(
  params: Record<string, string>,
  appendLog: ExecuteCallbacks['appendLog'],
  control?: RunController,
): Promise<{ ok: boolean; stopped?: boolean; status?: string; message?: string }> {
  appendLog(
    'system',
    `  waiting for pod to leave Pending/Creating (up to ${params.waitSeconds || '3600'}s)...`,
  );
  appendLog(
    'system',
    `  streaming logs (follow ${params.followSeconds || '30'}s, tail ${params.tailLines || '200'})...`,
  );
  appendLog('output', '── pod logs (live) ──');

  const response = await fetch('/api/commands/stream-pod-logs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
    signal: control?.signal,
  });

  if (!response.ok) {
    const errorText = (await response.text()).trim() || 'Could not stream pod logs';
    appendLog('error', `❌ ${errorText}`);
    return { ok: false };
  }

  if (!response.body) {
    appendLog('error', '❌ Stream body missing from backend');
    return { ok: false };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = '';

  while (true) {
    if (control && !(await control.checkpoint())) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, stopped: true };
    }

    const { done, value } = await reader.read();
    if (done) break;

    pending += decoder.decode(value, { stream: true });
    const lines = pending.split('\n');
    pending = lines.pop() ?? '';

    for (const line of lines) {
      appendLog('output', line.length > 0 ? line : ' ');
    }
  }

  if (pending.trim()) {
    appendLog('output', pending);
  }

  return {
    ok: true,
    message: `Streamed logs from pod ${params.podName ?? 'unknown'}`,
  };
}

export async function executeCommandNode(
  node: Node<CommandNodeData>,
  callbacks: ExecuteCallbacks,
  graph?: ExecuteGraph,
): Promise<boolean> {
  const { appendLog, updateNodeStatus, control } = callbacks;
  const command = getCommandById(node.data.commandId);
  const label = command?.label ?? node.data.commandId;
  const effectiveParams = graph
    ? resolveEffectiveParams(node, graph.nodes, graph.edges, graph.globalContext ?? '')
    : node.data.params;

  if (control && !(await control.checkpoint())) {
    return false;
  }

  if (node.data.commandId === 'workflow-delay') {
    return executeDelayNode(node, callbacks);
  }

  if (node.data.commandId === 'workflow-schedule') {
    return executeScheduleNode(node, callbacks);
  }

  updateNodeStatus(node.id, 'running');

  if (graph) {
    const inheritedCtx = getDirectInheritedContext(node.id, graph.nodes, graph.edges);
    const ownCtx = parseKubeContext(node.data.context ?? '');
    const effectiveContext = resolveEffectiveKubeContext(
      node.id,
      graph.nodes,
      graph.edges,
      graph.globalContext ?? '',
    );
    const inheritedNs = getDirectInheritedNamespace(node.id, graph.nodes, graph.edges);
    const ownNs = node.data.params.namespace?.trim() ?? '';
    const effectiveNs = resolveEffectiveNamespace(node.id, graph.nodes, graph.edges);

    if (effectiveContext) {
      const source = ownCtx ? 'node override' : inheritedCtx ? 'inherited' : 'global default';
      appendLog(
        'system',
        `  using kube context (${source}): --context ${formatKubeContextLabel(effectiveContext)}`,
      );
    }

    if (effectiveNs) {
      const source = ownNs ? 'node override' : inheritedNs ? 'inherited' : 'default';
      appendLog('system', `  using namespace (${source}): ${effectiveNs}`);
    }
  }

  appendLog(
    'run',
    `$ ${
      command
        ? formatCommandPreview(
            node.data.commandId,
            command.kubectl,
            effectiveParams,
            effectiveParams.context,
          )
        : toolPreview(node)
    }`,
  );

  if (node.data.commandId === 'get-pod-logs') {
    try {
      const result = await streamPodLogsToTerminal(effectiveParams, appendLog, control);
      if (result.stopped || control?.isStopped()) {
        updateNodeStatus(node.id, 'idle');
        return false;
      }
      if (!result.ok) {
        updateNodeStatus(node.id, 'error');
        return false;
      }

      updateNodeStatus(node.id, 'success');
      appendLog('success', `✓ [${label}] ${result.message ?? 'Logs streamed'}`);
      return true;
    } catch (error) {
      if (control?.isStopped() || (error instanceof DOMException && error.name === 'AbortError')) {
        updateNodeStatus(node.id, 'idle');
        return false;
      }
      updateNodeStatus(node.id, 'error');
      appendLog('error', `❌ [${label}] Could not stream pod logs.`);
      return false;
    }
  }

  try {
    const response = await fetch('/api/commands/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: node.data.commandId,
        params: effectiveParams,
      }),
      signal: control?.signal,
    });

    const data: CommandResponse = await response.json();

    if (!response.ok) {
      updateNodeStatus(node.id, 'error');
      appendLog('error', `❌ [${label}] ${data.error || 'Command failed'}`);
      if (data.status) appendLog('error', `  pod status: ${data.status}`);
      return false;
    }

    updateNodeStatus(node.id, 'success');
    appendLog('success', `✓ [${label}] ${data.message}`);
    if (data.status) appendLog('output', `  status: ${data.status}`);
    appendCommandOutput(appendLog, data.output);
    return true;
  } catch (error) {
    if (control?.isStopped() || (error instanceof DOMException && error.name === 'AbortError')) {
      updateNodeStatus(node.id, 'idle');
      return false;
    }
    updateNodeStatus(node.id, 'error');
    appendLog('error', `❌ [${label}] Could not reach Go backend.`);
    return false;
  }
}

export function isLocalWorkflowNode(commandId: string): boolean {
  return isWorkflowTool(commandId);
}
