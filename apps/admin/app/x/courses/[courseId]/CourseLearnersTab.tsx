'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Users2, TrendingUp, Phone, Target,
  Copy, RefreshCw, Send, RotateCcw, ExternalLink,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────

type EnrolledLearner = {
  type: 'enrolled';
  callerId: string;
  name: string | null;
  email: string | null;
  joinedAt: string;
  callCount: number;
  lastCallAt: string | null;
  status: 'active' | 'joined';
};

type InvitedLearner = {
  type: 'invited';
  inviteId: string;
  email: string;
  invitedAt: string;
  status: 'invited';
};

type Learner = EnrolledLearner | InvitedLearner;

type Summary = {
  enrolled: number;
  active: number;
  totalCalls: number;
  goalRate: number;
};

type Props = {
  courseId: string;
};

// ── Helpers ────────────────────────────────────────────

function relativeDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 30) return `${diffDays}d ago`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case 'active': return { label: 'Active', className: 'cl-badge cl-badge--active' };
    case 'joined': return { label: 'Joined', className: 'cl-badge cl-badge--joined' };
    case 'invited': return { label: 'Invited', className: 'cl-badge cl-badge--invited' };
    default: return { label: status, className: 'cl-badge' };
  }
}

// ── Component ──────────────────────────────────────────

