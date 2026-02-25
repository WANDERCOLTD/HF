'use client';

import { useState, useEffect } from 'react';
import { Plus, X, Pencil, Check, ExternalLink } from 'lucide-react';
import {
  INTERACTION_PATTERN_LABELS,
  type InteractionPattern,
} from '@/lib/content-trust/resolve-config';

interface Topic {
  id: string;
  name: string;
  pattern: string;
  sortOrder: number;
}

interface TopicsTabProps {
  communityId: string;
}

const COMMUNITY_PATTERNS: InteractionPattern[] = [
  'companion', 'advisory', 'coaching', 'socratic', 'facilitation', 'reflective', 'open',
];

const COMMUNITY_PATTERN_LABELS: Partial<Record<InteractionPattern, string>> = {
  companion:    'Just be there',
  advisory:     'Give clear answers',
  coaching:     'Help them take action',
  socratic:     'Guide their thinking',
  facilitation: 'Help them organise',
  reflective:   'Explore and reflect',
  open:         'Follow their lead',
};

export function TopicsTab({ communityId }: TopicsTabProps) {
  const [topics, setTopics] = useState<Topic[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editPattern, setEditPattern] = useState<InteractionPattern>('companion');
  const [saving, setSaving] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPattern, setNewPattern] = useState<InteractionPattern>('companion');

  const loadTopics = async () => {
    try {
      const res = await fetch(`/api/communities/${communityId}/topics`);
      const data = await res.json();
      if (data.ok) {
        setTopics(data.topics);
      } else {
        setError(data.error || 'Failed to load topics');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load topics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadTopics(); }, [communityId]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (topic: Topic) => {
    setEditingId(topic.id);
    setEditName(topic.name);
    setEditPattern((topic.pattern as InteractionPattern) || 'companion');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async (topicId: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/topics/${topicId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim(), pattern: editPattern }),
      });
      const data = await res.json();
      if (data.ok) {
        setTopics((prev) => prev.map((t) => t.id === topicId ? data.topic : t));
        setEditingId(null);
      } else {
        setError(data.error || 'Failed to save');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  };

  const deleteTopic = async (topicId: string) => {
    try {
      const res = await fetch(`/api/communities/${communityId}/topics/${topicId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.ok) {
        setTopics((prev) => prev.filter((t) => t.id !== topicId));
      } else {
        setError(data.error || 'Failed to delete');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const addTopic = async () => {
    if (!newName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/communities/${communityId}/topics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), pattern: newPattern }),
      });
      const data = await res.json();
      if (data.ok) {
        setTopics((prev) => [...prev, data.topic]);
        setNewName('');
        setNewPattern('companion');
        setAddingNew(false);
      } else {
        setError(data.error || 'Failed to add topic');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add topic');
    } finally {
      setSaving(false);
    }
  };

  const patternBadge = (pattern: string) => {
    const p = pattern as InteractionPattern;
    const info = INTERACTION_PATTERN_LABELS[p];
    const label = COMMUNITY_PATTERN_LABELS[p] ?? info?.label ?? pattern;
    return (
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 12,
          padding: '2px 10px',
          borderRadius: 12,
          background: 'var(--surface-secondary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-default)',
        }}
      >
        {info?.icon} {label}
      </span>
    );
  };

  if (loading) {
    return <div className="hf-spinner" style={{ margin: '32px auto' }} />;
  }

  return (
    <div>
      {error && (
        <div className="hf-banner hf-banner-error" style={{ marginBottom: 16 }}>{error}</div>
      )}

      {topics.length === 0 && !addingNew ? (
        <div className="hf-empty hf-mb-lg">
          No topics yet. Add topics to give members specific subjects to discuss.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {topics.map((topic) => (
            <div
              key={topic.id}
              className="hf-card hf-card-compact"
              style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}
            >
              {editingId === topic.id ? (
                <div style={{ flex: 1 }}>
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="hf-input hf-mb-sm"
                    placeholder="Topic name"
                  />
                  <div className="hf-chip-row hf-mb-sm">
                    {COMMUNITY_PATTERNS.map((p) => {
                      const info = INTERACTION_PATTERN_LABELS[p];
                      return (
                        <button
                          key={p}
                          type="button"
                          onClick={() => setEditPattern(p)}
                          className={editPattern === p ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                          title={info.description}
                        >
                          {info.icon} {COMMUNITY_PATTERN_LABELS[p] ?? info.label}
                        </button>
                      );
                    })}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => saveEdit(topic.id)}
                      disabled={saving || !editName.trim()}
                      className="hf-btn hf-btn-primary hf-btn-sm"
                    >
                      <Check size={14} /> Save
                    </button>
                    <button onClick={cancelEdit} className="hf-btn hf-btn-ghost hf-btn-sm">
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div style={{ flex: 1 }}>
                    <p style={{ fontWeight: 600, fontSize: 14, margin: '0 0 4px' }}>{topic.name}</p>
                    {patternBadge(topic.pattern)}
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                    <a
                      href={`/x/content-sources?playbookId=${topic.id}`}
                      title="Upload content for this topic"
                      className="hf-btn hf-btn-ghost hf-btn-sm"
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      <ExternalLink size={14} /> Content
                    </a>
                    <button
                      onClick={() => startEdit(topic)}
                      className="hf-btn hf-btn-ghost hf-btn-sm"
                      title="Edit topic"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => deleteTopic(topic.id)}
                      className="hf-btn hf-btn-ghost hf-btn-sm"
                      title="Remove topic"
                      style={{ color: 'var(--status-error-text)' }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new topic */}
      {addingNew ? (
        <div className="hf-card hf-card-compact hf-mb-md">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="hf-input hf-mb-sm"
            placeholder="Topic name, e.g. Building Maintenance"
            autoFocus
          />
          <div className="hf-chip-row hf-mb-sm">
            {COMMUNITY_PATTERNS.map((p) => {
              const info = INTERACTION_PATTERN_LABELS[p];
              return (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNewPattern(p)}
                  className={newPattern === p ? 'hf-chip hf-chip-selected' : 'hf-chip'}
                  title={info.description}
                >
                  {info.icon} {COMMUNITY_PATTERN_LABELS[p] ?? info.label}
                </button>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              onClick={addTopic}
              disabled={saving || !newName.trim()}
              className="hf-btn hf-btn-primary hf-btn-sm"
            >
              <Check size={14} /> Add topic
            </button>
            <button
              onClick={() => { setAddingNew(false); setNewName(''); }}
              className="hf-btn hf-btn-ghost hf-btn-sm"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        topics.length < 10 && (
          <button
            onClick={() => setAddingNew(true)}
            className="hf-btn hf-btn-secondary"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={16} /> Add topic
          </button>
        )
      )}
    </div>
  );
}
