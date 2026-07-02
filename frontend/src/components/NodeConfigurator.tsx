import { useMemo, useRef, useState } from 'react';
import type { Node } from '@xyflow/react';
import { FileCode2, Settings2, SlidersHorizontal } from 'lucide-react';
import { getCommandById, isWorkflowTool } from '../data/k8sCommands';
import type { CommandNodeData } from '../types';
import { formatCommandPreview, generateYaml, isReservedParamKey } from '../utils/commandPreview';
import { formatKubeContextLabel, parseKubeContext } from '../utils/workflowContext';
import { applyYamlEditorKey } from '../utils/yamlEditor';

type Tab = 'params' | 'yaml';

type Props = {
  node: Node<CommandNodeData> | null;
  inheritedContext?: string;
  onParamChange: (nodeId: string, key: string, value: string) => void;
  onCustomFieldAdd: (nodeId: string, key: string, value: string) => void;
  onCustomFieldRemove: (nodeId: string, key: string) => void;
  onYamlChange: (nodeId: string, yamlContent: string) => void;
  onContextChange: (nodeId: string, context: string) => void;
};

export default function NodeConfigurator({
  node,
  inheritedContext = '',
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

    return {
      command,
      kubectl: formatCommandPreview(
        node.data.commandId,
        command.kubectl,
        node.data.params,
        parseKubeContext(node.data.context ?? '') || inheritedContext,
      ),
      yaml: node.data.yamlContent || generateYaml(node.data.commandId, node.data.params),
    };
  }, [inheritedContext, node]);

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
        {!isTool && (
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

      {activeTab === 'params' || isTool ? (
        <div className="config-panel__fields">
          <h4>Kube Context (optional)</h4>
          <p className="config-panel__hint">
            kubectl --context value from ~/.kube/config. Downstream connected nodes inherit this at run time.
          </p>
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
              placeholder="test-prod"
            />
          </label>

          <h4>Parameters</h4>
          {command.fields.map((field) => (
            <label key={field.key} className="config-panel__field">
              <span>{field.label}</span>
              <input
                type={field.inputType ?? 'text'}
                min={field.inputType === 'number' ? 0 : undefined}
                value={node.data.params[field.key] ?? ''}
                onChange={(e) => onParamChange(node.id, field.key, e.target.value)}
                placeholder={field.placeholder}
              />
            </label>
          ))}

          {isTool ? (
            <p className="config-panel__hint">
              {command.id === 'workflow-schedule'
                ? 'Connect Schedule as first step (no incoming edge). Run Workflow waits until this time, then executes the flow.'
                : 'Connect Delay before steps that should wait. Workflow runs top to bottom.'}
            </p>
          ) : (
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
