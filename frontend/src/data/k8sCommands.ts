import type { CommandCategory, CommandGroup, K8sCommandDef } from '../types';
import { generateYaml } from '../utils/commandPreview';
import { INTEGRATION_COMMANDS, isIntegrationCommand } from './integrationCommands';
import { WORKFLOW_TOOLS, defaultScheduleValue, isWorkflowTool } from './workflowTools';

export { isWorkflowTool, defaultScheduleValue, isIntegrationCommand };

export const COMMAND_CATEGORIES: CommandCategory[] = [
  { id: 'workloads', label: 'Workloads', color: '#2dd4bf' },
  { id: 'nodes', label: 'Nodes', color: '#a78bfa' },
  { id: 'networking', label: 'Networking', color: '#60a5fa' },
  { id: 'config', label: 'Config & Storage', color: '#fbbf24' },
  { id: 'cluster', label: 'Cluster', color: '#e879f9' },
  { id: 'tools', label: 'Workflow Tools', color: '#fb923c' },
  { id: 'integrations', label: 'Integrations', color: '#4A154B' },
];

export const COMMAND_GROUPS: CommandGroup[] = [
  { id: 'pods', label: 'Pods', categoryId: 'workloads', color: '#34d399' },
  { id: 'deployments', label: 'Deployments', categoryId: 'workloads', color: '#2dd4bf' },
  { id: 'scheduling', label: 'Taints & Tolerations', categoryId: 'workloads', color: '#22d3ee' },
  { id: 'nodes', label: 'Nodes', categoryId: 'nodes', color: '#a78bfa' },
  { id: 'taints', label: 'Node Taints', categoryId: 'nodes', color: '#c084fc' },
  { id: 'services', label: 'Services', categoryId: 'networking', color: '#60a5fa' },
  { id: 'configmaps', label: 'ConfigMaps', categoryId: 'config', color: '#fbbf24' },
  { id: 'namespaces', label: 'Namespaces', categoryId: 'cluster', color: '#e879f9' },
  { id: 'flow-control', label: 'Flow Control', categoryId: 'tools', color: '#fb923c' },
  { id: 'notifications', label: 'Notifications', categoryId: 'integrations', color: '#4A154B' },
];

const nsField = {
  key: 'namespace',
  label: 'Namespace',
  placeholder: 'default or --all-namespaces',
  defaultValue: 'default',
};

