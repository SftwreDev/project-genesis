import { useMemo, useRef, useState } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { FileCode2, Settings2, SlidersHorizontal } from 'lucide-react';
import { getCommandById, isIntegrationCommand, isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData, SavedSlackProfile } from '../types';
import { formatCommandPreview, generateYaml, isReservedParamKey } from '../utils/commandPreview';
import {
  formatKubeContextLabel,
  parseKubeContext,
  resolveEffectiveKubeContext,
  resolveEffectiveNamespace,
} from '../utils/workflowContext';
import { resolveNextScheduleRun } from '../utils/scheduleRecurrence';
import { applyYamlEditorKey } from '../utils/yamlEditor';

type Tab = 'params' | 'yaml';

type Props = {
  node: Node<CommandNodeData> | null;
  inheritedContext?: string;
  inheritedNamespace?: string;
  globalContext?: string;
  savedSlackProfiles?: SavedSlackProfile[];
  nodes: Node<CommandNodeData>[];
  edges: Edge[];
  onParamChange: (nodeId: string, key: string, value: string) => void;
  onCustomFieldAdd: (nodeId: string, key: string, value: string) => void;
  onCustomFieldRemove: (nodeId: string, key: string) => void;
  onYamlChange: (nodeId: string, yamlContent: string) => void;
  onContextChange: (nodeId: string, context: string) => void;
};

