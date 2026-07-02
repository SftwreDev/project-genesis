import type { K8sCommandDef } from '../types';

export const INTEGRATION_COMMAND_IDS = new Set(['slack-notify']);

export function isIntegrationCommand(commandId: string): boolean {
  return INTEGRATION_COMMAND_IDS.has(commandId);
}

export const INTEGRATION_COMMANDS: K8sCommandDef[] = [
  {
    id: 'slack-notify',
    label: 'Slack Notify',
    category: 'integrations',
    group: 'notifications',
    description:
      'Send a Slack message via incoming webhook or bot token. Use {{previous}}, {{previous_output}}, {{previous_message}}, {{previous_label}}, {{previous_status}} in the message.',
    kubectl: 'slack notify → #<channel>',
    color: '#4A154B',
    kind: 'integration',
    fields: [
      {
        key: 'slackProfileId',
        label: 'Saved Profile (optional)',
        placeholder: 'Pick from Slack settings or leave blank',
      },
      {
        key: 'authMode',
        label: 'Auth Mode',
        placeholder: 'webhook or bot',
        defaultValue: 'webhook',
      },
      {
        key: 'webhookUrl',
        label: 'Webhook URL',
        placeholder: 'https://hooks.slack.com/services/...',
      },
      {
        key: 'botToken',
        label: 'Bot Token',
        placeholder: 'xoxb-...',
      },
      {
        key: 'channel',
        label: 'Channel / Thread ID',
        placeholder: '#alerts or C01234ABC',
      },
      {
        key: 'threadTs',
        label: 'Thread Timestamp (optional)',
        placeholder: '1234567890.123456',
      },
      {
        key: 'message',
        label: 'Message Payload',
        placeholder: 'Deploy finished: {{previous_message}}\n{{previous}}',
      },
    ],
  },
];
