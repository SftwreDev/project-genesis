import { getCommandById } from '../data/k8sCommands';
import { describeSchedule } from './scheduleRecurrence';

export const RESERVED_PARAM_KEYS = new Set(['manifestYaml', 'context']);

export function isReservedParamKey(key: string): boolean {
  return RESERVED_PARAM_KEYS.has(key) || key.startsWith('_');
}

function param(params: Record<string, string>, key: string, fallback = ''): string {
  return params[key]?.trim() || fallback;
}

export function isAllNamespaces(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ['*', 'all', '-a', '--all-namespaces', '--all-namespace'].includes(normalized);
}

function prepareNamespaceTemplate(template: string, params: Record<string, string>): string {
  const ns = param(params, 'namespace');
  if (ns && isAllNamespaces(ns)) {
    return template.replace(/\s+-n\s+<namespace>/gi, ' --all-namespaces');
  }
  return template;
}

function tokenizeKubectlFlags(text: string): KubectlPreviewPart[] {
  if (!text.includes('--all-namespaces')) {
    return [{ text, kind: 'text' }];
  }

  const segments = text.split(/(--all-namespaces)/g).filter((part) => part.length > 0);
  return segments.map((segment) =>
    segment === '--all-namespaces'
      ? { text: segment, kind: 'flag' as const }
      : { text: segment, kind: 'text' as const },
  );
}

export function getDefinedParamKeys(commandId: string): Set<string> {
  const command = getCommandById(commandId);
  return new Set(command?.fields.map((field) => field.key) ?? []);
}

export function getCustomParams(
  commandId: string,
  params: Record<string, string>,
): Array<[string, string]> {
  const defined = getDefinedParamKeys(commandId);
  return Object.entries(params).filter(
    ([key, value]) => !defined.has(key) && !isReservedParamKey(key) && value.trim().length > 0,
  );
}

export function resolveKubectlTemplate(template: string, params: Record<string, string>): string {
  const prepared = prepareNamespaceTemplate(template, params);
  const ns = param(params, 'namespace');

  return prepared.replace(/<(\w+)>/g, (_, key: string) => {
    if (key === 'namespace' && ns && isAllNamespaces(ns)) {
      return '';
    }
    return param(params, key) || `<${key}>`;
  });
}

export function formatCommandPreview(
  commandId: string,
  template: string,
  params: Record<string, string>,
  kubeContext?: string,
): string {
  let base = resolveKubectlTemplate(template, params);
  const ctx = kubeContext?.trim();
  if (ctx) {
    if (base.startsWith('kubectl')) {
      base = `kubectl --context ${ctx}${base.slice('kubectl'.length)}`;
    } else {
      base = `kubectl --context ${ctx} ${base}`;
    }
  }

  const custom = getCustomParams(commandId, params);
  if (custom.length === 0) return base;

  const extras = custom.map(([key, value]) => `--${key}=${value}`).join(' ');
  return `${base} ${extras}`;
}

export type KubectlPreviewPart = {
  text: string;
  kind: 'text' | 'value' | 'placeholder' | 'flag';
};

export function splitKubectlWithContext(
  template: string,
  params: Record<string, string>,
  kubeContext?: string,
): KubectlPreviewPart[] {
  const parts = splitKubectlTemplate(template, params);
  const ctx = kubeContext?.trim();
  if (!ctx) return parts;

  const contextParts: KubectlPreviewPart[] = [
    { text: ' ', kind: 'text' },
    { text: '--context', kind: 'flag' },
    { text: ' ', kind: 'text' },
    { text: ctx, kind: 'value' },
  ];

  const first = parts[0];
  if (first?.kind === 'text' && first.text.startsWith('kubectl')) {
    const rest = first.text.slice('kubectl'.length);
    return [
      { text: 'kubectl', kind: 'text' },
      ...contextParts,
      ...(rest ? [{ text: rest, kind: 'text' as const }] : []),
      ...parts.slice(1),
    ];
  }

  return [{ text: 'kubectl', kind: 'text' }, ...contextParts, { text: ' ', kind: 'text' }, ...parts];
}

