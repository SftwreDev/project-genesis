import type { SavedKubeContext } from '../types';

const STORAGE_KEY = 'genesis-saved-kube-contexts';

export function loadSavedContexts(): SavedKubeContext[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as SavedKubeContext[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item) =>
        item &&
        typeof item.id === 'string' &&
        typeof item.name === 'string' &&
        typeof item.enabled === 'boolean',
    );
  } catch {
    return [];
  }
}

export function persistSavedContexts(contexts: SavedKubeContext[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(contexts));
}

export function getActiveGlobalContext(contexts: SavedKubeContext[]): string {
  const active = contexts.find((item) => item.enabled);
  return active?.name.trim() ?? '';
}

export function createSavedContext(name: string): SavedKubeContext {
  return {
    id: `ctx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim(),
    enabled: false,
  };
}