export const K8S_COMMANDS: K8sCommandDef[] = [
  // Pods
  {
    id: 'create-pod',
    label: 'Create Pod',
    category: 'workloads',
    group: 'pods',
    description: 'Run a container image as a pod',
    kubectl: 'kubectl run <podName> --image=<image> -n <namespace>',
    color: '#10b981',
    fields: [
      nsField,
      { key: 'podName', label: 'Pod Name', placeholder: 'genesis', defaultValue: 'genesis' },
      { key: 'image', label: 'Container Image', placeholder: 'nginx', defaultValue: 'nginx' },
      { key: 'tolerationKey', label: 'Toleration Key (optional)', placeholder: 'dedicated' },
      { key: 'tolerationValue', label: 'Toleration Value', placeholder: 'gpu' },
      { key: 'tolerationEffect', label: 'Toleration Effect', placeholder: 'NoSchedule' },
      { key: 'tolerationOperator', label: 'Toleration Operator', placeholder: 'Equal' },
    ],
  },
  {
    id: 'delete-pod',
    label: 'Delete Pod',
    category: 'workloads',
    group: 'pods',
    description: 'Remove a pod from the cluster',
    kubectl: 'kubectl delete pod <podName> -n <namespace>',
    color: '#ef4444',
    fields: [nsField, { key: 'podName', label: 'Pod Name', placeholder: 'genesis' }],
  },
  {
    id: 'list-pods',
    label: 'List Pods',
    category: 'workloads',
    group: 'pods',
    description: 'Show all pods in a namespace',
    kubectl: 'kubectl get pods -n <namespace>',
    color: '#34d399',
    fields: [nsField],
  },
  {
    id: 'get-pod-logs',
    label: 'Get Pod Logs',
    category: 'workloads',
    group: 'pods',
    description: 'Stream logs from a running pod',
    kubectl: 'kubectl logs <podName> -n <namespace>',
    color: '#14b8a6',
    fields: [
      nsField,
      { key: 'podName', label: 'Pod Name', placeholder: 'genesis' },
      { key: 'container', label: 'Container (optional)', placeholder: 'main' },
      { key: 'waitSeconds', label: 'Wait Timeout (seconds)', placeholder: '3600', defaultValue: '3600' },
      { key: 'followSeconds', label: 'Follow Duration (seconds)', placeholder: '30', defaultValue: '30' },
      { key: 'tailLines', label: 'Tail Lines', placeholder: '200', defaultValue: '200' },
    ],
  },
  {
    id: 'describe-pod',
    label: 'Describe Pod',
    category: 'workloads',
    group: 'pods',
    description: 'Show detailed pod status and spec',
    kubectl: 'kubectl describe pod <podName> -n <namespace>',
    color: '#6ee7b7',
    fields: [nsField, { key: 'podName', label: 'Pod Name', placeholder: 'genesis' }],
  },
  // Deployments
  {
    id: 'list-deployments',
    label: 'List Deployments',
    category: 'workloads',
    group: 'deployments',
    description: 'Show deployments in a namespace',
    kubectl: 'kubectl get deployments -n <namespace>',
    color: '#2dd4bf',
    fields: [nsField],
  },
  {
    id: 'describe-deployment',
    label: 'Describe Deployment',
    category: 'workloads',
    group: 'deployments',
    description: 'Show deployment status, replicas, and image',
    kubectl: 'kubectl describe deployment <deploymentName> -n <namespace>',
    color: '#5eead4',
    fields: [nsField, { key: 'deploymentName', label: 'Deployment Name', placeholder: 'my-app' }],
  },
  {
    id: 'create-deployment',
    label: 'Create Deployment',
    category: 'workloads',
    group: 'deployments',
    description: 'Run a replicated application deployment',
    kubectl: 'kubectl create deployment <deploymentName> --image=<image> -n <namespace>',
    color: '#0891b2',
    fields: [
      nsField,
      { key: 'deploymentName', label: 'Deployment Name', placeholder: 'my-app', defaultValue: 'my-app' },
      { key: 'image', label: 'Container Image', placeholder: 'nginx', defaultValue: 'nginx' },
      { key: 'replicas', label: 'Replicas', placeholder: '1', defaultValue: '1' },
    ],
  },
  {
    id: 'delete-deployment',
    label: 'Delete Deployment',
    category: 'workloads',
    group: 'deployments',
    description: 'Remove a deployment from the cluster',
    kubectl: 'kubectl delete deployment <deploymentName> -n <namespace>',
    color: '#f97316',
    fields: [nsField, { key: 'deploymentName', label: 'Deployment Name', placeholder: 'my-app' }],
  },
  {
    id: 'scale-deployment',
    label: 'Scale Deployment',
    category: 'workloads',
    group: 'deployments',
    description: 'Change the replica count for a deployment',
    kubectl: 'kubectl scale deployment <deploymentName> --replicas=<replicas> -n <namespace>',
    color: '#06b6d4',
    fields: [
      nsField,
      { key: 'deploymentName', label: 'Deployment Name', placeholder: 'my-app' },
      { key: 'replicas', label: 'Replicas', placeholder: '3', defaultValue: '3' },
    ],
  },
  // Scheduling
  {
    id: 'add-pod-toleration',
    label: 'Add Pod Toleration',
    category: 'workloads',
    group: 'scheduling',
    description: 'Allow a pod to schedule onto tainted nodes',
    kubectl: 'kubectl patch pod <podName> -n <namespace> --tolerations=...',
    color: '#0ea5e9',
    fields: [
      nsField,
      { key: 'podName', label: 'Pod Name', placeholder: 'genesis' },
      { key: 'tolerationKey', label: 'Toleration Key', placeholder: 'dedicated' },
      { key: 'tolerationValue', label: 'Toleration Value', placeholder: 'gpu' },
      { key: 'tolerationEffect', label: 'Effect', placeholder: 'NoSchedule', defaultValue: 'NoSchedule' },
      { key: 'tolerationOperator', label: 'Operator', placeholder: 'Equal', defaultValue: 'Equal' },
    ],
  },
  // Nodes
  {
    id: 'list-nodes',
    label: 'List Nodes',
    category: 'nodes',
    group: 'nodes',
    description: 'Show cluster worker nodes',
    kubectl: 'kubectl get nodes',
    color: '#a78bfa',
    fields: [],
  },
  {
    id: 'describe-node',
    label: 'Describe Node',
    category: 'nodes',
    group: 'nodes',
    description: 'Show node capacity, conditions, and taints',
    kubectl: 'kubectl describe node <nodeName>',
    color: '#c4b5fd',
    fields: [{ key: 'nodeName', label: 'Node Name', placeholder: 'minikube' }],
  },
  {
    id: 'add-node-taint',
    label: 'Add Node Taint',
    category: 'nodes',
    group: 'taints',
    description: 'Mark a node unschedulable unless tolerated',
    kubectl: 'kubectl taint nodes <nodeName> <taintKey>=<taintValue>:<taintEffect>',
    color: '#9333ea',
    fields: [
      { key: 'nodeName', label: 'Node Name', placeholder: 'minikube' },
      { key: 'taintKey', label: 'Taint Key', placeholder: 'dedicated' },
      { key: 'taintValue', label: 'Taint Value', placeholder: 'gpu' },
      { key: 'taintEffect', label: 'Effect', placeholder: 'NoSchedule', defaultValue: 'NoSchedule' },
    ],
  },
  {
    id: 'remove-node-taint',
    label: 'Remove Node Taint',
    category: 'nodes',
    group: 'taints',
    description: 'Remove a taint from a node',
    kubectl: 'kubectl taint nodes <nodeName> <taintKey>-',
    color: '#d946ef',
    fields: [
      { key: 'nodeName', label: 'Node Name', placeholder: 'minikube' },
      { key: 'taintKey', label: 'Taint Key', placeholder: 'dedicated' },
    ],
  },
  // Networking
  {
    id: 'create-service',
    label: 'Create Service',
    category: 'networking',
    group: 'services',
    description: 'Expose pods with a cluster service',
    kubectl: 'kubectl expose ... --port=<port> -n <namespace>',
    color: '#3b82f6',
    fields: [
      nsField,
      { key: 'serviceName', label: 'Service Name', placeholder: 'my-service', defaultValue: 'my-service' },
      { key: 'port', label: 'Port', placeholder: '80', defaultValue: '80' },
      { key: 'targetPort', label: 'Target Port', placeholder: '80', defaultValue: '80' },
      { key: 'selectorKey', label: 'Selector Key', placeholder: 'app', defaultValue: 'app' },
      { key: 'selectorValue', label: 'Selector Value', placeholder: 'my-app', defaultValue: 'my-app' },
    ],
  },
  {
    id: 'list-services',
    label: 'List Services',
    category: 'networking',
    group: 'services',
    description: 'Show services in a namespace',
    kubectl: 'kubectl get services -n <namespace>',
    color: '#60a5fa',
    fields: [nsField],
  },
  {
    id: 'delete-service',
    label: 'Delete Service',
    category: 'networking',
    group: 'services',
    description: 'Remove a service from the cluster',
    kubectl: 'kubectl delete service <serviceName> -n <namespace>',
    color: '#2563eb',
    fields: [nsField, { key: 'serviceName', label: 'Service Name', placeholder: 'my-service' }],
  },
  // Config
  {
    id: 'create-configmap',
    label: 'Create ConfigMap',
    category: 'config',
    group: 'configmaps',
    description: 'Store non-sensitive configuration data',
    kubectl: 'kubectl create configmap <name> --from-literal=<key>=<value>',
    color: '#eab308',
    fields: [
      nsField,
      { key: 'configMapName', label: 'ConfigMap Name', placeholder: 'app-config', defaultValue: 'app-config' },
      { key: 'key', label: 'Data Key', placeholder: 'config', defaultValue: 'config' },
      { key: 'value', label: 'Data Value', placeholder: 'value', defaultValue: 'value' },
    ],
  },
  {
    id: 'list-configmaps',
    label: 'List ConfigMaps',
    category: 'config',
    group: 'configmaps',
    description: 'Show configmaps in a namespace',
    kubectl: 'kubectl get configmaps -n <namespace>',
    color: '#fbbf24',
    fields: [nsField],
  },
  {
    id: 'delete-configmap',
    label: 'Delete ConfigMap',
    category: 'config',
    group: 'configmaps',
    description: 'Remove a configmap from the cluster',
    kubectl: 'kubectl delete configmap <configMapName> -n <namespace>',
    color: '#f59e0b',
    fields: [nsField, { key: 'configMapName', label: 'ConfigMap Name', placeholder: 'app-config' }],
  },
  // Cluster
  {
    id: 'list-namespaces',
    label: 'List Namespaces',
    category: 'cluster',
    group: 'namespaces',
    description: 'Show all namespaces',
    kubectl: 'kubectl get namespaces',
    color: '#e879f9',
    fields: [],
  },
  {
    id: 'create-namespace',
    label: 'Create Namespace',
    category: 'cluster',
    group: 'namespaces',
    description: 'Provision a new namespace',
    kubectl: 'kubectl create namespace <namespace>',
    color: '#ec4899',
    fields: [{ key: 'namespace', label: 'Namespace', placeholder: 'dev', defaultValue: 'dev' }],
  },
  {
    id: 'delete-namespace',
    label: 'Delete Namespace',
    category: 'cluster',
    group: 'namespaces',
    description: 'Remove a namespace and its resources',
    kubectl: 'kubectl delete namespace <namespace>',
    color: '#db2777',
    fields: [{ key: 'namespace', label: 'Namespace', placeholder: 'dev' }],
  },
  ...WORKFLOW_TOOLS,
  ...INTEGRATION_COMMANDS,
];

