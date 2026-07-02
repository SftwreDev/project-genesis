import type { SavedSlackProfile } from '../types';

const STORAGE_KEY = 'genesis-saved-slack-profiles';

export function loadSavedSlackProfiles(): SavedSlackProfile[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedSlackProfile[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        (item.authMode === 'webhook' || item.authMode === 'bot'),
    );
  } catch {
    return [];
  }
}

export function persistSavedSlackProfiles(profiles: SavedSlackProfile[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function createSavedSlackProfile(name: string): SavedSlackProfile {
  return {
    id: `slack-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    authMode: 'webhook',
    webhookUrl: '',
    botToken: '',
    defaultChannel: '',
    defaultThreadTs: '',
  };
}

export function getSlackProfileById(
  profiles: SavedSlackProfile[],
  profileId: string,
): SavedSlackProfile | undefined {
  const id = profileId.trim();
  if (!id) return undefined;
  return profiles.find((profile) => profile.id === id);
}

export function resolveSlackParams(
  params: Record<string, string>,
  profiles: SavedSlackProfile[],
): Record<string, string> {
  const profile = getSlackProfileById(profiles, params.slackProfileId ?? '');
  if (!profile) return { ...params };

  const pick = (value: string, fallback: string) => (value.trim() ? value.trim() : fallback);

  return {
    ...params,
    authMode: pick(params.authMode ?? '', profile.authMode),
    webhookUrl: pick(params.webhookUrl ?? '', profile.webhookUrl),
    botToken: pick(params.botToken ?? '', profile.botToken),
    channel: pick(params.channel ?? '', profile.defaultChannel),
    threadTs: pick(params.threadTs ?? '', profile.defaultThreadTs),
  };
}

export function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) return '••••••••';
  return `${trimmed.slice(0, 4)}…${trimmed.slice(-4)}`;
}