export default function NodeConfigurator({
  node,
  inheritedContext = '',
  inheritedNamespace = '',
  globalContext = '',
  savedSlackProfiles = [],
  nodes,
  edges,
  onParamChange,
  onCustomFieldAdd,
  onCustomFieldRemove,
  onYamlChange,
  onContextChange,
}: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('params');
  const [customKey, setCustomKey] = useState('');
  const [customValue, setCustomValue] = useState('');
  const yamlEditorRef = useRef<HTMLTextAreaElement>(null);

  const preview = useMemo(() => {
    if (!node) return null;
    const command = getCommandById(node.data.commandId);
    if (!command) return null;

    const effectiveContext = resolveEffectiveKubeContext(node.id, nodes, edges, globalContext);
    const effectiveNamespace = resolveEffectiveNamespace(node.id, nodes, edges);
    const previewParams = {
      ...node.data.params,
      ...(effectiveNamespace ? { namespace: effectiveNamespace } : {}),
    };

    return {
      command,
      kubectl: formatCommandPreview(
        node.data.commandId,
        command.kubectl,
        previewParams,
        effectiveContext,
      ),
      yaml: node.data.yamlContent || generateYaml(node.data.commandId, previewParams),
    };
  }, [edges, globalContext, node, nodes]);

  if (!node || !preview) {
    return (
      <aside className="config-panel config-panel--empty">
        <Settings2 size={28} />
        <h3>No node selected</h3>
        <p>Drag a command from the library or click a canvas node to edit pod name, namespace, YAML, and custom fields.</p>
      </aside>
    );
  }

  const { command } = preview;
  const isTool = isWorkflowTool(command.id);
  const isIntegration = isIntegrationCommand(command.id);
  const isSlack = command.id === 'slack-notify';
  const isSchedule = command.id === 'workflow-schedule';
  const scheduleType = node.data.params.scheduleType || 'once';
  const effectiveNamespace = resolveEffectiveNamespace(node.id, nodes, edges);
  const definedKeys = new Set(command.fields.map((f) => f.key));
  const customEntries = Object.entries(node.data.params).filter(
    ([key]) => !definedKeys.has(key) && !isReservedParamKey(key),
  );

  const handleYamlKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const textarea = event.currentTarget;
    const edit = applyYamlEditorKey(
      event.key,
      event.shiftKey,
      preview.yaml,
      textarea.selectionStart,
      textarea.selectionEnd,
    );
    if (!edit) return;

    event.preventDefault();
    onYamlChange(node.id, edit.value);
    requestAnimationFrame(() => {
      yamlEditorRef.current?.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  };

  return (
    <aside className="config-panel">
      <div className="config-panel__header">
        <span className="config-panel__badge" style={{ backgroundColor: command.color }}>
          {command.category}
        </span>
        <h3>{command.label}</h3>
        <p>{command.description}</p>
        <code>{preview.kubectl}</code>
      </div>

      <div className="config-panel__tabs">
        <button
          type="button"
          className={`config-panel__tab${activeTab === 'params' ? ' config-panel__tab--active' : ''}`}
          onClick={() => setActiveTab('params')}
        >
          <SlidersHorizontal size={14} />
          Parameters
        </button>
        {!isTool && !isIntegration && (
          <button
            type="button"
            className={`config-panel__tab${activeTab === 'yaml' ? ' config-panel__tab--active' : ''}`}
            onClick={() => setActiveTab('yaml')}
          >
            <FileCode2 size={14} />
            YAML
          </button>
        )}
      </div>

      {activeTab === 'params' || isTool || isIntegration ? (
        <div className="config-panel__fields">
          {!isIntegration && (
            <>
              <h4>Kube Context (optional)</h4>
              <p className="config-panel__hint">
                kubectl --context from ~/.kube/config. Overrides global + upstream inherited context for this node.
              </p>
              {globalContext && !parseKubeContext(node.data.context ?? '') && !inheritedContext && (
                <div className="config-panel__inherited-context config-panel__inherited-context--global">
                  <span>Global default</span>
                  <code>--context {formatKubeContextLabel(globalContext)}</code>
                </div>
              )}
              {inheritedContext && (
                <div className="config-panel__inherited-context">
                  <span>Inherited from upstream</span>
                  <code>--context {formatKubeContextLabel(inheritedContext)}</code>
                </div>
              )}
              <label className="config-panel__field">
                <span>Context name</span>
                <input
                  type="text"
                  value={node.data.context ?? ''}
                  onChange={(e) => onContextChange(node.id, e.target.value)}
                  placeholder={globalContext || inheritedContext || 'test-prod'}
                />
              </label>
            </>
          )}

          <h4>{isIntegration ? 'Integration Settings' : 'Parameters'}</h4>
          {!isIntegration && inheritedNamespace && !node.data.params.namespace?.trim() && (
            <div className="config-panel__inherited-context">
              <span>Inherited namespace from upstream</span>
              <code>{inheritedNamespace}</code>
            </div>
          )}

          {isSlack && (
            <label className="config-panel__field">
              <span>Saved Slack profile</span>
              <select
                value={node.data.params.slackProfileId ?? ''}
                onChange={(e) => onParamChange(node.id, 'slackProfileId', e.target.value)}
              >
                <option value="">None (manual credentials)</option>
                {savedSlackProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          {command.fields.map((field) => {
            if (isSchedule) return null;
            if (isSlack && field.key === 'slackProfileId') return null;

            if (isSlack && field.key === 'authMode') {
              return (
                <label key={field.key} className="config-panel__field">
                  <span>{field.label}</span>
                  <select
                    value={node.data.params[field.key] ?? 'webhook'}
                    onChange={(e) => onParamChange(node.id, field.key, e.target.value)}
                  >
                    <option value="webhook">Incoming webhook</option>
                    <option value="bot">Bot token</option>
                  </select>
                </label>
              );
            }

            if (isSlack && field.key === 'message') {
              return (
                <label key={field.key} className="config-panel__field">
                  <span>{field.label}</span>
                  <textarea
                    className="config-panel__textarea"
                    rows={5}
                    value={node.data.params[field.key] ?? ''}
                    onChange={(e) => onParamChange(node.id, field.key, e.target.value)}
                    placeholder={field.placeholder}
                  />
                </label>
              );
            }

            const inputType =
              isSlack && (field.key === 'webhookUrl' || field.key === 'botToken') ? 'password' : field.inputType ?? 'text';

            return (
              <label key={field.key} className="config-panel__field">
                <span>{field.label}</span>
                <input
                  type={inputType}
                  min={field.inputType === 'number' ? 0 : undefined}
                  value={
                    field.key === 'namespace'
                      ? node.data.params[field.key]?.trim() || effectiveNamespace || ''
                      : (node.data.params[field.key] ?? '')
                  }
                  onChange={(e) => onParamChange(node.id, field.key, e.target.value)}
                  placeholder={field.placeholder}
                />
              </label>
            );
          })}

          {isSchedule && (
            <>
              <label className="config-panel__field">
                <span>Repeat</span>
                <select
                  value={scheduleType}
                  onChange={(e) => onParamChange(node.id, 'scheduleType', e.target.value)}
                >
                  <option value="once">Once</option>
                  <option value="interval">Every interval</option>
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </label>

              {scheduleType === 'once' && (
                <label className="config-panel__field">
                  <span>Run At</span>
                  <input
                    type="datetime-local"
                    value={node.data.params.scheduledAt ?? ''}
                    onChange={(e) => onParamChange(node.id, 'scheduledAt', e.target.value)}
                  />
                </label>
              )}

              {scheduleType === 'interval' && (
                <>
                  <label className="config-panel__field">
                    <span>Every</span>
                    <input
                      type="number"
                      min={1}
                      value={node.data.params.intervalValue ?? '5'}
                      onChange={(e) => onParamChange(node.id, 'intervalValue', e.target.value)}
                    />
                  </label>
                  <label className="config-panel__field">
                    <span>Unit</span>
                    <select
                      value={node.data.params.intervalUnit ?? 'minutes'}
                      onChange={(e) => onParamChange(node.id, 'intervalUnit', e.target.value)}
                    >
                      <option value="seconds">Seconds</option>
                      <option value="minutes">Minutes</option>
                      <option value="hours">Hours</option>
                    </select>
                  </label>
                </>
              )}

              {(scheduleType === 'daily' || scheduleType === 'weekly' || scheduleType === 'monthly') && (
                <label className="config-panel__field">
                  <span>Time of Day</span>
                  <input
                    type="time"
                    value={node.data.params.timeOfDay ?? '17:00'}
                    onChange={(e) => onParamChange(node.id, 'timeOfDay', e.target.value)}
                  />
                </label>
              )}

              {scheduleType === 'weekly' && (
                <label className="config-panel__field">
                  <span>Day of Week</span>
                  <select
                    value={node.data.params.weeklyDay ?? '1'}
                    onChange={(e) => onParamChange(node.id, 'weeklyDay', e.target.value)}
                  >
                    <option value="0">Sunday</option>
                    <option value="1">Monday</option>
                    <option value="2">Tuesday</option>
                    <option value="3">Wednesday</option>
                    <option value="4">Thursday</option>
                    <option value="5">Friday</option>
                    <option value="6">Saturday</option>
                  </select>
                </label>
              )}

              {scheduleType === 'monthly' && (
                <label className="config-panel__field">
                  <span>Day of Month</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={node.data.params.monthlyDay ?? '1'}
                    onChange={(e) => onParamChange(node.id, 'monthlyDay', e.target.value)}
                  />
                </label>
              )}

              <p className="config-panel__hint config-panel__hint--schedule">
                {(() => {
                  const resolution = resolveNextScheduleRun(node.data.params);
                  if ('error' in resolution) {
                    return `Next run: ${resolution.error}`;
                  }
                  return `Next run: ${resolution.summary} (${resolution.label})`;
                })()}
              </p>
            </>
          )}

          {isSlack && (
            <p className="config-panel__hint">
              Variables: {'{{previous}}'}, {'{{previous_output}}'}, {'{{previous_message}}'}, {'{{previous_label}}'}, {'{{previous_status}}'}.
              Go backend sends the HTTP request (avoids browser CORS).
            </p>
          )}

          {isTool ? (
            <p className="config-panel__hint">
              {command.id === 'workflow-schedule'
                ? 'Connect Schedule as first step (no incoming edge). Run Workflow waits until the next matching time — once, every N seconds/minutes/hours, daily, weekly, or monthly.'
                : command.id === 'workflow-condition'
                  ? 'Wire the step to check into the top handle. Drag from green success handle for the happy path, red failure handle for recovery/alternate path.'
                  : command.id === 'workflow-start'
                    ? 'Place Start at the top of a segment. Set Workflow Name in params. Only steps downstream of Start run when Start is on the canvas.'
                    : command.id === 'workflow-end'
                      ? 'Place End where the segment should stop. Steps after End are skipped. Match Workflow Name with Start when they belong to the same segment.'
                      : 'Connect Delay before steps that should wait. Workflow runs top to bottom.'}
            </p>
          ) : isIntegration ? null : (
            <>
              <h4>Custom Parameters</h4>
              <p className="config-panel__hint">Extra keys sync to YAML labels and card chips automatically.</p>

              {customEntries.map(([key, value]) => (
                <div key={key} className="config-panel__custom-row">
                  <input type="text" value={key} readOnly />
                  <input
                    type="text"
                    value={value}
                    onChange={(e) => onParamChange(node.id, key, e.target.value)}
                  />
                  <button type="button" onClick={() => onCustomFieldRemove(node.id, key)}>
                    Remove
                  </button>
                </div>
              ))}

              <div className="config-panel__custom-add">
                <input
                  type="text"
                  value={customKey}
                  onChange={(e) => setCustomKey(e.target.value)}
                  placeholder="custom key"
                />
                <input
                  type="text"
                  value={customValue}
                  onChange={(e) => setCustomValue(e.target.value)}
                  placeholder="custom value"
                />
                <button
                  type="button"
                  onClick={() => {
                    const key = customKey.trim();
                    if (!key) return;
                    onCustomFieldAdd(node.id, key, customValue);
                    setCustomKey('');
                    setCustomValue('');
                  }}
                >
                  Add
                </button>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="config-panel__yaml">
          <p className="config-panel__hint">Edit YAML here. Changes sync back to parameters and custom fields.</p>
          <textarea
            ref={yamlEditorRef}
            className="config-panel__yaml-editor"
            value={preview.yaml}
            onChange={(e) => onYamlChange(node.id, e.target.value)}
            onKeyDown={handleYamlKeyDown}
            spellCheck={false}
          />
        </div>
      )}
    </aside>
  );
}