export function splitKubectlTemplate(
  template: string,
  params: Record<string, string>,
): Array<{ text: string; kind: 'text' | 'value' | 'placeholder' | 'flag' }> {
  const prepared = prepareNamespaceTemplate(template, params);
  const ns = param(params, 'namespace');
  const parts = prepared.split(/(<\w+>)/g);

  return parts
    .filter((part) => part.length > 0)
    .flatMap((part) => {
      const match = part.match(/^<(\w+)>$/);
      if (!match) {
        return tokenizeKubectlFlags(part);
      }

      const key = match[1];
      if (key === 'namespace' && ns && isAllNamespaces(ns)) {
        return [];
      }

      const value = param(params, key);
      if (value) return [{ text: value, kind: 'value' as const }];
      return [{ text: part, kind: 'placeholder' as const }];
    });
}

function tolerationsBlock(params: Record<string, string>): string {
  const key = param(params, 'tolerationKey');
  if (!key) return '';
  const value = param(params, 'tolerationValue');
  const effect = param(params, 'tolerationEffect', 'NoSchedule');
  const operator = param(params, 'tolerationOperator', 'Equal');
  return `  tolerations:
    - key: ${key}
      operator: ${operator}
      value: ${value}
      effect: ${effect}
`;
}
function metadataLabelsBlock(custom: Array<[string, string]>): string {
  if (custom.length === 0) return '';
  return `  labels:\n${custom.map(([key, value]) => `    ${key}: ${value}`).join('\n')}\n`;
}

function appendCustomComment(base: string, custom: Array<[string, string]>): string {
  if (custom.length === 0) return base;
  return `${base}\n# Custom parameters:\n${custom.map(([key, value]) => `#   ${key}: ${value}`).join('\n')}`;
}

