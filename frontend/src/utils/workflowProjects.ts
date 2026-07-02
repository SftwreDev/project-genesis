import type { Edge, Node } from '@xyflow/react';
import type {
  CommandNodeData,
  SavedKubeContext,
  SavedSlackProfile,
  WorkflowGroup,
  WorkflowProject,
  WorkflowProjectPayload,
  WorkflowProjectSummary,
} from '../types';

export function buildWorkflowProjectPayload(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  workflowGroups: WorkflowGroup[],
  savedContexts: SavedKubeContext[],
  savedSlackProfiles: SavedSlackProfile[] = [],
): WorkflowProjectPayload {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        runStatus: 'idle',
        timerSeconds: null,
        timerTotalSeconds: null,
      },
    })),
    edges,
    workflowGroups,
    savedContexts,
    savedSlackProfiles,
  };
}

export function normalizeLoadedProjectPayload(payload: WorkflowProjectPayload): WorkflowProjectPayload {
  return {
    nodes: (payload.nodes ?? []).map((node) => ({
      ...node,
      data: {
        ...node.data,
        runStatus: 'idle',
        timerSeconds: null,
        timerTotalSeconds: null,
      },
    })),
    edges: payload.edges ?? [],
    workflowGroups: payload.workflowGroups ?? [],
    savedContexts: payload.savedContexts ?? [],
    savedSlackProfiles: payload.savedSlackProfiles ?? [],
  };
}

function stableNodeSnapshot(node: Node<CommandNodeData>) {
  return {
    id: node.id,
    type: node.type,
    position: node.position,
    data: {
      commandId: node.data.commandId,
      params: node.data.params,
      yamlContent: node.data.yamlContent ?? '',
      context: node.data.context ?? '',
      workflowGroupId: node.data.workflowGroupId ?? '',
    },
  };
}

export function projectPayloadSignature(
  nodes: Node<CommandNodeData>[],
  edges: Edge[],
  workflowGroups: WorkflowGroup[],
  savedContexts: SavedKubeContext[],
  savedSlackProfiles: SavedSlackProfile[] = [],
): string {
  const payload = buildWorkflowProjectPayload(
    nodes,
    edges,
    workflowGroups,
    savedContexts,
    savedSlackProfiles,
  );

  const normalized = {
    nodes: payload.nodes.map(stableNodeSnapshot).sort((a, b) => a.id.localeCompare(b.id)),
    edges: [...payload.edges]
      .map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle ?? null,
        targetHandle: edge.targetHandle ?? null,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    workflowGroups: [...payload.workflowGroups].sort((a, b) => a.id.localeCompare(b.id)),
    savedContexts: [...(payload.savedContexts ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
    savedSlackProfiles: [...(payload.savedSlackProfiles ?? [])].sort((a, b) => a.id.localeCompare(b.id)),
  };

  return JSON.stringify(normalized);
}

async function readJson<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

export async function listWorkflowProjects(): Promise<WorkflowProjectSummary[]> {
  const response = await fetch('/api/workflows');
  return readJson<WorkflowProjectSummary[]>(response);
}

export async function getWorkflowProject(id: string): Promise<WorkflowProject> {
  const response = await fetch(`/api/workflows/${id}`);
  const project = await readJson<WorkflowProject & { payload: WorkflowProjectPayload | string }>(response);
  if (typeof project.payload === 'string') {
    project.payload = JSON.parse(project.payload) as WorkflowProjectPayload;
  }
  return project;
}

export async function createWorkflowProject(
  name: string,
  payload: WorkflowProjectPayload,
): Promise<WorkflowProject> {
  const response = await fetch('/api/workflows', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  });
  return readJson<WorkflowProject>(response);
}

export async function renameWorkflowProject(id: string, name: string): Promise<WorkflowProject> {
  const response = await fetch(`/api/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return readJson<WorkflowProject>(response);
}

export async function updateWorkflowProject(
  id: string,
  name: string,
  payload: WorkflowProjectPayload,
): Promise<WorkflowProject> {
  const response = await fetch(`/api/workflows/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, payload }),
  });
  return readJson<WorkflowProject>(response);
}

export async function deleteWorkflowProject(id: string): Promise<void> {
  const response = await fetch(`/api/workflows/${id}`, { method: 'DELETE' });
  await readJson<{ message?: string }>(response);
}

export function formatProjectUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString();
}
