import { load as parseYaml } from 'js-yaml';
import { getDefinedParamKeys, isReservedParamKey } from './commandPreview';

type ManifestDoc = {
  metadata?: {
    name?: string;
    namespace?: string;
    labels?: Record<string, string>;
  };
  spec?: {
    replicas?: number;
    containers?: Array<{ name?: string; image?: string }>;
    selector?: { matchLabels?: Record<string, string> };
    template?: {
      spec?: {
        containers?: Array<{ name?: string; image?: string }>;
        tolerations?: Array<{
          key?: string;
          value?: string;
          effect?: string;
          operator?: string;
        }>;
      };
    };
    tolerations?: Array<{
      key?: string;
      value?: string;
      effect?: string;
      operator?: string;
    }>;
    ports?: Array<{ port?: number; targetPort?: number | string }>;
  };
  data?: Record<string, string>;
};

function assignIfPresent(target: Record<string, string>, key: string, value: unknown) {
  if (value === undefined || value === null) return;
  const text = String(value).trim();
  if (text) target[key] = text;
}

function applyToleration(
  target: Record<string, string>,
  toleration?: { key?: string; value?: string; effect?: string; operator?: string },
) {
  if (!toleration?.key) return;
  assignIfPresent(target, 'tolerationKey', toleration.key);
  assignIfPresent(target, 'tolerationValue', toleration.value);
  assignIfPresent(target, 'tolerationEffect', toleration.effect);
  assignIfPresent(target, 'tolerationOperator', toleration.operator);
}

function applyLabels(
  target: Record<string, string>,
  defined: Set<string>,
  labels?: Record<string, string>,
) {
  if (!labels) return;
  for (const [key, value] of Object.entries(labels)) {
    if (defined.has(key) || isReservedParamKey(key)) continue;
    target[key] = value;
  }
}

export function parseYamlToParams(
  commandId: string,
  yamlContent: string,
  currentParams: Record<string, string>,
): Record<string, string> {
  const defined = getDefinedParamKeys(commandId);
  const next: Record<string, string> = {};

  for (const key of defined) {
    next[key] = currentParams[key] ?? '';
  }

  if (!yamlContent.trim() || yamlContent.trim().startsWith('#')) {
    return next;
  }

  try {
    const doc = parseYaml(yamlContent) as ManifestDoc | undefined;
    if (!doc || typeof doc !== 'object') return next;

    const metadata = doc.metadata ?? {};
    const spec = doc.spec ?? {};

    switch (commandId) {
      case 'create-pod': {
        assignIfPresent(next, 'podName', metadata.name);
        assignIfPresent(next, 'namespace', metadata.namespace);
        assignIfPresent(next, 'image', spec.containers?.[0]?.image);
        applyToleration(next, spec.tolerations?.[0]);
        applyLabels(next, defined, metadata.labels);
        break;
      }
      case 'create-deployment': {
        assignIfPresent(next, 'deploymentName', metadata.name);
        assignIfPresent(next, 'namespace', metadata.namespace);
        assignIfPresent(next, 'replicas', spec.replicas);
        assignIfPresent(next, 'image', spec.template?.spec?.containers?.[0]?.image);
        applyLabels(next, defined, metadata.labels);
        break;
      }
      case 'create-service': {
        assignIfPresent(next, 'serviceName', metadata.name);
        assignIfPresent(next, 'namespace', metadata.namespace);
        assignIfPresent(next, 'port', spec.ports?.[0]?.port);
        assignIfPresent(next, 'targetPort', spec.ports?.[0]?.targetPort);
        const selector = spec.selector as Record<string, string> | undefined;
        if (selector) {
          const [selectorKey, selectorValue] = Object.entries(selector)[0] ?? [];
          assignIfPresent(next, 'selectorKey', selectorKey);
          assignIfPresent(next, 'selectorValue', selectorValue);
        }
        applyLabels(next, defined, metadata.labels);
        break;
      }
      case 'create-configmap': {
        assignIfPresent(next, 'configMapName', metadata.name);
        assignIfPresent(next, 'namespace', metadata.namespace);
        if (doc.data) {
          const [key, value] = Object.entries(doc.data)[0] ?? [];
          assignIfPresent(next, 'key', key);
          assignIfPresent(next, 'value', value);
        }
        applyLabels(next, defined, metadata.labels);
        break;
      }
      case 'create-namespace': {
        assignIfPresent(next, 'namespace', metadata.name);
        applyLabels(next, defined, metadata.labels);
        break;
      }
      case 'describe-node':
      case 'add-node-taint':
      case 'remove-node-taint': {
        assignIfPresent(next, 'nodeName', metadata.name);
        break;
      }
      default: {
        assignIfPresent(next, 'podName', metadata.name);
        assignIfPresent(next, 'deploymentName', metadata.name);
        assignIfPresent(next, 'serviceName', metadata.name);
        assignIfPresent(next, 'configMapName', metadata.name);
        assignIfPresent(next, 'namespace', metadata.namespace);
        applyLabels(next, defined, metadata.labels);
      }
    }

    for (const key of defined) {
      if (!(key in next)) next[key] = currentParams[key] ?? '';
    }
  } catch {
    return { ...currentParams };
  }

  return next;
}

export function truncateYamlPreview(yamlContent: string, maxLines = 6): string {
  const lines = yamlContent.split('\n');
  if (lines.length <= maxLines) return yamlContent;
  return `${lines.slice(0, maxLines).join('\n')}\n...`;
}
