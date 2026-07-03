import type { K8sCommandDef } from '../types';
import { defaultTimeOfDay } from '../utils/scheduleRecurrence';

export const WORKFLOW_TOOL_IDS = new Set([
  'workflow-delay',
  'workflow-schedule',
  'workflow-condition',
  'workflow-start',
  'workflow-end',
]);

export function isWorkflowTool(commandId: string): boolean {
  return WORKFLOW_TOOL_IDS.has(commandId);
}

export function defaultScheduleValue(): string {
  const date = new Date(Date.now() + 60_000);
  date.setSeconds(0, 0);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export { defaultTimeOfDay } from '../utils/scheduleRecurrence';

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
    description: 'Place at workflow start to wait until a one-time or recurring time',
    kubectl: 'schedule <once|interval|daily|weekly|monthly>',
    color: '#f472b6',
    kind: 'tool',
    fields: [
      {
        key: 'scheduleType',
        label: 'Repeat',
        placeholder: '',
        defaultValue: 'once',
      },
      {
        key: 'scheduledAt',
        label: 'Run At',
        placeholder: '',
        defaultValue: defaultScheduleValue(),
        inputType: 'datetime-local',
      },
      {
        key: 'intervalValue',
        label: 'Every',
        placeholder: '5',
        defaultValue: '5',
        inputType: 'number',
      },
      {
        key: 'intervalUnit',
        label: 'Interval Unit',
        placeholder: '',
        defaultValue: 'minutes',
      },
      {
        key: 'timeOfDay',
        label: 'Time of Day',
        placeholder: '17:00',
        defaultValue: defaultTimeOfDay(),
      },
      {
        key: 'weeklyDay',
        label: 'Day of Week',
        placeholder: '',
        defaultValue: '1',
      },
      {
        key: 'monthlyDay',
        label: 'Day of Month',
        placeholder: '1',
        defaultValue: '1',
        inputType: 'number',
      },
    ],
  },
  {
    id: 'workflow-condition',
    label: 'If / Else',
    category: 'tools',
    group: 'flow-control',
    description: 'Route to different steps when the upstream step succeeds or fails',
    kubectl: 'if upstream ok → success else → failure',
    color: '#818cf8',
    kind: 'tool',
    fields: [],
  },
  {
    id: 'workflow-start',
    label: 'Start',
    category: 'tools',
    group: 'flow-control',
    description: 'Marks where a named workflow segment begins. Only steps after Start run when Start is on the canvas.',
    kubectl: 'start <segmentName>',
    color: '#34d399',
    kind: 'tool',
    fields: [
      {
        key: 'segmentName',
        label: 'Workflow Name',
        placeholder: 'Deploy Phase',
        defaultValue: 'Main Workflow',
      },
    ],
  },
  {
    id: 'workflow-end',
    label: 'End',
    category: 'tools',
    group: 'flow-control',
    description: 'Marks where a named workflow segment stops. Steps after End are skipped.',
    kubectl: 'end <segmentName>',
    color: '#f87171',
    kind: 'tool',
    fields: [
      {
        key: 'segmentName',
        label: 'Workflow Name',
        placeholder: 'Deploy Complete',
        defaultValue: 'Main Workflow',
      },
    ],
  },
];
