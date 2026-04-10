'use client';

/**
 * SessionDetailPanel — read-only inline detail for a single teaching session.
 * Used inside JourneyRail's expanded view for content-bearing sessions
 * (introduce / deepen / review / assess / consolidate).
 *
 * Stays inline — no overlays, no drawers — so the Journey rail remains visible
 * while the user drills into a session. Lazy-loads rich detail (full TPs,
 * learning objectives, MCQs) from /api/courses/:id/sessions/:n/deep-detail
 * on mount, falls back to the lightweight `tps` prop while loading.
 */

import { useState, useEffect } from 'react';
import {
  Paperclip,
  ExternalLink,
  BookOpen,
  Clock,
  Zap,
  ChevronDown,
  ChevronRight,
  Target,
  HelpCircle,
  CheckCircle2,
  CircleDashed,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { getCategoryStyle } from '@/lib/content-categories';
import type { SessionEntry } from '@/lib/lesson-plan/types';
import type { TPItem } from '@/components/shared/SessionTPList';

// ── Types from /deep-detail endpoint ───────────────────

interface LOShort {
  ref: string;
  description: string;
}

interface DeepDetailTP {
  id: string;
  assertion: string;
  category: string;
  teachMethod: string | null;
  learningOutcomeRef: string | null;
  reviewedAt: string | null;
  reviewer: { id: string; name: string | null; email: string } | null;
  source: { id: string; name: string };
  questionCount: number;
}

interface DeepDetailQuestion {
  id: string;
  questionText: string;
  questionType: string;
  bloomLevel: string | null;
  difficulty: number | null;
  options: { label?: string; text: string; isCorrect?: boolean }[] | null;
  correctAnswer: string | null;
  assertionId: string | null;
}

interface DeepDetailData {
  session: {
    number: number;
    type: string;
    label: string;
    notes: string | null;
    moduleLabel: string | null;
    estimatedDurationMins: number | null;
    learningOutcomeRefs: string[];
  };
  learningObjectives: LOShort[];
  tps: DeepDetailTP[];
  questions: DeepDetailQuestion[];
  reviewed: number;
  total: number;
}

// ── Props ──────────────────────────────────────────────

export interface SessionDetailPanelProps {
  entry: SessionEntry;
  courseId: string;
  /** Lightweight TP list shown while deep-detail is loading. Optional — fallback if fetch fails. */
  tps?: TPItem[];
  showEditLink?: boolean;
}

// ── Component ──────────────────────────────────────────

export function SessionDetailPanel({
  entry,
  courseId,
  tps: fallbackTPs,
  showEditLink,
}: SessionDetailPanelProps) {
  const router = useRouter();
  const phases = entry.phases ?? [];
  const sessionMedia = entry.media ?? [];

  const [deep, setDeep] = useState<DeepDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: reset state when session changes, matches AssertionDetailDrawer pattern
    setLoading(true);
    setError(null);
    fetch(`/api/courses/${courseId}/sessions/${entry.session}/deep-detail`)
      .then((r) => r.json())
      .then((res) => {
        if (cancelled) return;
        if (res.ok) setDeep(res.data);
        else setError(res.error || 'Could not load details');
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Network error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [courseId, entry.session]);

  const reviewed = deep?.reviewed ?? 0;
  const totalTPs = deep?.total ?? fallbackTPs?.length ?? entry.assertionCount ?? 0;
  const questionCount = deep?.questions.length ?? 0;
  const learningObjectives = deep?.learningObjectives ?? [];

  return (
    <div className="sdp-root">
      {/* ── Notes ───────────────────────────── */}
      {entry.notes && (
        <p className="hf-text-xs hf-text-secondary hf-mb-md">{entry.notes}</p>
      )}

      {/* ── Meta row ────────────────────────── */}
      <div className="sdp-meta">
        {entry.moduleLabel && (
          <span className="sdp-meta-item">
            <BookOpen size={12} className="hf-text-muted" />
            {entry.moduleLabel}
          </span>
        )}
        {entry.estimatedDurationMins && (
          <span className="sdp-meta-item">
            <Clock size={12} className="hf-text-muted" />
            {entry.estimatedDurationMins}m
          </span>
        )}
        {totalTPs > 0 && (
          <span className="sdp-meta-item">
            <Zap size={12} className="hf-text-muted" />
            {totalTPs} teaching point{totalTPs !== 1 ? 's' : ''}
            {deep && totalTPs > 0 && (
              <span className="sdp-review-badge">
                {reviewed}/{totalTPs} reviewed
              </span>
            )}
          </span>
        )}
        {questionCount > 0 && (
          <span className="sdp-meta-item">
            <HelpCircle size={12} className="hf-text-muted" />
            {questionCount} question{questionCount !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* ── Learning objectives ─────────────── */}
      {learningObjectives.length > 0 && (
        <div className="sdp-los">
          <Target size={12} className="hf-text-muted sdp-los-icon" />
          <div className="sdp-los-list">
            {learningObjectives.map((lo) => (
              <span
                key={lo.ref}
                className="sdp-lo-chip"
                title={lo.description}
              >
                <strong>{lo.ref}</strong>
                <span className="sdp-lo-desc">{lo.description}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* ── Phases (zebra) ──────────────────── */}
      {phases.length > 0 && (
        <div className="sdp-phases">
          {phases.map((phase, i) => (
            <div
              key={phase.id + i}
              className={`sdp-phase ${i % 2 === 0 ? 'sdp-phase--even' : ''}`}
            >
              <div className="sdp-phase-header">
                <span className="sdp-phase-label">{phase.label}</span>
                {phase.durationMins && (
                  <span className="sdp-phase-dur">{phase.durationMins}m</span>
                )}
              </div>
              {phase.teachMethods && phase.teachMethods.length > 0 && (
                <div className="sdp-phase-methods">
                  {phase.teachMethods.map((m) => (
                    <span key={m} className="hf-chip hf-chip-sm">
                      {m.replace(/_/g, ' ')}
                    </span>
                  ))}
                </div>
              )}
              {phase.guidance && (
                <p className="sdp-phase-guidance">{phase.guidance}</p>
              )}
              {phase.media && phase.media.length > 0 && (
                <div className="sdp-phase-media">
                  {phase.media.map((m) => (
                    <span key={m.mediaId} className="sdp-material-chip">
                      {m.mimeType?.startsWith('image/') ? (
                        <img
                          src={`/api/media/${m.mediaId}`}
                          alt={m.captionText || m.fileName || ''}
                          className="sdp-material-thumb"
                        />
                      ) : (
                        <Paperclip size={10} />
                      )}
                      {m.fileName || m.figureRef || 'File'}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Session-level materials ─────────── */}
      {sessionMedia.length > 0 && (
        <div className="sdp-materials">
          {sessionMedia.map((m) => (
            <span key={m.mediaId} className="sdp-material-chip">
              {m.mimeType?.startsWith('image/') ? (
                <img
                  src={`/api/media/${m.mediaId}`}
                  alt={m.captionText || m.fileName || ''}
                  className="sdp-material-thumb"
                />
              ) : (
                <Paperclip size={10} />
              )}
              {m.fileName || m.figureRef || 'File'}
            </span>
          ))}
        </div>
      )}

      {/* ── Teaching points (rich) ──────────── */}
      {loading && !deep && (
        <div className="sdp-loading">
          <div className="hf-spinner hf-spinner-sm" />
          <span className="hf-text-xs hf-text-muted">Loading details…</span>
        </div>
      )}

      {error && !deep && (
        <div className="hf-banner hf-banner-error">{error}</div>
      )}

      {deep && deep.tps.length > 0 && (
        <TeachingPointsSection
          tps={deep.tps}
          reviewed={reviewed}
          total={totalTPs}
          questions={deep.questions}
        />
      )}

      {/* Fallback TP list while loading — lightweight chips from parent */}
      {loading && !deep && fallbackTPs && fallbackTPs.length > 0 && (
        <div className="sdp-tps">
          <div className="hf-text-xs hf-text-muted hf-mb-xs">Teaching Points</div>
          <div className="sdp-tp-list">
            {fallbackTPs.slice(0, 8).map((tp) => (
              <span key={tp.id} className="sdp-tp-chip" title={tp.assertion}>
                {tp.assertion.length > 60
                  ? tp.assertion.slice(0, 57) + '...'
                  : tp.assertion}
              </span>
            ))}
            {fallbackTPs.length > 8 && (
              <span className="hf-text-xs hf-text-muted">
                +{fallbackTPs.length - 8} more
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Questions (rich) ────────────────── */}
      {deep && deep.questions.length > 0 && (
        <QuestionsSection questions={deep.questions} />
      )}

      {/* ── Empty state ─────────────────────── */}
      {!loading && !error && deep && deep.tps.length === 0 && phases.length === 0 && sessionMedia.length === 0 && !entry.notes && (
        <p className="hf-text-xs hf-text-muted sdp-empty">
          No details yet — teaching points and phases will appear after content is assigned.
        </p>
      )}

      {/* ── Edit link ───────────────────────── */}
      {showEditLink && (
        <button
          className="jrl-detail-link hf-mt-md"
          onClick={(e) => {
            e.stopPropagation();
            router.push(`/x/courses/${courseId}/sessions/${entry.session}`);
          }}
          type="button"
        >
          <ExternalLink size={11} /> Edit session details
        </button>
      )}
    </div>
  );
}

// ── Teaching Points section ────────────────────────────

function TeachingPointsSection({
  tps,
  reviewed,
  total,
  questions,
}: {
  tps: DeepDetailTP[];
  reviewed: number;
  total: number;
  questions: DeepDetailQuestion[];
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [open, setOpen] = useState(false);

  // Group orphans (no LO ref) separately
  const withLo = tps.filter((t) => t.learningOutcomeRef !== null);
  const orphans = tps.filter((t) => t.learningOutcomeRef === null);

  const questionsByTpId = new Map<string, DeepDetailQuestion[]>();
  for (const q of questions) {
    if (!q.assertionId) continue;
    const list = questionsByTpId.get(q.assertionId);
    if (list) list.push(q);
    else questionsByTpId.set(q.assertionId, [q]);
  }

  return (
    <details
      className="sdp-section"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="sdp-section-summary">
        <span className="sdp-section-caret">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="sdp-section-title">Teaching Points</span>
        <span className="hf-badge hf-badge-sm hf-badge-neutral">{total}</span>
        {total > 0 && (
          <span className="hf-text-xs hf-text-muted sdp-section-sub">
            {reviewed} reviewed · {total - reviewed} pending
          </span>
        )}
      </summary>

      <div className="sdp-section-body">
        {withLo.map((tp) => (
          <TPRow
            key={tp.id}
            tp={tp}
            expanded={!!expanded[tp.id]}
            onToggle={() =>
              setExpanded((prev) => ({ ...prev, [tp.id]: !prev[tp.id] }))
            }
            questions={questionsByTpId.get(tp.id) ?? []}
          />
        ))}

        {orphans.length > 0 && (
          <div className="sdp-orphan-block">
            <div className="sdp-orphan-title">
              <CircleDashed size={12} />
              Not linked to a Learning Objective
              <span className="hf-badge hf-badge-sm hf-badge-neutral">
                {orphans.length}
              </span>
            </div>
            {orphans.map((tp) => (
              <TPRow
                key={tp.id}
                tp={tp}
                expanded={!!expanded[tp.id]}
                onToggle={() =>
                  setExpanded((prev) => ({ ...prev, [tp.id]: !prev[tp.id] }))
                }
                questions={questionsByTpId.get(tp.id) ?? []}
              />
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function TPRow({
  tp,
  expanded,
  onToggle,
  questions,
}: {
  tp: DeepDetailTP;
  expanded: boolean;
  onToggle: () => void;
  questions: DeepDetailQuestion[];
}) {
  const cat = getCategoryStyle(tp.category);
  const isReviewed = tp.reviewedAt !== null;

  return (
    <div className={`sdp-tp-row ${expanded ? 'sdp-tp-row--expanded' : ''}`}>
      <button
        type="button"
        className="sdp-tp-row-head"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="sdp-tp-caret">
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span
          className="hf-badge hf-badge-sm sdp-tp-cat"
          style={{ color: cat.color, background: cat.bg }}
        >
          {cat.label}
        </span>
        <span className="sdp-tp-text">{tp.assertion}</span>
        {tp.learningOutcomeRef && (
          <span className="sdp-tp-lo">{tp.learningOutcomeRef}</span>
        )}
        <span
          className={`sdp-review-dot ${isReviewed ? 'sdp-review-dot--done' : 'sdp-review-dot--pending'}`}
          aria-label={isReviewed ? 'Reviewed' : 'Pending review'}
          title={isReviewed ? 'Reviewed' : 'Pending review'}
        />
      </button>

      {expanded && (
        <div className="sdp-tp-body">
          {tp.teachMethod && (
            <div className="sdp-tp-field">
              <span className="hf-text-xs hf-text-muted">Teach method</span>
              <span className="hf-chip hf-chip-sm">
                {tp.teachMethod.replace(/_/g, ' ')}
              </span>
            </div>
          )}
          <div className="sdp-tp-field">
            <span className="hf-text-xs hf-text-muted">Source</span>
            <span className="hf-text-xs">{tp.source.name}</span>
          </div>
          <div className="sdp-tp-field">
            <span className="hf-text-xs hf-text-muted">Review</span>
            {isReviewed ? (
              <span className="hf-text-xs sdp-review-text sdp-review-text--done">
                <CheckCircle2 size={11} />
                Reviewed{tp.reviewer?.name ? ` by ${tp.reviewer.name}` : ''}
                {tp.reviewedAt && ` on ${new Date(tp.reviewedAt).toLocaleDateString()}`}
              </span>
            ) : (
              <span className="hf-text-xs hf-text-muted">Pending review</span>
            )}
          </div>

          {questions.length > 0 && (
            <div className="sdp-tp-questions">
              <span className="hf-text-xs hf-text-muted">
                Linked questions ({questions.length})
              </span>
              {questions.map((q) => (
                <QuestionRow key={q.id} q={q} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Questions (session-level) section ──────────────────

function QuestionsSection({ questions }: { questions: DeepDetailQuestion[] }) {
  const [open, setOpen] = useState(false);
  return (
    <details
      className="sdp-section"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="sdp-section-summary">
        <span className="sdp-section-caret">
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <span className="sdp-section-title">Questions & MCQs</span>
        <span className="hf-badge hf-badge-sm hf-badge-neutral">
          {questions.length}
        </span>
      </summary>
      <div className="sdp-section-body">
        {questions.map((q) => (
          <QuestionRow key={q.id} q={q} />
        ))}
      </div>
    </details>
  );
}

function QuestionRow({ q }: { q: DeepDetailQuestion }) {
  const [expanded, setExpanded] = useState(false);
  const hasOptions = q.options && q.options.length > 0;
  const expandable = hasOptions || !!q.correctAnswer;

  return (
    <div className={`sdp-question-row ${expanded ? 'sdp-question-row--expanded' : ''}`}>
      <button
        type="button"
        className="sdp-question-head"
        onClick={() => expandable && setExpanded((v) => !v)}
        aria-expanded={expanded}
        disabled={!expandable}
      >
        {expandable && (
          <span className="sdp-tp-caret">
            {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
          </span>
        )}
        <span className="hf-badge hf-badge-sm hf-badge-neutral sdp-q-type">
          {formatQuestionType(q.questionType)}
        </span>
        <span className="sdp-q-text">{q.questionText}</span>
        {q.bloomLevel && (
          <span className="sdp-q-bloom" title={`Bloom: ${q.bloomLevel}`}>
            {q.bloomLevel}
          </span>
        )}
      </button>
      {expanded && hasOptions && (
        <ol className="sdp-q-options">
          {q.options!.map((opt, i) => (
            <li
              key={i}
              className={`sdp-q-option ${opt.isCorrect ? 'sdp-q-option--correct' : ''}`}
            >
              {opt.label && <span className="sdp-q-option-label">{opt.label}.</span>}
              <span>{opt.text}</span>
              {opt.isCorrect && (
                <CheckCircle2 size={12} className="sdp-q-correct-icon" />
              )}
            </li>
          ))}
        </ol>
      )}
      {expanded && !hasOptions && q.correctAnswer && (
        <div className="sdp-q-answer">
          <span className="hf-text-xs hf-text-muted">Answer</span>
          <span className="hf-text-xs">{q.correctAnswer}</span>
        </div>
      )}
    </div>
  );
}

function formatQuestionType(type: string): string {
  return type
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