export function CourseLearnersTab({ courseId }: Props): React.ReactElement {
  const [loading, setLoading] = useState(true);
  const [cohortId, setCohortId] = useState<string | null>(null);
  const [joinToken, setJoinToken] = useState<string | null>(null);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [summary, setSummary] = useState<Summary>({ enrolled: 0, active: 0, totalCalls: 0, goalRate: 0 });
  const [emailInput, setEmailInput] = useState('');
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [search, setSearch] = useState('');

  // ── Fetch learners ──

  const fetchLearners = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/learners`);
      const data = await res.json();
      if (data.ok) {
        setCohortId(data.cohortId);
        setJoinToken(data.joinToken);
        setLearners(data.learners);
        setSummary(data.summary);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [courseId]);

  // ── Ensure cohort on first load ──

  useEffect(() => {
    let cancelled = false;

    async function init(): Promise<void> {
      // First try fetching existing data
      const res = await fetch(`/api/courses/${courseId}/learners`);
      const data = await res.json();

      if (cancelled) return;

      if (data.ok && data.cohortId) {
        setCohortId(data.cohortId);
        setJoinToken(data.joinToken);
        setLearners(data.learners);
        setSummary(data.summary);
        setLoading(false);
        return;
      }

      // No cohort yet — create one
      const ensureRes = await fetch(`/api/courses/${courseId}/learners/ensure-cohort`, { method: 'POST' });
      const ensureData = await ensureRes.json();

      if (cancelled) return;

      if (ensureData.ok) {
        setCohortId(ensureData.cohortId);
        setJoinToken(ensureData.joinToken);
      }
      setLoading(false);
    }

    init();
    return () => { cancelled = true; };
  }, [courseId]);

  // ── Copy join link ──

  const joinUrl = joinToken ? `${window.location.origin}/join/${joinToken}` : null;

  const handleCopy = useCallback(async () => {
    if (!joinUrl) return;
    await navigator.clipboard.writeText(joinUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [joinUrl]);

  // ── Send invites ──

  const handleInvite = useCallback(async () => {
    const emails = emailInput
      .split(/[,\n]+/)
      .map((e) => e.trim())
      .filter((e) => e.includes('@'));

    if (emails.length === 0) return;

    setSending(true);
    setMessage(null);

    try {
      const res = await fetch(`/api/courses/${courseId}/learners/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails }),
      });
      const data = await res.json();

      if (data.ok) {
        const parts: string[] = [];
        if (data.created > 0) parts.push(`${data.created} invite${data.created > 1 ? 's' : ''} sent`);
        if (data.skipped > 0) parts.push(`${data.skipped} skipped (already invited/enrolled)`);
        setMessage({ type: 'success', text: parts.join(', ') });
        setEmailInput('');
        fetchLearners();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to send invites' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setSending(false);
    }
  }, [courseId, emailInput, fetchLearners]);

  // ── Resend invite ──

  const handleResend = useCallback(async (email: string) => {
    try {
      const res = await fetch(`/api/courses/${courseId}/learners/invite`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emails: [email] }),
      });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: 'success', text: `Invite resent to ${email}` });
      }
    } catch {
      // silent
    }
  }, [courseId]);

  // ── Reset learner ──

  const [resetting, setResetting] = useState<string | null>(null);

  const handleReset = useCallback(async (callerId: string, name: string | null) => {
    const displayName = name || 'this learner';
    if (!confirm(`Reset ${displayName} to new learner?\n\nThis deletes all calls, scores, memories, and survey answers. They'll start from onboarding.`)) {
      return;
    }

    setResetting(callerId);
    try {
      const res = await fetch(`/api/callers/${callerId}/reset`, { method: 'POST' });
      const data = await res.json();
      if (data.ok) {
        setMessage({ type: 'success', text: `${displayName} reset — they'll see onboarding on next visit` });
        fetchLearners();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to reset learner' });
      }
    } catch {
      setMessage({ type: 'error', text: 'Network error' });
    } finally {
      setResetting(null);
    }
  }, [fetchLearners]);

  // ── Filter ──

  const filtered = learners.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    if (l.type === 'enrolled') {
      return (l.name?.toLowerCase().includes(q)) || (l.email?.toLowerCase().includes(q));
    }
    return l.email.toLowerCase().includes(q);
  });

  // ── Render ──

  if (loading) {
    return (
      <div className="hf-empty">
        <div className="hf-spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  return (
    <div className="cl-container">
      {/* Summary cards */}
      <div className="cl-summary">
        <div className="hf-card-compact cl-stat">
          <Users2 size={16} className="cl-stat-icon" />
          <div className="cl-stat-value">{summary.enrolled}</div>
          <div className="cl-stat-label">Enrolled</div>
        </div>
        <div className="hf-card-compact cl-stat">
          <TrendingUp size={16} className="cl-stat-icon" />
          <div className="cl-stat-value">{summary.active}</div>
          <div className="cl-stat-label">Active (7d)</div>
        </div>
        <div className="hf-card-compact cl-stat">
          <Phone size={16} className="cl-stat-icon" />
          <div className="cl-stat-value">{summary.totalCalls}</div>
          <div className="cl-stat-label">Total Calls</div>
        </div>
        <div className="hf-card-compact cl-stat">
          <Target size={16} className="cl-stat-icon" />
          <div className="cl-stat-value">{summary.goalRate}%</div>
          <div className="cl-stat-label">Goal Rate</div>
        </div>
      </div>

      {/* Join link */}
      {joinUrl && (
        <div className="hf-card cl-section">
          <div className="cl-section-header">
            <ExternalLink size={14} />
            <span>Share this link with learners to self-enrol</span>
          </div>
          <div className="cl-join-row">
            <code className="cl-join-url">{joinUrl}</code>
            <button className="hf-btn hf-btn-xs" onClick={handleCopy}>
              <Copy size={12} />
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
        </div>
      )}

      {/* Invite by email */}
      <div className="hf-card cl-section">
        <div className="cl-section-header">
          <Send size={14} />
          <span>Invite by email — paste addresses, one per line or comma-separated</span>
        </div>
        <textarea
          className="hf-input cl-email-input"
          value={emailInput}
          onChange={(e) => setEmailInput(e.target.value)}
          placeholder="alice@school.edu, bob@school.edu"
          rows={2}
        />
        <div className="cl-invite-actions">
          {message && (
            <span className={message.type === 'success' ? 'cl-msg-success' : 'cl-msg-error'}>
              {message.text}
            </span>
          )}
          <button
            className="hf-btn hf-btn-primary hf-btn-sm"
            onClick={handleInvite}
            disabled={sending || !emailInput.trim()}
          >
            {sending ? <><div className="hf-spinner" style={{ width: 14, height: 14 }} /> Sending...</> : 'Send Invites'}
          </button>
        </div>
      </div>

      {/* Roster */}
      <div className="hf-card cl-section">
        <div className="cl-roster-header">
          <input
            className="hf-input cl-search"
            type="text"
            placeholder="Search..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <span className="cl-count">{filtered.length} learner{filtered.length !== 1 ? 's' : ''}</span>
          <button className="hf-btn hf-btn-xs" onClick={fetchLearners} title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>

        {filtered.length === 0 ? (
          <div className="hf-empty">
            {learners.length === 0
              ? 'No learners yet. Share the join link or send email invites above.'
              : 'No matches for your search.'}
          </div>
        ) : (
          <table className="cl-table">
            <thead>
              <tr>
                <th>Name / Email</th>
                <th>Status</th>
                <th>Joined</th>
                <th>Calls</th>
                <th>Last Call</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((l) => {
                if (l.type === 'enrolled') {
                  const badge = statusBadge(l.status);
                  return (
                    <tr key={l.callerId} className="cl-row cl-row--link">
                      <td>
                        <Link href={`/x/callers/${l.callerId}`} className="cl-name-link">
                          <div className="cl-name">{l.name || 'Unnamed'}</div>
                          {l.email && <div className="cl-email">{l.email}</div>}
                        </Link>
                      </td>
                      <td><span className={badge.className}>{badge.label}</span></td>
                      <td>{relativeDate(l.joinedAt)}</td>
                      <td>{l.callCount}</td>
                      <td>{relativeDate(l.lastCallAt)}</td>
                      <td className="cl-actions">
                        <button
                          className="hf-btn hf-btn-xs"
                          onClick={() => handleReset(l.callerId, l.name)}
                          disabled={resetting === l.callerId}
                          title="Reset to new learner"
                        >
                          {resetting === l.callerId
                            ? <div className="hf-spinner" style={{ width: 12, height: 12 }} />
                            : <RotateCcw size={12} />}
                        </button>
                        <Link href={`/x/callers/${l.callerId}`} className="cl-drill">
                          <ExternalLink size={12} />
                        </Link>
                      </td>
                    </tr>
                  );
                }

                // Invited
                const badge = statusBadge('invited');
                return (
                  <tr key={l.inviteId} className="cl-row cl-row--invited">
                    <td>
                      <div className="cl-email">{l.email}</div>
                      <div className="cl-pending">pending</div>
                    </td>
                    <td><span className={badge.className}>{badge.label}</span></td>
                    <td>—</td>
                    <td>—</td>
                    <td>—</td>
                    <td>
                      <button
                        className="hf-btn hf-btn-xs"
                        onClick={() => handleResend(l.email)}
                        title="Resend invite"
                      >
                        <RotateCcw size={12} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
