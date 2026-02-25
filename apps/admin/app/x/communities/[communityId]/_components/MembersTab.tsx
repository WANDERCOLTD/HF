'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Search, Users, MessageSquare } from 'lucide-react';
import { ErrorBanner } from '@/components/shared/ErrorBanner';
import type { CommunityDetail, CommunityMember } from './types';

interface MembersTabProps {
  community: CommunityDetail;
  onRefresh: () => void;
}

export function MembersTab({ community, onRefresh }: MembersTabProps) {
  const [search, setSearch] = useState('');
  const [addCallerId, setAddCallerId] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filtered = (community.members || []).filter(m =>
    !search || (m.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleAdd = async () => {
    if (!addCallerId.trim()) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${community.id}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerId: addCallerId.trim() }),
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to add member');
      } else {
        setAddCallerId('');
        onRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add member');
    } finally {
      setAdding(false);
    }
  };

  const handleRemove = async (callerId: string) => {
    setRemoving(callerId);
    setError(null);
    try {
      const res = await fetch(`/api/communities/${community.id}/members/${callerId}`, {
        method: 'DELETE',
      });
      const data = await res.json();
      if (!data.ok) {
        setError(data.error || 'Failed to remove member');
      } else {
        onRefresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setRemoving(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 className="hf-section-title">
          Members ({community.memberCount})
        </h2>
      </div>

      <ErrorBanner error={error} style={{ marginBottom: 16 }} />

      {/* Add member */}
      <div className="hf-card" style={{ marginBottom: 20 }}>
        <label className="hf-label" style={{ marginBottom: 8, display: 'block' }}>
          Add Member by Caller ID
        </label>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            className="hf-input"
            placeholder="Caller ID..."
            value={addCallerId}
            onChange={(e) => setAddCallerId(e.target.value)}
            style={{ flex: 1 }}
          />
          <button
            className="hf-btn hf-btn-primary"
            onClick={handleAdd}
            disabled={adding || !addCallerId.trim()}
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            <Plus size={14} />
            {adding ? 'Adding...' : 'Add'}
          </button>
        </div>
      </div>

      {/* Search */}
      <div style={{ position: 'relative', marginBottom: 16 }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input
          className="hf-input"
          placeholder="Search members..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{ width: '100%', paddingLeft: 36 }}
        />
      </div>

      {/* Member list */}
      <div className="hf-card" style={{ padding: 0, overflow: 'hidden' }}>
        {filtered.length === 0 ? (
          <div className="hf-empty" style={{ padding: 32 }}>
            <Users size={24} style={{ color: 'var(--text-muted)', marginBottom: 8 }} />
            <p>{search ? 'No matching members' : 'No members yet'}</p>
          </div>
        ) : (
          <div>
            {filtered.map((member) => (
              <div
                key={member.id}
                className="hf-list-row"
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <div style={{ flex: 1 }}>
                  <Link
                    href={`/x/callers/${member.id}`}
                    style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', textDecoration: 'none' }}
                  >
                    {member.name || 'Unnamed'}
                  </Link>
                  <div style={{ display: 'flex', gap: 12, fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                    {member.email && <span>{member.email}</span>}
                    <span>{member.role}</span>
                    <span>Joined {new Date(member.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                  <Link
                    href={`/x/sim/${member.id}?communityName=${encodeURIComponent(community.name)}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--accent-primary)',
                      opacity: 0.8,
                      padding: 4,
                    }}
                    title="Start sim"
                  >
                    <MessageSquare size={14} />
                  </Link>
                  <button
                    onClick={() => handleRemove(member.id)}
                    disabled={removing === member.id}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--status-error-text)',
                      opacity: removing === member.id ? 0.5 : 0.7,
                      padding: 4,
                    }}
                    title="Remove from community"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
