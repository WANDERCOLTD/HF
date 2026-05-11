'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { X, Loader2, FileSearch, AlertTriangle, RefreshCw } from 'lucide-react';
import type { ComposeTrace } from '@/lib/prompt/composition/types';

interface DryRunPromptModalProps {
  courseId: string;
  /** Authored modules from playbook.config.modules — passed in to avoid a redundant fetch. */
  authoredModules?: Array<{ id: string; title: string }>;
  onClose: () => void;
}

interface DryRunResult {
  ok: boolean;
  callerId?: string;
  callSequence?: number;
  requestedModuleId?: string | null;
  promptSummary?: string;
  llmPrompt?: Record<string, unknown>;
  trace?: ComposeTrace | null;
  metadata?: {
    sectionsActivated: string[];
    sectionsSkipped: string[];
    activationReasons: Record<string, string>;
    loadTimeMs: number;
    transformTimeMs: number;
    identitySpec: string | null;
    playbooksUsed: string[];
    memoriesCount: number;
    behaviorTargetsCount: number;
  };
  error?: string;
}

const CALL_SEQUENCES = [1, 2, 3, 4, 5] as const;

export function DryRunPromptModal({ courseId, authoredModules = [], onClose }: DryRunPromptModalProps) {
  const [callSequence, setCallSequence] = useState<number>(1);
  const [moduleId, setModuleId] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<DryRunResult | null>(null);
  const [view, setView] = useState<'summary' | 'raw' | 'trace'>('summary');

  const run = useCallback(async () => {
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/dry-run-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callSequence,
          requestedModuleId: moduleId || undefined,
        }),
      });
      const data: DryRunResult = await res.json();
      if (!data.ok) {
        setResult({ ok: false, error: data.error || 'Failed to compose dry-run prompt' });
      } else {
        setResult(data);
      }
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoading(false);
    }
  }, [courseId, callSequence, moduleId]);

  // Auto-run on mount with defaults
  useEffect(() => {
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sectionEntries = useMemo(() => {
    if (!result?.llmPrompt) return [];
    return Object.entries(result.llmPrompt).filter(([k]) => !k.startsWith('_'));
  }, [result?.llmPrompt]);

  return (
    <div className="hf-modal-overlay" onClick={onClose}>
      <div
        className="hf-modal"
        style={{ maxWidth: 1100, width: '95vw', height: '90vh', padding: 0, display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="hf-flex hf-items-center hf-justify-between"
          style={{ padding: '16px 24px', borderBottom: '1px solid var(--border-default)' }}
        >
          <div className="hf-flex hf-items-center hf-gap-sm">
            <FileSearch size={18} />
            <div>
              <h3 className="hf-section-title" style={{ margin: 0 }}>Test First Call — Dry Run</h3>
              <p className="hf-text-xs hf-text-muted" style={{ margin: 0 }}>
                Composes the prompt that would fire on a call right now. Nothing is persisted.
              </p>
            </div>
          </div>
          <button className="hf-btn-ghost" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Controls row */}
        <div
          className="hf-flex hf-gap-md hf-items-end"
          style={{ padding: '12px 24px', borderBottom: '1px solid var(--border-default)' }}
        >
          <div>
            <label className="hf-label" htmlFor="dry-run-call-seq">Call sequence</label>
            <select
              id="dry-run-call-seq"
              className="hf-input"
              value={callSequence}
              onChange={(e) => setCallSequence(Number(e.target.value))}
              disabled={loading}
            >
              {CALL_SEQUENCES.map((n) => (
                <option key={n} value={n}>{n === 1 ? '1 (first call)' : `${n}`}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="hf-label" htmlFor="dry-run-module">Module</label>
            <select
              id="dry-run-module"
              className="hf-input"
              value={moduleId}
              onChange={(e) => setModuleId(e.target.value)}
              disabled={loading || authoredModules.length === 0}
            >
              <option value="">(auto / scheduler decides)</option>
              {authoredModules.map((m) => (
                <option key={m.id} value={m.id}>{m.title}</option>
              ))}
            </select>
          </div>
          <button className="hf-btn hf-btn-primary" onClick={run} disabled={loading}>
            {loading ? <Loader2 size={14} className="hf-spinner-icon" /> : <RefreshCw size={14} />}
            Re-run
          </button>

          {/* View tabs */}
          <div className="hf-flex hf-gap-xs" style={{ marginLeft: 'auto' }}>
            {(['summary', 'raw', 'trace'] as const).map((v) => (
              <button
                key={v}
                className={`hf-btn ${view === v ? 'hf-btn-primary' : 'hf-btn-secondary'}`}
                onClick={() => setView(v)}
              >
                {v === 'summary' ? 'Prompt' : v === 'raw' ? 'Raw JSON' : 'Trace'}
              </button>
            ))}
          </div>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'auto', padding: 24 }}>
          {loading && !result && (
            <div className="hf-empty">
              <Loader2 size={20} className="hf-spinner-icon" />
              <div className="hf-text-sm hf-text-muted">Composing prompt…</div>
            </div>
          )}

          {result && !result.ok && (
            <div className="hf-banner hf-banner-error">
              <AlertTriangle size={14} />
              <div>{result.error}</div>
            </div>
          )}

          {result && result.ok && view === 'summary' && (
            <div>
              <div className="hf-flex hf-gap-md hf-mb-md" style={{ flexWrap: 'wrap' }}>
                <Badge label="Identity" value={result.metadata?.identitySpec ?? '(none)'} />
                <Badge label="Caller" value={result.callerId?.slice(0, 8) ?? '—'} />
                <Badge label="Sections" value={`${result.metadata?.sectionsActivated.length ?? 0} on / ${result.metadata?.sectionsSkipped.length ?? 0} off`} />
                <Badge label="Memories" value={String(result.metadata?.memoriesCount ?? 0)} />
                <Badge label="Targets" value={String(result.metadata?.behaviorTargetsCount ?? 0)} />
                <Badge label="Load" value={`${result.metadata?.loadTimeMs ?? 0}ms`} />
              </div>

              {/* Section-by-section accordion */}
              {sectionEntries.length === 0 ? (
                <div className="hf-empty hf-text-sm">No section data in llmPrompt.</div>
              ) : (
                <div className="hf-flex" style={{ flexDirection: 'column', gap: 8 }}>
                  {sectionEntries.map(([key, value]) => (
                    <SectionRow key={key} sectionKey={key} value={value} />
                  ))}
                </div>
              )}

              {/* Full rendered prompt summary */}
              <details className="hf-mt-md" open>
                <summary className="hf-section-title" style={{ cursor: 'pointer', marginBottom: 8 }}>
                  Rendered prompt (markdown)
                </summary>
                <pre
                  className="hf-card"
                  style={{
                    whiteSpace: 'pre-wrap',
                    fontSize: 12,
                    lineHeight: 1.5,
                    maxHeight: 600,
                    overflow: 'auto',
                  }}
                >
                  {result.promptSummary || '(empty)'}
                </pre>
              </details>
            </div>
          )}

          {result && result.ok && view === 'raw' && (
            <pre
              className="hf-card"
              style={{
                whiteSpace: 'pre-wrap',
                fontSize: 11,
                lineHeight: 1.4,
                overflow: 'auto',
              }}
            >
              {JSON.stringify(result.llmPrompt, null, 2)}
            </pre>
          )}

          {result && result.ok && view === 'trace' && (
            <TraceView trace={result.trace ?? null} metadata={result.metadata} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────

function Badge({ label, value }: { label: string; value: string }) {
  return (
    <div className="hf-card-compact hf-flex hf-gap-xs" style={{ alignItems: 'baseline' }}>
      <span className="hf-text-xs hf-text-muted">{label}:</span>
      <span className="hf-text-sm">{value}</span>
    </div>
  );
}

function SectionRow({ sectionKey, value }: { sectionKey: string; value: unknown }) {
  const preview = useMemo(() => {
    if (value == null) return '(null)';
    if (typeof value === 'string') return value.slice(0, 200);
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') return `{${Object.keys(value as object).slice(0, 4).join(', ')}…}`;
    return String(value);
  }, [value]);

  return (
    <details className="hf-card-compact">
      <summary className="hf-flex hf-items-center hf-gap-sm" style={{ cursor: 'pointer' }}>
        <span className="hf-text-sm" style={{ fontWeight: 600 }}>{sectionKey}</span>
        <span className="hf-text-xs hf-text-muted" style={{ flex: 1 }}>{preview}</span>
      </summary>
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          fontSize: 11,
          lineHeight: 1.4,
          marginTop: 8,
          maxHeight: 300,
          overflow: 'auto',
        }}
      >
        {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}

function TraceView({
  trace,
  metadata,
}: {
  trace: ComposeTrace | null;
  metadata?: DryRunResult['metadata'];
}) {
  if (!trace) {
    return <div className="hf-banner hf-banner-warning">No trace data — composition failed silently?</div>;
  }
  return (
    <div className="hf-flex" style={{ flexDirection: 'column', gap: 16 }}>
      <section>
        <h4 className="hf-section-title">Loaders</h4>
        <div className="hf-text-sm">
          <strong>{Object.keys(trace.loadersFired).length} fired</strong>:&nbsp;
          {Object.entries(trace.loadersFired).map(([name, count]) => (
            <span key={name} className="hf-pill hf-pill-neutral" style={{ marginRight: 6 }}>
              {name} ({count})
            </span>
          ))}
        </div>
        {Object.keys(trace.loadersEmpty).length > 0 && (
          <div className="hf-text-sm hf-mt-sm">
            <strong>{Object.keys(trace.loadersEmpty).length} empty</strong>:&nbsp;
            {Object.entries(trace.loadersEmpty).map(([name, reason]) => (
              <span key={name} className="hf-pill" style={{ marginRight: 6 }} title={reason}>
                {name}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <h4 className="hf-section-title">Onboarding flow</h4>
        <div className="hf-text-sm">
          Source: <strong>{trace.onboardingFlowSource ?? '(none)'}</strong>
          {trace.onboardingOverriddenByPlaybook && (
            <span className="hf-pill hf-pill-warning" style={{ marginLeft: 8 }}>
              Playbook overrode Domain
            </span>
          )}
        </div>
      </section>

      <section>
        <h4 className="hf-section-title">Media palette ({trace.mediaPalette.length})</h4>
        {trace.mediaPalette.length === 0 ? (
          <div className="hf-text-sm hf-text-muted">No media surfaced to tutor.</div>
        ) : (
          <ul className="hf-text-sm" style={{ paddingLeft: 16 }}>
            {trace.mediaPalette.map((m, i) => (
              <li key={`${m.fileName}-${i}`}>
                <code>{m.fileName}</code>{' '}
                <span className="hf-text-xs hf-text-muted">[{m.documentType ?? '?'}]</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {trace.assertionsExcluded.firstReasons.length > 0 && (
        <section>
          <h4 className="hf-section-title">Warnings</h4>
          <ul className="hf-text-sm" style={{ paddingLeft: 16 }}>
            {trace.assertionsExcluded.firstReasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>
      )}

      {metadata && (
        <section>
          <h4 className="hf-section-title">Section activation reasons</h4>
          <ul className="hf-text-xs" style={{ paddingLeft: 16, maxHeight: 200, overflow: 'auto' }}>
            {Object.entries(metadata.activationReasons).map(([id, reason]) => (
              <li key={id}>
                <code>{id}</code>: {reason}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
