'use client';

/**
 * SourceStatusDots — tiny inline processing status indicator for a ContentSource.
 *
 * Shows 3 coloured dots: ● extracted  ● embedded  ● structured
 * Green = done, amber pulse = in progress, grey = not started, red = error.
 * Tooltip on hover with detail per stage.
 *
 * The component does NOT poll — parent passes data from its existing fetch.
 * Use with the batch API: GET /api/content-sources/status?ids=a,b,c
 */

import { useMemo } from 'react';

// ── Types ──────────────────────────────────────────────

export interface SourceStatusData {
  assertionCount: number;
  embeddedCount: number;
  structuredCount: number;
  jobStatus: 'pending' | 'extracting' | 'importing' | 'done' | 'error' | null;
  jobError?: string;
}

type DotState = 'done' | 'active' | 'pending' | 'error';

interface SourceStatusDotsProps {
  status: SourceStatusData | null;
  /** Compact mode hides labels (default true) */
  compact?: boolean;
}

// ── Helpers ──────────────────────────────────────────────

function deriveDotStates(s: SourceStatusData): { extracted: DotState; embedded: DotState; structured: DotState } {
  // Extraction
  let extracted: DotState = 'pending';
  if (s.jobStatus === 'error') extracted = 'error';
  else if (s.assertionCount > 0) extracted = 'done';
  else if (s.jobStatus === 'extracting' || s.jobStatus === 'importing') extracted = 'active';
  else if (s.jobStatus === 'pending') extracted = 'pending';

  // Embedding (only if extraction done)
  let embedded: DotState = 'pending';
  if (extracted === 'done') {
    if (s.embeddedCount >= s.assertionCount && s.assertionCount > 0) embedded = 'done';
    else if (s.embeddedCount > 0) embedded = 'active'; // partial
    else embedded = 'active'; // waiting to start
  }

  // Structuring (only if extraction done)
  let structured: DotState = 'pending';
  if (extracted === 'done') {
    if (s.structuredCount > 0) structured = 'done';
    // Structuring is manual, so no "active" state — just pending or done
  }

  return { extracted, embedded, structured };
}

const DOT_COLORS: Record<DotState, string> = {
  done: 'var(--status-success-text)',
  active: 'var(--status-warning-text)',
  pending: 'var(--text-muted)',
  error: 'var(--status-error-text)',
};

const DOT_LABELS: Record<string, string> = {
  extracted: 'Teaching points',
  embedded: 'Embeddings',
  structured: 'Structure',
};

// ── Component ──────────────────────────────────────────

export function SourceStatusDots({ status, compact = true }: SourceStatusDotsProps) {
  const dots = useMemo(() => {
    if (!status) return null;
    return deriveDotStates(status);
  }, [status]);

  if (!dots) return null;

  const entries = [
    { key: 'extracted', state: dots.extracted },
    { key: 'embedded', state: dots.embedded },
    { key: 'structured', state: dots.structured },
  ] as const;

  const tooltip = entries
    .map(({ key, state }) => {
      const label = DOT_LABELS[key];
      const stateLabel = state === 'done' ? 'Ready' : state === 'active' ? 'Processing...' : state === 'error' ? 'Error' : 'Pending';
      return `${label}: ${stateLabel}`;
    })
    .join(' · ');

  return (
    <span
      className="source-status-dots"
      title={tooltip}
    >
      {entries.map(({ key, state }) => (
        <span
          key={key}
          className={state === 'active' ? 'source-dot source-dot--pulse' : 'source-dot'}
          style={{ backgroundColor: DOT_COLORS[state] }}
        />
      ))}
      {!compact && status && (
        <span className="source-dot-label">
          {status.assertionCount > 0
            ? `${status.assertionCount} pts`
            : dots.extracted === 'active' ? 'Extracting...' : ''}
        </span>
      )}
    </span>
  );
}
