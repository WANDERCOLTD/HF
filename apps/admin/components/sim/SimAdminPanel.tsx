'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { X, ArrowLeft, Copy, Check, ExternalLink, Camera } from 'lucide-react';
import { useSession } from 'next-auth/react';
import { usePathname } from 'next/navigation';
import { LogViewer } from '@/components/shared/LogViewer';
import { useErrorCapture } from '@/contexts/ErrorCaptureContext';
import { useEntityContext } from '@/contexts';
import { buildBugContext, bugContextToMarkdown } from '@/lib/buildBugContext';

type AdminTab = 'debug' | 'logs' | 'bug' | 'links';

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION;
const APP_ENV = process.env.NEXT_PUBLIC_APP_ENV;

interface SimAdminPanelProps {
  onClose: () => void;
  callId: string | null;
  callPhase: 'loading' | 'lobby' | 'active' | 'ended';
  messageCount: number;
  isStreaming: boolean;
  error: string | null;
  newPromptId: string | null;
  callerId: string;
  callerName: string;
  domainName?: string;
  playbookId?: string;
  playbookName?: string;
  subjectDiscipline?: string;
  sessionGoal?: string;
  journeyState?: string;
  activeSurveyStep?: unknown;
}

function CopyableValue({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }, [value]);

  return (
    <span
      className="wa-admin-value wa-admin-copyable"
      onClick={handleCopy}
      title={`Copy ${label}`}
    >
      {value.length > 20 ? `${value.slice(0, 8)}...${value.slice(-6)}` : value}
      {' '}
      {copied ? <Check size={11} /> : <Copy size={11} />}
    </span>
  );
}

function PhaseBadge({ phase }: { phase: string }) {
  return (
    <span className={`wa-admin-phase-badge wa-admin-phase-${phase}`}>
      {phase}
    </span>
  );
}

// ── Debug Tab ──

function DebugTab({ props }: { props: SimAdminPanelProps }) {
  const rows: { label: string; value: React.ReactNode }[] = [
    { label: 'Call ID', value: props.callId ? <CopyableValue value={props.callId} label="Call ID" /> : <span className="wa-admin-value">—</span> },
    { label: 'Phase', value: <PhaseBadge phase={props.callPhase} /> },
    { label: 'Messages', value: <span className="wa-admin-value">{props.messageCount}</span> },
    { label: 'Streaming', value: <span className="wa-admin-value">{props.isStreaming ? 'yes' : 'no'}</span> },
    { label: 'Journey', value: <span className="wa-admin-value">{props.journeyState || '—'}</span> },
    { label: 'Survey', value: <span className="wa-admin-value">{props.activeSurveyStep ? 'active' : '—'}</span> },
    { label: 'Prompt ID', value: props.newPromptId ? <CopyableValue value={props.newPromptId} label="Prompt ID" /> : <span className="wa-admin-value">—</span> },
    { label: 'Playbook', value: <span className="wa-admin-value">{props.playbookName || '—'}</span> },
    { label: 'Subject', value: <span className="wa-admin-value">{props.subjectDiscipline || '—'}</span> },
    { label: 'Institution', value: <span className="wa-admin-value">{props.domainName || '—'}</span> },
    { label: 'Goal', value: <span className="wa-admin-value">{props.sessionGoal || '—'}</span> },
    { label: 'Caller', value: <span className="wa-admin-value">{props.callerName}</span> },
    { label: 'Version', value: <span className="wa-admin-value">{APP_VERSION ? `v${APP_VERSION}` : '—'}</span> },
    { label: 'Env', value: <span className="wa-admin-value">{APP_ENV || '—'}</span> },
  ];

  if (props.error) {
    rows.push({ label: 'Error', value: <span className="wa-admin-value wa-admin-value-error">{props.error}</span> });
  }

  return (
    <>
      {rows.map((r) => (
        <div key={r.label} className="wa-admin-row">
          <span className="wa-admin-label">{r.label}</span>
          {r.value}
        </div>
      ))}
    </>
  );
}

// ── Links Tab ──

function LinksTab({ props }: { props: SimAdminPanelProps }) {
  const links: { label: string; href: string | null }[] = [
    { label: 'View Caller', href: `/x/callers/${props.callerId}` },
    { label: 'View Call', href: props.callId ? `/x/calls/${props.callId}` : null },
    { label: 'View Prompt', href: props.newPromptId ? `/x/prompts/${props.newPromptId}` : null },
    { label: 'View Playbook', href: props.playbookId ? `/x/playbooks/${props.playbookId}` : null },
  ];

  return (
    <>
      {links.map((link) =>
        link.href ? (
          <a
            key={link.label}
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="wa-admin-link"
          >
            <ExternalLink size={16} />
            {link.label}
          </a>
        ) : (
          <div key={link.label} className="wa-admin-link wa-admin-link-disabled">
            <ExternalLink size={16} />
            {link.label}
          </div>
        )
      )}
    </>
  );
}

// ── Bug Tab ──

