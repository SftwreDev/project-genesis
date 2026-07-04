export type NodeRunStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

export type WorkflowBranch = 'success' | 'failure';

export type CommandField = {
  key: string;
  label: string;
  placeholder: string;
  defaultValue?: string;
  inputType?: 'text' | 'number' | 'datetime-local';
};

export type K8sCommandDef = {
  id: string;
  label: string;
  category: string;
  group: string;
  description: string;
  kubectl: string;
  fields: CommandField[];
  color: string;
  kind?: 'k8s' | 'tool' | 'integration';
};

export type CommandCategory = {
  id: string;
  label: string;
  color: string;
};

export type CommandGroup = {
  id: string;
  label: string;
  categoryId: string;
  color: string;
};

export type CommandNodeData = {
  commandId: string;
  label: string;
  cardTitle: string;
  cardColor: string;
  category: string;
  group: string;
  groupLabel: string;
  color: string;
  kubectl: string;
  params: Record<string, string>;
  yamlContent: string;
  runStatus: NodeRunStatus;
  context: string;
  workflowGroupId?: string;
  workflowGroupName?: string;
  workflowGroupColor?: string;
  timerSeconds?: number | null;
  timerTotalSeconds?: number | null;
};

export type WorkflowGroupFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type WorkflowGroup = {
  id: string;
  name: string;
  nodeIds: string[];
  color: string;
  frame?: WorkflowGroupFrame;
};

export type SavedKubeContext = {
  id: string;
  name: string;
  enabled: boolean;
};

export type SavedSlackProfile = {
  id: string;
  name: string;
  authMode: 'webhook' | 'bot';
  webhookUrl: string;
  botToken: string;
  defaultChannel: string;
  defaultThreadTs: string;
};

export type WorkflowProjectPayload = {
  nodes: import('@xyflow/react').Node<CommandNodeData>[];
  edges: import('@xyflow/react').Edge[];
  workflowGroups: WorkflowGroup[];
  savedContexts?: SavedKubeContext[];
  savedSlackProfiles?: SavedSlackProfile[];
};

export type WorkflowProjectSummary = {
  id: string;
  name: string;
  contextName?: string;
  nodeCount: number;
  edgeCount: number;
  groupCount: number;
  createdAt: number;
  updatedAt: number;
};

export type WorkflowProject = WorkflowProjectSummary & {
  payload: WorkflowProjectPayload;
};

export type TerminalLog = {
  id: string;
  level: 'system' | 'run' | 'success' | 'error' | 'output' | 'warn';
  message: string;
};

export type TerminalSession = {
  id: string;
  name: string;
  logs: TerminalLog[];
  status: 'running' | 'paused' | 'complete' | 'error' | 'stopped';
  createdAt: number;
  workflowSignature?: string;
  saveLogsEnabled?: boolean;
  saveLogsFile?: string;
};

export type CommandResponse = {
  name?: string;
  status?: string;
  message?: string;
  error?: string;
  output?: unknown;
};
