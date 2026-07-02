import type { Edge, Node } from '@xyflow/react';
import type { CommandNodeData, TerminalLog, WorkflowBranch } from '../types';
import { isEndNode, isStartNode } from './workflowBounds';

export function isConditionNode(node: Node<CommandNodeData>): boolean {
  return node.data.commandId === 'workflow-condition';
}

export function graphHasConditionNodes(nodes: Node<CommandNodeData>[]): boolean {
  return nodes.some(isConditionNode);
}

export function edgeBranch(edge: Edge): WorkflowBranch | 'default' {
  if (edge.sourceHandle === 'success' || edge.sourceHandle === 'failure') {
    return edge.sourceHandle;
  }

  const dataBranch = (edge.data as { branch?: WorkflowBranch } | undefined)?.branch;
  if (dataBranch === 'success' || dataBranch === 'failure') {
    return dataBranch;
  }

  return 'default';
}

export function getOutgoingEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter((edge) => edge.source === nodeId);
}

export function getIncomingEdges(nodeId: string, edges: Edge[]): Edge[] {
  return edges.filter((edge) => edge.target === nodeId);
}

function markSubtreeSkipped(
  rootId: string,
  skipped: Set<string>,
  runNodeIds: Set<string>,
  edges: Edge[],
) {
  const queue = [rootId];

  while (queue.length > 0) {
    const id = queue.shift()!;
    if (skipped.has(id)) continue;
    skipped.add(id);

    for (const edge of getOutgoingEdges(id, edges)) {
      if (runNodeIds.has(edge.target)) {
        queue.push(edge.target);
      }
    }
  }
}

export function collectInactiveBranchNodes(
  conditionId: string,
  activeBranch: WorkflowBranch,
  runNodeIds: Set<string>,
  edges: Edge[],
): Set<string> {
  const inactiveBranch: WorkflowBranch = activeBranch === 'success' ? 'failure' : 'success';
  const skipped = new Set<string>();

  for (const edge of getOutgoingEdges(conditionId, edges)) {
    if (!runNodeIds.has(edge.target)) continue;
    if (edgeBranch(edge) !== inactiveBranch) continue;
    markSubtreeSkipped(edge.target, skipped, runNodeIds, edges);
  }

  return skipped;
}

function skipNonConditionChildren(
  nodeId: string,
  skipped: Set<string>,
  runNodeIds: Set<string>,
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));

  for (const edge of getOutgoingEdges(nodeId, edges)) {
    if (!runNodeIds.has(edge.target) || skipped.has(edge.target)) continue;
    const child = nodeById.get(edge.target);
    if (!child || isConditionNode(child)) continue;
    markSubtreeSkipped(edge.target, skipped, runNodeIds, edges);
  }
}

function isNodeReady(
  nodeId: string,
  executed: Set<string>,
  skipped: Set<string>,
  runNodeIds: Set<string>,
  edges: Edge[],
): boolean {
  const parents = getIncomingEdges(nodeId, edges).filter((edge) => runNodeIds.has(edge.source));
  const activeParents = parents.filter((edge) => !skipped.has(edge.source));

  if (activeParents.length === 0) return true;

  return activeParents.every((edge) => executed.has(edge.source));
}

type BranchRunOptions = {
  appendLog: (level: TerminalLog['level'], message: string) => void;
  updateNodeStatus: (nodeId: string, status: CommandNodeData['runStatus']) => void;
  executeNode: (node: Node<CommandNodeData>) => Promise<boolean>;
  checkpoint: () => Promise<boolean>;
};