/** One distinct accent per command template — single source of truth for card colors. */
const COMMAND_ACCENT_COLORS: Record<string, string> = {
  'create-pod': '#10b981',
  'delete-pod': '#ef4444',
  'list-pods': '#22c55e',
  'get-pod-logs': '#14b8a6',
  'describe-pod': '#84cc16',
  'list-deployments': '#06b6d4',
  'describe-deployment': '#0891b2',
  'create-deployment': '#0ea5e9',
  'delete-deployment': '#f97316',
  'scale-deployment': '#0284c7',
  'add-pod-toleration': '#2dd4bf',
  'list-nodes': '#8b5cf6',
  'describe-node': '#a78bfa',
  'add-node-taint': '#7c3aed',
  'remove-node-taint': '#d946ef',
  'create-service': '#3b82f6',
  'list-services': '#6366f1',
  'delete-service': '#1d4ed8',
  'create-configmap': '#eab308',
  'list-configmaps': '#f59e0b',
  'delete-configmap': '#ca8a04',
  'list-namespaces': '#ec4899',
  'create-namespace': '#f472b6',
  'delete-namespace': '#db2777',
  'workflow-delay': '#fb923c',
  'workflow-schedule': '#f43f5e',
  'workflow-condition': '#818cf8',
  'workflow-start': '#34d399',
  'workflow-end': '#f87171',
  'slack-notify': '#611f69',
};

