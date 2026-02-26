'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ArrowRight, Copy, Check, Mail } from 'lucide-react';
import type { StepRenderProps } from '@/components/wizards/types';
import type { InteractionPattern } from '@/lib/content-trust/resolve-config';
import { INTERACTION_PATTERN_LABELS } from '@/lib/content-trust/resolve-config';

const COMMUNITY_PATTERN_LABELS: Partial<Record<InteractionPattern, string>> = {
  companion:    'Just be there',
  advisory:     'Give clear answers',
  coaching:     'Help them take action',
  socratic:     'Guide their thinking',
  facilitation: 'Help them organise',
  reflective:   'Explore and reflect',
  open:         'Follow their lead',
};

const LAUNCH_TIMEOUT_MS = 60_000;

type Phase = 'review' | 'loading' | 'success' | 'error';

interface CreateResult {
  id: string;
  name: string;
  slug: string;
  memberCount: number;
  joinToken: string | null;
  cohortGroupId: string | null;
}

export function CommunityDoneStep({ getData, setData, onPrev, endFlow }: StepRenderProps) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>('review');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Join link + email invite state
  const [copied, setCopied] = useState(false);
  const [inviteEmails, setInviteEmails] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteResult, setInviteResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handleCopy = () => {
    if (!result?.joinToken) return;
    navigator.clipboard.writeText(`${window.location.origin}/join/${result.joinToken}`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSendInvites = async () => {
    if (!result?.id || !inviteEmails.trim()) return;
    const emails = inviteEmails.split(/[,\n]+/).map((e) => e.trim()).filter((e) => e.includes('@'));
    if (emails.length === 0) return;
    setInviting(true);
    setInviteResult(null);
    try {
      const res = await fetch(`/api/communities/${result.id}/invite`, {
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

  // Resume if creation already started (page refresh)
  useEffect(() => {
    const existingResult = getData<CreateResult>('createResult');
    if (existingResult) {
      setResult(existingResult);
      setPhase('success');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleCreate = useCallback(async () => {
    setPhase('loading');
    setError(null);

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => controller.abort(), LAUNCH_TIMEOUT_MS);

    try {
      const hubName = getData<string>('hubName');
      const hubDescription = getData<string>('hubDescription');
      const communityKind = getData<string>('communityKind') ?? 'OPEN_CONNECTION';
      const hubPattern = getData<InteractionPattern>('hubPattern');
      const topics = getData<Array<{ name: string; pattern: InteractionPattern }>>('topics') ?? [];
      const memberCallerIds = getData<string[]>('memberCallerIds') ?? [];

      const res = await fetch('/api/communities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: hubName,
          description: hubDescription,
          communityKind,
          hubPattern,
          topics,
          memberCallerIds,
        }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (!data.ok) throw new Error(data.error || 'Failed to create community');

      setData('createResult', data.community);
      setResult(data.community);
      setPhase('success');
    } catch (err: any) {
      if (err.name === 'AbortError') {
        setError('Request timed out. Please retry.');
      } else {
        setError(err.message || 'Failed to create community');
      }
      setPhase('error');
    } finally {
      clearTimeout(timeout);
    }
  }, [getData, setData]);

  // Auto-launch on mount (no pre-launch review needed — user reviewed in prior steps)
  useEffect(() => {
    const existingResult = getData<CreateResult>('createResult');
    if (!existingResult) {
      handleCreate();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const hubName = getData<string>('hubName') ?? 'Your Community';
  const communityKind = getData<string>('communityKind') ?? 'OPEN_CONNECTION';
  const hubPattern = getData<InteractionPattern>('hubPattern');
  const topics = getData<Array<{ name: string; pattern: InteractionPattern }>>('topics') ?? [];
  const memberCount = (getData<string[]>('memberCallerIds') ?? []).length;

  // ── Success ──
  if (phase === 'success' && result) {
    const patternLabel = hubPattern
      ? (COMMUNITY_PATTERN_LABELS[hubPattern] ?? INTERACTION_PATTERN_LABELS[hubPattern]?.label ?? hubPattern)
      : null;

    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center hf-text-center">
          <div style={{ fontSize: 48, marginBottom: 16 }}>🎉</div>
          <h1 className="hf-page-title hf-mb-xs">{result.name} is live!</h1>
          <p className="hf-page-subtitle hf-mb-lg">
            {memberCount > 0
              ? `Your community hub is ready with ${memberCount} founding member${memberCount !== 1 ? 's' : ''}.`
              : 'Your community hub is ready. Share the join link to start adding members.'}
          </p>

          <div className="hf-card hf-mb-lg" style={{ width: '100%', maxWidth: 400 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Kind</span>
                <span>{communityKind === 'TOPIC_BASED' ? 'Topic-based' : 'Open connection'}</span>
              </div>
              {patternLabel && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>AI style</span>
                  <span>{patternLabel}</span>
                </div>
              )}
              {communityKind === 'TOPIC_BASED' && topics.length > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ color: 'var(--text-muted)' }}>Topics</span>
                  <span>{topics.length}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Members</span>
                <span>{memberCount}</span>
              </div>
            </div>
          </div>

          {/* Join link */}
          {result.joinToken && (
            <div className="hf-card hf-mb-md" style={{ width: '100%', maxWidth: 400 }}>
              <p className="hf-label hf-mb-xs">Share this join link</p>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  readOnly
                  value={`${window.location.origin}/join/${result.joinToken}`}
                  className="hf-input"
                  style={{ flex: 1, fontSize: 13 }}
                />
                <button className="hf-btn hf-btn-secondary hf-flex hf-items-center hf-gap-sm" onClick={handleCopy}>
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Email invite */}
          {result.cohortGroupId && (
            <div className="hf-card hf-mb-lg" style={{ width: '100%', maxWidth: 400 }}>
              <p className="hf-label hf-mb-xs">
                <Mail size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 6 }} />
                Invite members by email
              </p>
              <textarea
                value={inviteEmails}
                onChange={(e) => setInviteEmails(e.target.value)}
                placeholder={'one@email.com, two@email.com'}
                className="hf-input"
                rows={2}
                style={{ width: '100%', resize: 'vertical' }}
              />
              <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
                <button
                  className="hf-btn hf-btn-primary"
                  disabled={inviting || !inviteEmails.trim()}
                  onClick={handleSendInvites}
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

          <div className="hf-flex hf-gap-sm">
            <button
              onClick={() => {
                endFlow();
                router.push(`/x/communities/${result.id}`);
              }}
              className="hf-btn hf-btn-primary hf-flex hf-items-center hf-gap-sm"
            >
              <Users size={16} />
              View Hub
            </button>
            <button
              onClick={() => {
                endFlow();
                router.push('/x/communities');
              }}
              className="hf-btn hf-btn-secondary hf-flex hf-items-center hf-gap-sm"
            >
              All communities
              <ArrowRight size={16} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ──
  if (phase === 'error') {
    return (
      <div className="hf-wizard-page">
        <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center hf-text-center">
          <div style={{ fontSize: 40, marginBottom: 16 }}>❌</div>
          <h1 className="hf-page-title hf-mb-xs">Creation failed</h1>
          <p className="hf-page-subtitle hf-mb-lg">{error || 'An error occurred while creating the hub'}</p>
        </div>
        <div className="hf-step-footer">
          <button onClick={onPrev} className="hf-btn hf-btn-ghost">Back</button>
          <button onClick={handleCreate} className="hf-btn hf-btn-primary">Retry</button>
        </div>
      </div>
    );
  }

  // ── Loading ──
  return (
    <div className="hf-wizard-page">
      <div className="hf-wizard-step hf-flex hf-flex-col hf-items-center hf-justify-center hf-text-center">
        <div className="hf-flex hf-justify-center hf-mb-md">
          <div className="hf-spinner hf-icon-xl hf-spinner-thick" />
        </div>
        <h1 className="hf-page-title hf-mb-xs">Creating {hubName}…</h1>
        <p className="hf-page-subtitle">
          {communityKind === 'TOPIC_BASED' && topics.length > 0
            ? `Setting up ${topics.length} topic${topics.length !== 1 ? 's' : ''}…`
            : 'Setting up your community hub…'}
        </p>
      </div>
    </div>
  );
}