export async function runBranchingWorkflow(
  order: Node<CommandNodeData>[],
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  { appendLog, updateNodeStatus, executeNode, checkpoint }: BranchRunOptions,
): Promise<{ ok: boolean; stopped?: boolean }> {
  const runNodeIds = new Set(order.map((node) => node.id));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outcomes = new Map<string, boolean>();
  const skipped = new Set<string>();
  const executed = new Set<string>();
  const pending = [...order];

  while (pending.length > 0) {
    let nextIndex = -1;

    for (let index = 0; index < pending.length; index += 1) {
      const node = pending[index];

      if (skipped.has(node.id)) {
        nextIndex = index;
        break;
      }

      if (!isNodeReady(node.id, executed, skipped, runNodeIds, edges)) {
        continue;
      }

      if (nextIndex === -1 || isStartNode(node)) {
        nextIndex = index;
        if (isStartNode(node)) break;
      }
    }

    if (nextIndex === -1) {
      appendLog('error', '❌ Workflow branch deadlock — check If/Else connections.');
      return { ok: false };
    }

    const node = pending[nextIndex]!;
    pending.splice(nextIndex, 1);

    if (skipped.has(node.id)) {
      updateNodeStatus(node.id, 'skipped');
      executed.add(node.id);
      continue;
    }

    if (!(await checkpoint())) {
      return { ok: false, stopped: true };
    }

    if (isConditionNode(node)) {
      const upstreamIds = getIncomingEdges(node.id, edges)
        .map((edge) => edge.source)
        .filter((sourceId) => runNodeIds.has(sourceId) && !skipped.has(sourceId));

      if (upstreamIds.length === 0) {
        updateNodeStatus(node.id, 'error');
        appendLog('error', '❌ [If/Else] Connect an upstream step before this node.');
        return { ok: false };
      }

      if (upstreamIds.length > 1) {
        appendLog('warn', '⚠ [If/Else] Multiple upstream steps — using the first connected step.');
      }

      const upstreamOk = outcomes.get(upstreamIds[0]) ?? false;
      const branch: WorkflowBranch = upstreamOk ? 'success' : 'failure';

      updateNodeStatus(node.id, 'running');
      appendLog(
        'run',
        `↪ [If/Else] Upstream ${upstreamOk ? 'succeeded' : 'failed'} → ${branch} branch`,
      );
      updateNodeStatus(node.id, 'success');
      appendLog('success', `✓ [If/Else] Routing to ${branch} path`);

      outcomes.set(node.id, true);
      executed.add(node.id);

      const inactive = collectInactiveBranchNodes(node.id, branch, runNodeIds, edges);
      inactive.forEach((nodeId) => skipped.add(nodeId));

      const activeEdges = getOutgoingEdges(node.id, edges).filter(
        (edge) => runNodeIds.has(edge.target) && edgeBranch(edge) === branch,
      );
      if (activeEdges.length === 0) {
        appendLog('warn', `⚠ [If/Else] No nodes wired on ${branch} branch.`);
      }

      continue;
    }

    const ok = await executeNode(node);
    outcomes.set(node.id, ok);
    executed.add(node.id);

    if (ok && isEndNode(node)) {
      for (const edge of getOutgoingEdges(node.id, edges)) {
        if (!runNodeIds.has(edge.target) || skipped.has(edge.target)) continue;
        markSubtreeSkipped(edge.target, skipped, runNodeIds, edges);
      }
    }

    if (!ok) {
      const children = getOutgoingEdges(node.id, edges).filter(
        (edge) => runNodeIds.has(edge.target) && !skipped.has(edge.target),
      );
      const hasConditionChild = children.some((edge) => {
        const child = nodeById.get(edge.target);
        return child ? isConditionNode(child) : false;
      });

      if (hasConditionChild) {
        skipNonConditionChildren(node.id, skipped, runNodeIds, nodes, edges);
        continue;
      }

      return { ok: false };
    }
  }

  return { ok: true };
}

export function branchEdgeMeta(sourceNode: Node<CommandNodeData> | undefined, sourceHandle?: string | null) {
  if (!sourceNode || !isConditionNode(sourceNode)) {
    return { data: undefined, label: undefined, style: undefined };
  }

  if (sourceHandle !== 'success' && sourceHandle !== 'failure') {
    return { data: undefined, label: undefined, style: undefined };
  }

  return {
    data: { branch: sourceHandle as WorkflowBranch },
    label: sourceHandle === 'success' ? 'success' : 'failure',
    style:
      sourceHandle === 'success'
        ? { stroke: '#4ade80', strokeWidth: 2 }
        : { stroke: '#f87171', strokeWidth: 2 },
    labelStyle: { fill: sourceHandle === 'success' ? '#86efac' : '#fca5a5', fontSize: 10, fontWeight: 600 },
  };
}
