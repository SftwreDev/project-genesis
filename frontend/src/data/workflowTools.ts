import type { K8sCommandDef } from '../types';

export const WORKFLOW_TOOL_IDS = new Set(['workflow-delay', 'workflow-schedule']);

export function isWorkflowTool(commandId: string): boolean {
  return WORKFLOW_TOOL_IDS.has(commandId);
}

export function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 60_000);
  date.setSeconds(0, 0);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export const WORKFLOW_TOOLS: K8sCommandDef[] = [
  {
    id: 'workflow-delay',
    label: 'Delay',
    category: 'tools',
    group: 'flow-control',
    description: 'Pause for a set time before the next connected step runs',
    kubectl: 'wait <delaySeconds>s',
    color: '#fb923c',
    kind: 'tool',
    fields: [
      {
        key: 'delaySeconds',
        label: 'Delay (seconds)',
        placeholder: '5',
        defaultValue: '5',
        inputType: 'number',
      },
    ],
  },
  {
    id: 'workflow-schedule',
    label: 'Schedule',
    category: 'tools',
    group: 'flow-control',
    description: 'Place at workflow start to run the full flow at a date/time',
    kubectl: 'schedule at <scheduledAt>',
    color: '#f472b6',
    kind: 'tool',
    fields: [
      {
        key: 'scheduledAt',
        label: 'Run At',
        placeholder: '',
        defaultValue: defaultScheduleValue(),
        inputType: 'datetime-local',
      },
    ],
  },
];
