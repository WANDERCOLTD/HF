'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Trash2, Search, Users, MessageSquare, Copy, Check, Mail } from 'lucide-react';
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

  // Join link
  const [copied, setCopied] = useState(false);

  // Email invite
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null);

  const filtered = (community.members || []).filter(m =>
    !search || (m.name || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.email || '').toLowerCase().includes(search.toLowerCase())
  );

  const handleCopyLink = () => {
    if (!community.joinToken) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${community.joinToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendInvites = async () => {
    if (!inviteEmails.trim()) return;
    const emails = inviteEmails.split(/[,\n]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
    if (emails.length === 0) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch(`/api/communities/${community.id}/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();
      if (data.ok) {
        const parts: string[] = [];
        if (data.created > 0) parts.push(`${data.created} invite${data.created !== 1 ? 's' : ''} sent`);
        if (data.skipped > 0) parts.push(`${data.skipped} already invited`);
        setInviteResult({ ok: true, message: parts.join(', ') || 'Done' });
        setInviteEmails('');
      } else {
        setInviteResult({ ok: false, message: data.error ?? 'Failed to send invites' });
      }
    } catch {
      setInviteResult({ ok: false, message: 'Network error' });
    } finally {
      setInviting(false);
    }
  };

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

      {/* Join link */}
      {community.joinToken && (
        <div className="hf-card" style={{ marginBottom: 20 }}>
          <label className="hf-label" style={{ marginBottom: 8, display: 'block' }}>
            <Copy size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
            Join Link
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              readOnly
              value={`${window.location.origin}/join/${community.joinToken}`}
              className="hf-input"
              style={{ flex: 1, fontSize: 13 }}
            />
            <button
              className="hf-btn hf-btn-secondary"
              onClick={handleCopyLink}
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 6 }}>
            Share this link so people can join the community themselves.
          </p>
        </div>
      )}

      {/* Email invite */}
      {community.cohortGroupId && (
        <div className="hf-card" style={{ marginBottom: 20 }}>
          <label className="hf-label" style={{ marginBottom: 8, display: 'block' }}>
            <Mail size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
            Invite by Email
          </label>
          <textarea
            value={inviteEmails}
            onChange={(e) => setInviteEmails(e.target.value)}
            placeholder={'Enter email addresses (one per line or comma-separated)\ne.g. alice@example.com, bob@example.com'}
            className="hf-input"
            rows={3}
            style={{ width: '100%', resize: 'vertical', marginBottom: 8 }}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button
              className="hf-btn hf-btn-primary"
              onClick={handleSendInvites}
              disabled={inviting || !inviteEmails.trim()}
              style={{ fontSize: 13 }}
            >
              {inviting ? 'Sending...' : 'Send Invites'}
            </button>
            {inviteResult && (
              <span style={{ fontSize: 12, color: inviteResult.ok ? 'var(--status-success-text)' : 'var(--status-error-text)' }}>
                {inviteResult.message}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Add member by ID */}
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
