import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData, TerminalLog, WorkflowGroup } from '../types';
import type { RunController } from './runControl';
import { resolveNextScheduleRun } from './scheduleRecurrence';

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

type WaitOptions = {
  onTick?: (remainingMs: number) => void;
  tickMs?: number;
  control?: RunController;
};

export async function waitDuration(
  ms: number,
  appendLog: (level: TerminalLog['level'], message: string) => void,
  label: string,
  options: WaitOptions = {},
): Promise<boolean> {
  if (ms <= 0) return true;

  const { onTick, tickMs = 1_000, control } = options;
  const started = Date.now();
  let lastLoggedMinute = -1;
  let lastTickSecond = -1;

  onTick?.(ms);

  while (Date.now() - started < ms) {
    if (control && !(await control.checkpoint())) return false;

    const remaining = ms - (Date.now() - started);
    const remainingSeconds = Math.ceil(remaining / 1_000);

    if (onTick && remainingSeconds !== lastTickSecond) {
      onTick(Math.max(0, remaining));
      lastTickSecond = remainingSeconds;
    }

    const remainingMinutes = Math.ceil(remaining / 60_000);
    if (remainingMinutes !== lastLoggedMinute && remaining >= 60_000) {
      appendLog('system', `  ${label}: ~${remainingMinutes}m remaining`);
      lastLoggedMinute = remainingMinutes;
    }

    const chunk = Math.min(remaining, tickMs);
    if (control) {
      if (!(await control.sleep(chunk))) return false;
    } else {
      await sleep(chunk);
    }
  }

  onTick?.(0);
  return true;
}

export function getEntryScheduleWait(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
): { waitMs: number; targetLabel: string; nodeId: string } | null {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const inDegree = new Map<string, number>();

  for (const node of nodes) {
    inDegree.set(node.id, 0);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    inDegree.set(edge.target, (inDegree.get(edge.target) ?? 0) + 1);
  }

  const entrySchedule = nodes.find(
    (node) =>
      node.data.commandId === 'workflow-schedule' && (inDegree.get(node.id) ?? 0) === 0,
  );
  if (!entrySchedule) return null;

  const resolution = resolveNextScheduleRun(entrySchedule.data.params);
  if ('error' in resolution) return null;

  return {
    waitMs: resolution.waitMs,
    targetLabel: resolution.summary,
    nodeId: entrySchedule.id,
  };
}

type ExecuteCallbacks = {
  appendLog: (level: TerminalLog['level'], message: string) => void;
  updateNodeStatus: (nodeId: string, status: CommandNodeData['runStatus']) => void;
  updateNodeTimer?: (
    nodeId: string,
    timer: { seconds: number | null; totalSeconds?: number | null },
  ) => void;
  control?: import('./runControl').RunController;
};

export async function executeDelayNode(
  node: Node<CommandNodeData>,
  { appendLog, updateNodeStatus, updateNodeTimer, control }: ExecuteCallbacks,
): Promise<boolean> {
  const raw = node.data.params.delaySeconds?.trim() || '5';
  const seconds = Number.parseInt(raw, 10);

  if (Number.isNaN(seconds) || seconds < 0) {
    updateNodeStatus(node.id, 'error');
    updateNodeTimer?.(node.id, { seconds: null, totalSeconds: null });
    appendLog('error', `❌ [Delay] Invalid delay seconds: "${raw}"`);
    return false;
  }

  updateNodeStatus(node.id, 'running');
  updateNodeTimer?.(node.id, { seconds, totalSeconds: seconds });
  appendLog('run', `⏳ [Delay] Waiting ${seconds}s before next step...`);

  const waited = await waitDuration(seconds * 1_000, appendLog, 'Delay', {
    tickMs: 250,
    control,
    onTick: (remainingMs) => {
      updateNodeTimer?.(node.id, {
        seconds: Math.ceil(remainingMs / 1_000),
        totalSeconds: seconds,
      });
    },
  });

  updateNodeTimer?.(node.id, { seconds: null, totalSeconds: null });

  if (!waited) {
    updateNodeStatus(node.id, 'idle');
    return false;
  }

  updateNodeStatus(node.id, 'success');
  appendLog('success', `✓ [Delay] Waited ${seconds}s`);
  return true;
}

export async function executeScheduleNode(
  node: Node<CommandNodeData>,
  { appendLog, updateNodeStatus, control }: ExecuteCallbacks,
): Promise<boolean> {
  const resolution = resolveNextScheduleRun(node.data.params);
  if ('error' in resolution) {
    updateNodeStatus(node.id, 'error');
    appendLog('error', `❌ [Schedule] ${resolution.error}`);
    return false;
  }

  const { waitMs, label, summary } = resolution;
  updateNodeStatus(node.id, 'running');

  if (waitMs <= 0) {
    updateNodeStatus(node.id, 'success');
    appendLog('success', `✓ [Schedule] ${summary} — target already reached, continuing`);
    return true;
  }

  appendLog('run', `⏰ [Schedule] ${summary}. Waiting until ${label}...`);
  const waited = await waitDuration(waitMs, appendLog, 'Schedule', { control });

  if (!waited) {
    updateNodeStatus(node.id, 'idle');
    return false;
  }

  updateNodeStatus(node.id, 'success');
  appendLog('success', `✓ [Schedule] ${summary} — target time reached, continuing`);
  return true;
}

export async function executeStartNode(
  node: Node<CommandNodeData>,
  { appendLog, updateNodeStatus }: ExecuteCallbacks,
): Promise<boolean> {
  const name = node.data.params.segmentName?.trim() || 'Main Workflow';

  updateNodeStatus(node.id, 'running');
  appendLog('run', `▶ [Start] ${name}`);
  updateNodeStatus(node.id, 'success');
  appendLog('success', `✓ [Start] "${name}" began`);
  return true;
}

export async function executeEndNode(
  node: Node<CommandNodeData>,
  { appendLog, updateNodeStatus }: ExecuteCallbacks,
): Promise<boolean> {
  const name = node.data.params.segmentName?.trim() || 'Main Workflow';

  updateNodeStatus(node.id, 'running');
  appendLog('run', `⏹ [End] ${name}`);
  updateNodeStatus(node.id, 'success');
  appendLog('success', `✓ [End] "${name}" finished`);
  return true;
}

export function syncNodeWorkflowGroups(
  nodes: Node<CommandNodeData>[],
  groups: WorkflowGroup[],
): Node<CommandNodeData>[] {
  const nodeToGroup = new Map<string, WorkflowGroup>();
  for (const group of groups) {
    for (const nodeId of group.nodeIds) {
      nodeToGroup.set(nodeId, group);
    }
  }

  return nodes.map((node) => {
    const group = nodeToGroup.get(node.id);
    return {
      ...node,
      data: {
        ...node.data,
        workflowGroupId: group?.id,
        workflowGroupName: group?.name,
        workflowGroupColor: group?.color,
      },
    };
  });
}

export function removeNodeFromGroups(groups: WorkflowGroup[], nodeId: string): WorkflowGroup[] {
  return groups
    .map((group) => ({
      ...group,
      nodeIds: group.nodeIds.filter((id) => id !== nodeId),
    }))
    .filter((group) => group.nodeIds.length > 0);
}
