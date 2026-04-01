'use client';

import { Star } from 'lucide-react';
import type { SurveyStepConfig } from '@/lib/types/json-fields';
import './stop-summary-card.css';

// ── Types ──────────────────────────────────────────────

interface Props {
  answers: Record<string, string | number>;
  steps: SurveyStepConfig[];
  onContinue: () => void;
  continueLabel?: string;
}

// ── Renderers for each answer type ─────────────────────

function renderStars(value: number): React.ReactElement {
  const filled = Math.round(Number(value));
  return (
    <span className="stop-summary-stars">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={14}
          fill={n <= filled ? 'var(--accent-primary)' : 'none'}
          stroke={n <= filled ? 'var(--accent-primary)' : 'var(--text-muted)'}
        />
      ))}
    </span>
  );
}

function renderNps(value: number | string): React.ReactElement {
  const n = Number(value);
  const label = n >= 9 ? 'Promoter' : n >= 7 ? 'Passive' : 'Detractor';
  return <span>{n}/10 <span className="hf-text-muted">({label})</span></span>;
}

function renderOption(value: string | number, step: SurveyStepConfig): React.ReactElement {
  const opt = step.options?.find((o) => o.value === String(value));
  return <span>{opt?.label ?? String(value)}</span>;
}

function renderText(value: string | number): React.ReactElement {
  const text = String(value);
  const display = text.length > 120 ? text.slice(0, 117) + '...' : text;
  return <span className="stop-summary-text-answer">{display}</span>;
}

// ── Component ──────────────────────────────────────────

export function StopSummaryCard({ answers, steps, onContinue, continueLabel = 'Continue →' }: Props): React.ReactElement {
  // Only show steps that have answers (skip message-only steps and unanswered optionals)
  const answeredSteps = steps.filter((s) => s.id in answers);

  return (
    <div className="hf-flex hf-items-center hf-justify-center" style={{ minHeight: '60vh' }}>
      <div className="hf-card stop-summary-card">
        <div className="stop-summary-heading">Here&apos;s what you shared</div>

        {answeredSteps.length > 0 ? (
          <dl className="stop-summary-list">
            {answeredSteps.map((step) => {
              const val = answers[step.id];
              return (
                <div key={step.id} className="stop-summary-row">
                  <dt className="stop-summary-label">{step.prompt.replace(/\{subject\}/g, 'this subject')}</dt>
                  <dd className="stop-summary-value">
                    {step.type === 'stars' && renderStars(Number(val))}
                    {step.type === 'nps' && renderNps(val)}
                    {step.type === 'options' && renderOption(val, step)}
                    {step.type === 'text' && renderText(val)}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="hf-text-xs hf-text-muted">No answers recorded.</p>
        )}

        <button className="hf-btn hf-btn-primary stop-summary-continue" onClick={onContinue}>
          {continueLabel}
        </button>
      </div>
    </div>
  );
}