function BugTab() {
  const [description, setDescription] = useState('');
  const [response, setResponse] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pathname = usePathname();
  const { data: session } = useSession();
  const { getRecentErrors, errorCount } = useErrorCapture();
  const entityContext = useEntityContext();

  const captureScreenshot = useCallback(async () => {
    try {
      const html2canvas = (await import('html2canvas')).default;
      const canvas = await html2canvas(document.body, { scale: 0.5, logging: false });
      setScreenshot(canvas.toDataURL('image/jpeg', 0.6));
    } catch {
      // Screenshot capture can fail in some environments
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() || submitting) return;
    setSubmitting(true);
    setResponse('');

    abortRef.current?.abort();
    abortRef.current = new AbortController();

    const ctx = buildBugContext({
      pathname: pathname || '',
      breadcrumbs: entityContext.breadcrumbs || [],
      getRecentErrors,
      userRole: session?.user?.role as string | undefined,
      screenshotDataUrl: screenshot,
    });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: description.trim(),
          mode: 'BUG',
          entityContext: entityContext.breadcrumbs || [],
          conversationHistory: [],
          bugContext: ctx,
        }),
        signal: abortRef.current.signal,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        setResponse(`**Error:** ${errData?.error || res.statusText}`);
        setSubmitting(false);
        return;
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setResponse(accumulated);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== 'AbortError') {
        setResponse(`**Error:** ${err.message}`);
      }
    } finally {
      setSubmitting(false);
    }
  }, [description, submitting, pathname, entityContext, getRecentErrors, session, screenshot]);

  const handleCopyContext = useCallback(() => {
    const ctx = buildBugContext({
      pathname: pathname || '',
      breadcrumbs: entityContext.breadcrumbs || [],
      getRecentErrors,
      userRole: session?.user?.role as string | undefined,
    });
    const md = bugContextToMarkdown(ctx, [], description, response);
    navigator.clipboard.writeText(md);
  }, [pathname, entityContext, getRecentErrors, session, description, response]);

  useEffect(() => {
    return () => { abortRef.current?.abort(); };
  }, []);

  return (
    <div className="wa-admin-bug-form">
      {errorCount > 0 && (
        <div style={{ fontSize: 13, color: 'var(--status-error-text)' }}>
          {errorCount} recent error{errorCount > 1 ? 's' : ''} captured
        </div>
      )}
      <textarea
        className="wa-admin-bug-textarea"
        placeholder="Describe the issue..."
        value={description}
        onChange={(e) => setDescription(e.target.value)}
      />
      <div className="wa-admin-bug-actions">
        <button
          className="wa-admin-bug-btn wa-admin-bug-btn-primary"
          onClick={handleSubmit}
          disabled={!description.trim() || submitting}
        >
          {submitting ? 'Analysing...' : 'Report Bug'}
        </button>
        <button
          className="wa-admin-bug-btn wa-admin-bug-btn-secondary"
          onClick={captureScreenshot}
          title="Capture screenshot"
        >
          <Camera size={14} /> {screenshot ? 'Retake' : 'Screenshot'}
        </button>
        <button
          className="wa-admin-bug-btn wa-admin-bug-btn-secondary"
          onClick={handleCopyContext}
          title="Copy debug context for Claude Code"
        >
          <Copy size={14} /> Copy Context
        </button>
      </div>
      {response && (
        <div className="wa-admin-bug-response">{response}</div>
      )}
    </div>
  );
}

// ── Main Panel ──

export function SimAdminPanel(props: SimAdminPanelProps) {
  const [tab, setTab] = useState<AdminTab>('debug');
  const { errorCount } = useErrorCapture();

  // Close on Escape
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') props.onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [props.onClose]);

  const tabs: { id: AdminTab; label: string; badge?: number }[] = [
    { id: 'debug', label: 'Debug' },
    { id: 'logs', label: 'Logs' },
    { id: 'bug', label: 'Bug', badge: errorCount || undefined },
    { id: 'links', label: 'Links' },
  ];

  return (
    <div className="wa-admin-panel">
      {/* Header */}
      <div className="wa-admin-header">
        <button className="wa-back-btn" onClick={props.onClose} aria-label="Close admin panel">
          <ArrowLeft size={22} />
        </button>
        <span className="wa-admin-header-title">Admin Panel</span>
        <button className="wa-back-btn" onClick={props.onClose} aria-label="Close">
          <X size={20} />
        </button>
      </div>

      {/* Tabs */}
      <div className="wa-admin-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            className={`wa-admin-tab${tab === t.id ? ' wa-admin-tab-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.badge ? <span className="wa-admin-error-badge">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className={`wa-admin-body${tab === 'logs' ? ' wa-admin-body-flush' : ''}`}>
        {tab === 'debug' && <DebugTab props={props} />}
        {tab === 'logs' && <LogViewer mode="fullscreen" onMinimize={props.onClose} />}
        {tab === 'bug' && <BugTab />}
        {tab === 'links' && <LinksTab props={props} />}
      </div>
    </div>
  );
}
