import type { Edge } from '@xyflow/react';
import { getIncomingEdges } from './workflowBranching';

export type StepOutputRecord = {
  nodeId: string;
  label: string;
  commandId: string;
  ok: boolean;
  message?: string;
  output?: unknown;
};

export function getPreviousStepOutput(
  nodeId: string,
  edges: Edge[],
  stepOutputs: Map<string, StepOutputRecord>,
): StepOutputRecord | null {
  const parents = getIncomingEdges(nodeId, edges)
    .map((edge) => edge.source)
    .filter((sourceId) => stepOutputs.has(sourceId));

  if (parents.length === 0) return null;

  for (const parentId of parents) {
    const record = stepOutputs.get(parentId);
    if (record) return record;
  }

  return null;
}

function formatStepOutput(output: unknown): string {
  if (output === undefined || output === null) return '';
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) return output.map(String).join('\n');
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function injectTemplateVariables(
  template: string,
  previous: StepOutputRecord | null,
): string {
  if (!template) return template;

  const outputText = previous ? formatStepOutput(previous.output) : '';
  const messageText = previous?.message?.trim() ?? '';
  const combined = outputText || messageText;
  const status = previous ? (previous.ok ? 'success' : 'error') : '';

  return template
    .replaceAll('{{previous_output}}', outputText)
    .replaceAll('{{previous_message}}', messageText)
    .replaceAll('{{previous_label}}', previous?.label ?? '')
    .replaceAll('{{previous_status}}', status)
    .replaceAll('{{previous}}', combined);
}

export function createStepOutputRecord(
  nodeId: string,
  label: string,
  commandId: string,
  ok: boolean,
  message?: string,
  output?: unknown,
): StepOutputRecord {
  return { nodeId, label, commandId, ok, message, output };
}
