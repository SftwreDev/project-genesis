import { useEffect, useState } from 'react';
import { MessageSquare, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { SavedSlackProfile } from '../types';
import { maskSecret } from '../utils/savedSlackProfiles';

type Props = {
  profiles: SavedSlackProfile[];
  onAddProfile: (name: string) => void;
  onUpdateProfile: (id: string, patch: Partial<SavedSlackProfile>) => void;
  onDeleteProfile: (id: string) => void;
  onClose: () => void;
};

const emptyDraft = (): Partial<SavedSlackProfile> => ({
  authMode: 'webhook',
  webhookUrl: '',
  botToken: '',
  defaultChannel: '',
  defaultThreadTs: '',
});

export default function SettingsPage({
  profiles,
  onAddProfile,
  onUpdateProfile,
  onDeleteProfile,
  onClose,
}: Props) {
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<SavedSlackProfile>>(emptyDraft());

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const handleAdd = () => {
    const name = newName.trim();
    if (!name) return;
    onAddProfile(name);
    setNewName('');
  };

  const startEdit = (profile: SavedSlackProfile) => {
    setEditingId(profile.id);
    setDraft({ ...profile });
  };

  const saveEdit = () => {
    if (!editingId) return;
    const name = draft.name?.trim();
    if (!name) return;
    onUpdateProfile(editingId, {
      name,
      authMode: draft.authMode === 'bot' ? 'bot' : 'webhook',
      webhookUrl: draft.webhookUrl?.trim() ?? '',
      botToken: draft.botToken?.trim() ?? '',
      defaultChannel: draft.defaultChannel?.trim() ?? '',
      defaultThreadTs: draft.defaultThreadTs?.trim() ?? '',
    });
    setEditingId(null);
    setDraft(emptyDraft());
  };

  return (
    <div className="settings-page" role="dialog" aria-modal="true" aria-label="Settings">
      <div className="settings-page__backdrop" onClick={onClose} />
      <div className="settings-page__panel">
        <header className="settings-page__header">
          <div>
            <h2>Settings</h2>
            <p>Configure integrations used by workflow nodes.</p>
          </div>
          <button type="button" className="settings-page__close" onClick={onClose} aria-label="Close settings">
            <X size={18} />
          </button>
        </header>

        <section className="settings-page__section">
          <div className="settings-page__section-head">
            <MessageSquare size={18} />
            <div>
              <h3>Slack Integration</h3>
              <p>
                Save webhook URLs or bot tokens here. Slack Notify nodes can pick a profile instead of typing
                credentials on every node.
              </p>
            </div>
          </div>

          <div className="settings-page__add">
            <input
              type="text"
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="New profile name (e.g. prod-alerts)"
              onKeyDown={(event) => {
                if (event.key === 'Enter') handleAdd();
              }}
            />
            <button type="button" className="btn btn--ghost" onClick={handleAdd}>
              <Plus size={14} />
              Add profile
            </button>
          </div>

          <div className="settings-page__list">
            {profiles.length === 0 ? (
              <p className="settings-page__empty">No Slack profiles saved yet.</p>
            ) : (
              profiles.map((profile) => (
                <article key={profile.id} className="settings-page__item">
                  {editingId === profile.id ? (
                    <div className="settings-page__edit">
                      <label>
                        <span>Profile name</span>
                        <input
                          type="text"
                          value={draft.name ?? ''}
                          onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                          autoFocus
                        />
                      </label>
                      <label>
                        <span>Auth mode</span>
                        <select
                          value={draft.authMode ?? 'webhook'}
                          onChange={(event) =>
                            setDraft((current) => ({
                              ...current,
                              authMode: event.target.value === 'bot' ? 'bot' : 'webhook',
                            }))
                          }
                        >
                          <option value="webhook">Incoming webhook</option>
                          <option value="bot">Bot token (chat.postMessage)</option>
                        </select>
                      </label>
                      <label>
                        <span>Webhook URL</span>
                        <input
                          type="password"
                          value={draft.webhookUrl ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, webhookUrl: event.target.value }))
                          }
                          placeholder="https://hooks.slack.com/services/..."
                        />
                      </label>
                      <label>
                        <span>Bot token</span>
                        <input
                          type="password"
                          value={draft.botToken ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, botToken: event.target.value }))
                          }
                          placeholder="xoxb-..."
                        />
                      </label>
                      <label>
                        <span>Default channel</span>
                        <input
                          type="text"
                          value={draft.defaultChannel ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, defaultChannel: event.target.value }))
                          }
                          placeholder="#alerts or C01234ABC"
                        />
                      </label>
                      <label>
                        <span>Default thread timestamp</span>
                        <input
                          type="text"
                          value={draft.defaultThreadTs ?? ''}
                          onChange={(event) =>
                            setDraft((current) => ({ ...current, defaultThreadTs: event.target.value }))
                          }
                          placeholder="1234567890.123456"
                        />
                      </label>
                      <div className="settings-page__edit-actions">
                        <button type="button" className="btn btn--primary" onClick={saveEdit}>
                          Save profile
                        </button>
                        <button
                          type="button"
                          className="btn btn--ghost"
                          onClick={() => {
                            setEditingId(null);
                            setDraft(emptyDraft());
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="settings-page__meta">
                        <strong>{profile.name}</strong>
                        <span>{profile.authMode === 'bot' ? 'Bot token' : 'Incoming webhook'}</span>
                        {profile.defaultChannel && <code>{profile.defaultChannel}</code>}
                        {profile.authMode === 'webhook' && profile.webhookUrl && (
                          <span className="settings-page__secret">{maskSecret(profile.webhookUrl)}</span>
                        )}
                        {profile.authMode === 'bot' && profile.botToken && (
                          <span className="settings-page__secret">{maskSecret(profile.botToken)}</span>
                        )}
                      </div>
                      <div className="settings-page__item-actions">
                        <button
                          type="button"
                          className="settings-page__icon-btn"
                          onClick={() => startEdit(profile)}
                          title={`Edit ${profile.name}`}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="settings-page__icon-btn settings-page__icon-btn--danger"
                          onClick={() => onDeleteProfile(profile.id)}
                          title={`Delete ${profile.name}`}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </>
                  )}
                </article>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