export function generateYaml(commandId: string, params: Record<string, string>): string {
  const command = getCommandById(commandId);
  if (!command) return '# Unknown command';

  const ns = param(params, 'namespace', 'default');
  const custom = getCustomParams(commandId, params);

  let base: string;

  switch (commandId) {
    case 'create-pod':
      base = `apiVersion: v1
kind: Pod
metadata:
  name: ${param(params, 'podName', '<podName>')}
  namespace: ${ns}
${metadataLabelsBlock(custom)}spec:
${tolerationsBlock(params)}  containers:
    - name: main
      image: ${param(params, 'image', 'nginx')}`;
      return base;

    case 'create-deployment':
      base = `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${param(params, 'deploymentName', '<deploymentName>')}
  namespace: ${ns}
${metadataLabelsBlock(custom)}spec:
  replicas: ${param(params, 'replicas', '1')}
  selector:
    matchLabels:
      app: ${param(params, 'deploymentName', '<deploymentName>')}
  template:
    metadata:
      labels:
        app: ${param(params, 'deploymentName', '<deploymentName>')}
    spec:
      containers:
        - name: main
          image: ${param(params, 'image', 'nginx')}`;
      return base;

    case 'delete-pod':
      base = `# Delete operation — no manifest is applied
# Equivalent:
# kubectl delete pod ${param(params, 'podName', '<podName>')} -n ${ns}`;
      break;

    case 'list-pods':
      base = `# Read-only operation
# Equivalent:
# kubectl get pods -n ${ns}`;
      break;

    case 'get-pod-logs':
      base = `# Read-only operation
# Equivalent:
# kubectl logs ${param(params, 'podName', '<podName>')} -n ${ns}${
        param(params, 'container') ? ` -c ${param(params, 'container')}` : ''
      }`;
      break;

    case 'describe-pod':
      base = `# Read-only operation
# Equivalent:
# kubectl describe pod ${param(params, 'podName', '<podName>')} -n ${ns}`;
      break;

    case 'list-deployments':
      base = `# Read-only operation
# Equivalent:
# kubectl get deployments -n ${ns}`;
      break;

    case 'describe-deployment':
      base = `# Read-only operation
# Equivalent:
# kubectl describe deployment ${param(params, 'deploymentName', '<deploymentName>')} -n ${ns}`;
      break;

    case 'delete-deployment':
      base = `# Delete operation
# Equivalent:
# kubectl delete deployment ${param(params, 'deploymentName', '<deploymentName>')} -n ${ns}`;
      break;

    case 'scale-deployment':
      base = `# Patch operation
# Equivalent:
# kubectl scale deployment ${param(params, 'deploymentName', '<deploymentName>')} --replicas=${param(params, 'replicas', '1')} -n ${ns}`;
      break;

    case 'add-pod-toleration':
      base = `# Patch operation
# Equivalent:
# kubectl patch pod ${param(params, 'podName', '<podName>')} -n ${ns}`;
      break;

    case 'add-node-taint':
      base = `# Node patch operation
# Equivalent:
# kubectl taint nodes ${param(params, 'nodeName', '<nodeName>')} ${param(params, 'taintKey', '<taintKey>')}=${param(params, 'taintValue', '')}:${param(params, 'taintEffect', 'NoSchedule')}`;
      break;

    case 'remove-node-taint':
      base = `# Node patch operation
# Equivalent:
# kubectl taint nodes ${param(params, 'nodeName', '<nodeName>')} ${param(params, 'taintKey', '<taintKey>')}-`;
      break;

    case 'describe-node':
      base = `# Read-only operation
# Equivalent:
# kubectl describe node ${param(params, 'nodeName', '<nodeName>')}`;
      break;

    case 'create-service':
      base = `apiVersion: v1
kind: Service
metadata:
  name: ${param(params, 'serviceName', '<serviceName>')}
  namespace: ${ns}
${metadataLabelsBlock(custom)}spec:
  selector:
    ${param(params, 'selectorKey', 'app')}: ${param(params, 'selectorValue', '<selectorValue>')}
  ports:
    - port: ${param(params, 'port', '80')}
      targetPort: ${param(params, 'targetPort', '80')}`;
      return base;

    case 'list-services':
      base = `# Read-only operation
# Equivalent:
# kubectl get services -n ${ns}`;
      break;

    case 'delete-service':
      base = `# Delete operation — no manifest is applied
# Equivalent:
# kubectl delete service ${param(params, 'serviceName', '<serviceName>')} -n ${ns}`;
      break;

    case 'create-configmap':
      base = `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${param(params, 'configMapName', '<configMapName>')}
  namespace: ${ns}
${metadataLabelsBlock(custom)}data:
  ${param(params, 'key', 'config')}: ${param(params, 'value', '')}`;
      return base;

    case 'list-configmaps':
      base = `# Read-only operation
# Equivalent:
# kubectl get configmaps -n ${ns}`;
      break;

    case 'delete-configmap':
      base = `# Delete operation — no manifest is applied
# Equivalent:
# kubectl delete configmap ${param(params, 'configMapName', '<configMapName>')} -n ${ns}`;
      break;

    case 'list-nodes':
      base = `# Read-only operation
# Equivalent:
# kubectl get nodes`;
      break;

    case 'list-namespaces':
      base = `# Read-only operation
# Equivalent:
# kubectl get namespaces`;
      break;

    case 'create-namespace':
      base = `apiVersion: v1
kind: Namespace
metadata:
  name: ${param(params, 'namespace', '<namespace>')}
${metadataLabelsBlock(custom)}`;
      return base.trimEnd();

    case 'delete-namespace':
      base = `# Delete operation — no manifest is applied
# Equivalent:
# kubectl delete namespace ${param(params, 'namespace', '<namespace>')}`;
      break;

    case 'workflow-delay':
      return `# Workflow tool: Delay
# Pauses for ${param(params, 'delaySeconds', '5')} seconds before the next step`;

    case 'workflow-schedule':
      return `# Workflow tool: Schedule
# ${describeSchedule(params)}`;

    default:
      return `# No YAML preview for "${command.label}"`;
  }

  if (custom.length === 0) return base;

  return appendCustomComment(base, custom);
}
