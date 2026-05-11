'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeftRight, Loader2, AlertTriangle, FileText, ExternalLink } from 'lucide-react';

interface ComposedPromptDoc {
  id: string;
  callerId: string;
  playbookId: string | null;
  playbook?: { id: string; name: string } | null;
  prompt: string;
  llmPrompt: Record<string, unknown> | null;
  status: string;
  triggerType: string;
  composedAt: string;
  inputs: Record<string, unknown> | null;
}

interface Sibling {
  id: string;
  composedAt: string;
  triggerType: string;
  status: string;
  callerId: string;
}

interface DiffResponse {
  ok: boolean;
  left: { id: string; composedAt: string; triggerType: string } | null;
  right: { id: string; composedAt: string; triggerType: string };
  unifiedDiff: string;
  lines: Array<{ value: string; added: boolean; removed: boolean }>;
  message?: string;
  error?: string;
}

export default function ComposedPromptPage() {
  const params = useParams<{ promptId: string }>();
  const promptId = params.promptId;

  const [prompt, setPrompt] = useState<ComposedPromptDoc | null>(null);
  const [siblings, setSiblings] = useState<Sibling[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [compareAgainst, setCompareAgainst] = useState<string>('previous');
  const [diff, setDiff] = useState<DiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);

  const [view, setView] = useState<'prompt' | 'raw' | 'diff' | 'trace'>('prompt');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/composed-prompts/${promptId}?siblings=20`)
      .then((r) => r.json())
      .then((data) => {
        if (!alive) return;
        if (!data.ok) {
          setError(data.error || 'Failed to load');
        } else {
          setPrompt(data.prompt);
          setSiblings(data.siblings || []);
        }
      })
      .catch((err) => alive && setError(err.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [promptId]);

  const fetchDiff = useCallback(
    async (against: string) => {
      setDiffLoading(true);
      try {
        const res = await fetch(
          `/api/composed-prompts/${promptId}/diff?against=${encodeURIComponent(against)}`,
        );
        const data: DiffResponse = await res.json();
        setDiff(data);
      } catch (err) {
        setDiff({
          ok: false,
          left: null,
          right: { id: promptId, composedAt: '', triggerType: '' },
          unifiedDiff: '',
          lines: [],
          error: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setDiffLoading(false);
      }
    },
    [promptId],
  );

  useEffect(() => {
    if (view === 'diff' && !diff && prompt) {
      fetchDiff(compareAgainst);
    }
  }, [view, diff, compareAgainst, fetchDiff, prompt]);

  const sectionEntries = useMemo(() => {
    if (!prompt?.llmPrompt) return [];
    return Object.entries(prompt.llmPrompt).filter(([k]) => !k.startsWith('_'));
  }, [prompt?.llmPrompt]);

  const trace = useMemo(() => {
    const composition = (prompt?.inputs as { composition?: Record<string, unknown> } | null)?.composition;
    return composition || null;
  }, [prompt?.inputs]);

  if (loading) {
    return (
      <div className="hf-empty">
        <Loader2 size={20} className="hf-spinner-icon" />
      </div>
    );
  }

  if (error || !prompt) {
    return (
      <div className="hf-banner hf-banner-error">
        <AlertTriangle size={14} />
        <div>{error || 'Prompt not found'}</div>
      </div>
    );
  }

  return (
    <div>
      <div className="hf-mb-md">
        <div className="hf-flex hf-items-center hf-gap-sm">
          <FileText size={18} />
          <h1 className="hf-page-title" style={{ margin: 0 }}>Composed Prompt</h1>
          <span className="hf-pill hf-pill-neutral">{prompt.status}</span>
          {prompt.playbook && (
            <Link href={`/x/courses/${prompt.playbook.id}`} className="hf-pill hf-pill-neutral">
              {prompt.playbook.name}
              <ExternalLink size={10} style={{ marginLeft: 4 }} />
            </Link>
          )}
        </div>
        <p className="hf-text-sm hf-text-muted">
          Composed {new Date(prompt.composedAt).toLocaleString()} via{' '}
          <code>{prompt.triggerType}</code> · prompt ID <code>{prompt.id.slice(0, 8)}</code>
        </p>
      </div>

      {/* View tabs */}
      <div className="hf-flex hf-gap-xs hf-mb-md">
        {(['prompt', 'raw', 'diff', 'trace'] as const).map((v) => (
          <button
            key={v}
            className={`hf-btn ${view === v ? 'hf-btn-primary' : 'hf-btn-secondary'}`}
            onClick={() => setView(v)}
          >
            {v === 'prompt'
              ? 'Prompt'
              : v === 'raw'
                ? 'Raw JSON'
                : v === 'diff'
                  ? 'Compare with previous'
                  : 'Trace'}
          </button>
        ))}
      </div>

      {view === 'prompt' && (
        <div>
          {sectionEntries.length === 0 ? (
            <pre
              className="hf-card"
              style={{ whiteSpace: 'pre-wrap', fontSize: 12, lineHeight: 1.5 }}
            >
              {prompt.prompt || '(empty)'}
            </pre>
          ) : (
            <>
              <div className="hf-flex hf-mb-md" style={{ flexDirection: 'column', gap: 8 }}>
                {sectionEntries.map(([key, value]) => (
                  <details key={key} className="hf-card-compact">
                    <summary
                      className="hf-flex hf-items-center hf-gap-sm"
                      style={{ cursor: 'pointer' }}
                    >
                      <span className="hf-text-sm" style={{ fontWeight: 600 }}>{key}</span>
                    </summary>
                    <pre
                      style={{
                        whiteSpace: 'pre-wrap',
                        fontSize: 11,
                        marginTop: 8,
                        maxHeight: 300,
                        overflow: 'auto',
                      }}
                    >
                      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
                    </pre>
                  </details>
                ))}
              </div>
              <details open>
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
                  {prompt.prompt || '(empty)'}
                </pre>
              </details>
            </>
          )}
        </div>
      )}

      {view === 'raw' && (
        <pre
          className="hf-card"
          style={{ whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.4, overflow: 'auto' }}
        >
          {JSON.stringify(prompt.llmPrompt, null, 2)}
        </pre>
      )}

      {view === 'diff' && (
        <div>
          <div className="hf-flex hf-gap-sm hf-mb-md hf-items-center">
            <ArrowLeftRight size={14} />
            <label className="hf-text-sm" htmlFor="cmp-against">Compare against:</label>
            <select
              id="cmp-against"
              className="hf-input"
              value={compareAgainst}
              onChange={(e) => {
                setCompareAgainst(e.target.value);
                setDiff(null);
                fetchDiff(e.target.value);
              }}
            >
              <option value="previous">Previous prompt on this course</option>
              {siblings.map((s) => (
                <option key={s.id} value={s.id}>
                  {new Date(s.composedAt).toLocaleString()} — {s.triggerType} ({s.id.slice(0, 8)})
                </option>
              ))}
            </select>
          </div>

          {diffLoading && (
            <div className="hf-empty">
              <Loader2 size={20} className="hf-spinner-icon" />
            </div>
          )}

          {diff && !diffLoading && (
            <DiffView diff={diff} />
          )}
        </div>
      )}

      {view === 'trace' && (
        <div>
          {trace ? (
            <pre
              className="hf-card"
              style={{ whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.4, overflow: 'auto' }}
            >
              {JSON.stringify(trace, null, 2)}
            </pre>
          ) : (
            <div className="hf-empty hf-text-sm">
              No trace available — this prompt was composed before the trace block was added.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DiffView({ diff }: { diff: DiffResponse }) {
  if (!diff.ok) {
    return <div className="hf-banner hf-banner-error">{diff.error}</div>;
  }
  if (!diff.left) {
    return (
      <div className="hf-banner hf-banner-info">
        {diff.message || 'No earlier prompt found to compare against.'}
      </div>
    );
  }
  return (
    <div>
      <div className="hf-text-xs hf-text-muted hf-mb-sm">
        <strong>Left</strong>: {new Date(diff.left.composedAt).toLocaleString()} ({diff.left.triggerType}) ·{' '}
        <strong>Right</strong>: {new Date(diff.right.composedAt).toLocaleString()} ({diff.right.triggerType})
      </div>
      <pre
        className="hf-card"
        style={{
          fontSize: 11,
          lineHeight: 1.5,
          overflow: 'auto',
          maxHeight: '70vh',
        }}
      >
        {diff.lines.length === 0 ? (
          <span className="hf-text-muted">No changes.</span>
        ) : (
          diff.lines.map((part, i) => (
            <span
              key={i}
              style={{
                background: part.added
                  ? 'color-mix(in srgb, var(--status-success-text) 18%, transparent)'
                  : part.removed
                    ? 'color-mix(in srgb, var(--status-error-text) 18%, transparent)'
                    : 'transparent',
                color: part.added
                  ? 'var(--status-success-text)'
                  : part.removed
                    ? 'var(--status-error-text)'
                    : 'inherit',
                display: 'block',
                whiteSpace: 'pre-wrap',
              }}
            >
              {part.added ? '+ ' : part.removed ? '- ' : '  '}
              {part.value.replace(/\n$/, '')}
            </span>
          ))
        )}
      </pre>
    </div>
  );
}