export function getCommandAccentColor(commandId: string): string {
  return COMMAND_ACCENT_COLORS[commandId] ?? getCommandById(commandId)?.color ?? '#64748b';
}

export function getCommandById(id: string): K8sCommandDef | undefined {
  return K8S_COMMANDS.find((cmd) => cmd.id === id);
}

export function getGroupById(id: string): CommandGroup | undefined {
  return COMMAND_GROUPS.find((group) => group.id === id);
}

export function defaultParamsForCommand(command: K8sCommandDef): Record<string, string> {
  return command.fields.reduce<Record<string, string>>((acc, field) => {
    acc[field.key] = field.defaultValue ?? '';
    return acc;
  }, {});
}

export function createCommandNodeData(command: K8sCommandDef, cardColor?: string) {
  const params = defaultParamsForCommand(command);
  const group = getGroupById(command.group);
  const accentColor = cardColor ?? getCommandAccentColor(command.id);
  return {
    commandId: command.id,
    label: command.label,
    cardTitle: command.label,
    cardColor: accentColor,
    category: command.category,
    group: command.group,
    groupLabel: group?.label ?? command.group,
    color: accentColor,
    kubectl: command.kubectl,
    params,
    context: '',
    yamlContent: isWorkflowTool(command.id)
      ? `# Workflow tool: ${command.label}`
      : isIntegrationCommand(command.id)
        ? `# Integration: ${command.label}`
        : generateYaml(command.id, params),
    runStatus: 'idle' as const,
  };
}
