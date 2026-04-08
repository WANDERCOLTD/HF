'use client';

/**
 * SurveyStopDetail — preview + inline edit of survey questions for a journey rail stop.
 *
 * Features:
 * - Read-only preview of what learners see
 * - Inline edit via SurveyPhaseEditor for survey questions
 * - MCQ preview with question count selector, exclude (×), regenerate
 * - Link to full question bank
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { ClipboardList, Star, Hash, MessageSquare, CircleDot, CheckCircle2, Pencil, X, Check, RefreshCw, ExternalLink } from 'lucide-react';
import './survey-stop-detail.css';
import type { SurveyStepConfig } from '@/lib/types/json-fields';
import {
  DEFAULT_MID_SURVEY,
  DEFAULT_OFFBOARDING_SURVEY,
} from '@/lib/learner/survey-config';
import { DEFAULT_PERSONALITY_QUESTIONS } from '@/lib/assessment/personality-defaults';
import { SurveyPhaseEditor } from './SurveyPhaseEditor';

// ---------------------------------------------------------------------------
// Type icons
// ---------------------------------------------------------------------------

const TYPE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  stars: Star,
  options: CircleDot,
  nps: Hash,
  text: MessageSquare,
  true_false: CheckCircle2,
  mcq: CheckCircle2,
};

// ---------------------------------------------------------------------------
// Question count options
// ---------------------------------------------------------------------------

const QUESTION_COUNT_OPTIONS = [3, 5, 7, 10];

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

type McqPreview = { questions: SurveyStepConfig[]; skipped: boolean; skipReason?: string; sourceId?: string };

export interface SurveyStopDetailProps {
  type: string;
  playbookConfig?: Record<string, unknown> | null;
  /** When provided, sections become editable. Called with (sectionKey, questions). */
  onSave?: (sectionKey: string, questions: SurveyStepConfig[]) => void;
  /** Whether a save is in progress */
  saving?: boolean;
  /** Pre-loaded MCQ questions for pre-test assessment preview */
  mcqPreview?: McqPreview | null;
  /** Mid-test MCQ preview (comprehension courses) */
  midTestMcqPreview?: McqPreview | null;
  /** Post-test MCQ preview (comprehension courses — different from pre-test mirror) */
  postTestMcqPreview?: McqPreview | null;
  /** Whether the course is comprehension-led */
  isComprehension?: boolean;
  /** Callback to regenerate MCQs */
  onRegenerate?: () => void;
  /** Whether regeneration is in progress */
  regenerating?: boolean;
  /** Callback to change assessment config (e.g. questionCount, excludedIds). testType defaults to 'preTest'. */
  onAssessmentConfigChange?: (patch: Record<string, unknown>, testType?: string) => void;
}

// ---------------------------------------------------------------------------
// Section model
// ---------------------------------------------------------------------------

interface Section {
  key: string;
  label: string;
  description: string;
  questions: SurveyStepConfig[];
  isDynamic?: boolean;
  editable?: boolean;
}

// ---------------------------------------------------------------------------
// Resolve questions for each stop type
// ---------------------------------------------------------------------------

function resolveQuestions(
  type: string,
  config: Record<string, unknown> | null | undefined,
  mcqPreview?: McqPreview | null,
  excludedIds?: Set<string>,
  midTestMcqPreview?: McqPreview | null,
  postTestMcqPreview?: McqPreview | null,
  isComprehension?: boolean,
): { sections: Section[] } {
  const cfg = config ?? {};
  const surveys = cfg.surveys as Record<string, { enabled?: boolean; questions?: SurveyStepConfig[] }> | undefined;
  const assessment = cfg.assessment as Record<string, { enabled?: boolean; questions?: SurveyStepConfig[]; questionCount?: number }> | undefined;

  if (type === 'pre_survey') {
    const personalityQs = assessment?.personality?.questions ?? DEFAULT_PERSONALITY_QUESTIONS;
    // Comprehension courses default to pre-test off (passage-dependent questions)
    const preTestDefault = isComprehension ? false : true;
    const preTestEnabled = assessment?.preTest?.enabled ?? preTestDefault;
    const preTestCount = (assessment?.preTest as any)?.questionCount ?? 5;

    const sections: Section[] = [
      { key: 'personality', label: 'Personality Profile', description: 'Learning preferences & self-assessment', questions: personalityQs, editable: true },
    ];
    if (preTestEnabled) {
      const hasMcqs = mcqPreview && !mcqPreview.skipped && mcqPreview.questions.length > 0;
      const filteredQs = hasMcqs
        ? mcqPreview!.questions.filter((q) => !excludedIds?.has(q.contentQuestionId ?? q.id))
        : [];
      sections.push({
        key: 'pre_test',
        label: 'Knowledge Check',
        description: hasMcqs
          ? `${filteredQs.length} question${filteredQs.length !== 1 ? 's' : ''} from uploaded content`
          : mcqPreview?.skipped
            ? `No questions available (${mcqPreview.skipReason ?? 'no content'})`
            : `${preTestCount} questions sourced from curriculum content (MCQ)`,
        questions: filteredQs,
        isDynamic: !hasMcqs,
      });
    }
    return { sections };
  }

  if (type === 'mid_survey') {
    const sections: Section[] = [];
    const midQs = surveys?.mid?.questions ?? DEFAULT_MID_SURVEY;
    sections.push({ key: 'mid', label: 'Satisfaction Check-in', description: 'Progress & satisfaction', questions: midQs, editable: true });

    // Mid Knowledge Check — comprehension courses with midTest enabled
    if (assessment?.midTest?.enabled) {
      const hasMcqs = midTestMcqPreview && !midTestMcqPreview.skipped && midTestMcqPreview.questions.length > 0;
      sections.push({
        key: 'mid_test',
        label: 'Knowledge Check',
        description: hasMcqs
          ? `${midTestMcqPreview!.questions.length} comprehension skill question${midTestMcqPreview!.questions.length !== 1 ? 's' : ''}`
          : 'Comprehension questions from course content',
        questions: hasMcqs ? midTestMcqPreview!.questions : [],
        isDynamic: !hasMcqs,
      });
    }
    return { sections };
  }

  if (type === 'post_survey') {
    const sections: Section[] = [];
    const postTestEnabled = assessment?.postTest?.enabled !== false;

    if (postTestEnabled) {
      // Comprehension: show actual POST_TEST questions (not pre-test mirror)
      if (isComprehension && postTestMcqPreview) {
        const hasMcqs = !postTestMcqPreview.skipped && postTestMcqPreview.questions.length > 0;
        sections.push({
          key: 'post_test',
          label: 'Knowledge Check',
          description: hasMcqs
            ? `${postTestMcqPreview.questions.length} comprehension skill question${postTestMcqPreview.questions.length !== 1 ? 's' : ''}`
            : 'Comprehension questions from course content',
          questions: hasMcqs ? postTestMcqPreview.questions : [],
          isDynamic: !hasMcqs,
        });
      } else if (!isComprehension) {
        // Knowledge: mirror pre-test (existing behavior)
        const hasMcqs = mcqPreview && !mcqPreview.skipped && mcqPreview.questions.length > 0;
        sections.push({
          key: 'post_test',
          label: 'Knowledge Check',
          description: hasMcqs
            ? `Same ${mcqPreview!.questions.length} questions as pre-test — measures knowledge uplift`
            : 'Same questions as pre-test — measures knowledge uplift',
          questions: hasMcqs ? mcqPreview!.questions : [],
          isDynamic: !hasMcqs,
        });
      }
    }

    const postQs = surveys?.post?.questions ?? DEFAULT_OFFBOARDING_SURVEY;
    sections.push({ key: 'post', label: 'Course Feedback', description: 'Satisfaction & NPS', questions: postQs, editable: true });
    return { sections };
  }

  return { sections: [] };
}

// ---------------------------------------------------------------------------
// Read-only question list (with optional exclude button)
// ---------------------------------------------------------------------------

function QuestionList({
  questions,
  onExclude,
}: {
  questions: SurveyStepConfig[];
  onExclude?: (questionId: string) => void;
}): React.ReactElement {
  return (
    <ul className="ssd-question-list">
      {questions.map((q) => {
        const Icon = TYPE_ICONS[q.type] ?? MessageSquare;
        return (
          <li key={q.id} className="ssd-question-row">
            <Icon size={12} className="ssd-question-icon" />
            <span className="ssd-question-prompt">{q.prompt}</span>
            {q.type === 'true_false' && (
              <span className="ssd-type-badge ssd-type-badge--tf">T/F</span>
            )}
            {q.options && q.options.length > 2 && (
              <span className="hf-text-xs hf-text-muted">
                {q.options.length} options
              </span>
            )}
            {q.optional && (
              <span className="ssd-optional-badge">optional</span>
            )}
            {onExclude && (
              <button
                className="hf-btn-ghost ssd-exclude-btn"
                onClick={() => onExclude(q.contentQuestionId ?? q.id)}
                title="Exclude this question"
              >
                <X size={11} />
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Section component (handles edit toggle per section)
// ---------------------------------------------------------------------------

function SectionBlock({
  section,
  onSave,
  saving,
  onRegenerate,
  regenerating,
  questionCount,
  onQuestionCountChange,
  onExclude,
  sourceId,
}: {
  section: Section;
  onSave?: (sectionKey: string, questions: SurveyStepConfig[]) => void;
  saving?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
  questionCount?: number;
  onQuestionCountChange?: (count: number) => void;
  onExclude?: (questionId: string) => void;
  sourceId?: string;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SurveyStepConfig[]>(section.questions);
  const canEdit = section.editable && !!onSave;
  const isAssessment = section.key === 'pre_test' || section.key === 'mid_test' || section.key === 'post_test';

  const handleEdit = useCallback(() => {
    setDraft([...section.questions]);
    setEditing(true);
  }, [section.questions]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setDraft(section.questions);
  }, [section.questions]);

  const handleSave = useCallback(() => {
    onSave?.(section.key, draft);
    setEditing(false);
  }, [onSave, section.key, draft]);

  return (
    <div className="ssd-section">
      <div className="ssd-section-header">
        <ClipboardList size={13} className="hf-text-muted" />
        <span className="ssd-section-label">{section.label}</span>

        {/* Question count selector — assessment sections only */}
        {isAssessment && section.key === 'pre_test' && onQuestionCountChange && (
          <select
            className="ssd-count-select"
            value={questionCount ?? 5}
            onChange={(e) => onQuestionCountChange(Number(e.target.value))}
            title="Number of assessment questions"
          >
            {QUESTION_COUNT_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} Qs</option>
            ))}
          </select>
        )}

        {!section.isDynamic && !editing && !isAssessment && section.questions.length > 0 && (
          <span className="hf-text-xs hf-text-muted">
            {section.questions.length} question{section.questions.length !== 1 ? 's' : ''}
          </span>
        )}
        {canEdit && !editing && (
          <button className="hf-btn-ghost ssd-edit-btn" onClick={handleEdit} title="Edit questions">
            <Pencil size={12} />
          </button>
        )}
        {editing && (
          <div className="ssd-edit-actions">
            <button className="hf-btn-ghost ssd-cancel-btn" onClick={handleCancel} title="Cancel" disabled={saving}>
              <X size={13} />
            </button>
            <button className="hf-btn-ghost ssd-save-btn" onClick={handleSave} title="Save" disabled={saving}>
              <Check size={13} />
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        )}
      </div>
      <p className="hf-text-xs hf-text-muted ssd-section-desc">{section.description}</p>

      {section.isDynamic ? (
        <div className="ssd-dynamic-note">
          <span className="hf-text-xs hf-text-muted">Questions auto-selected from curriculum content at runtime</span>
          {onRegenerate && (
            <button
              className="hf-btn-ghost ssd-regen-btn"
              onClick={onRegenerate}
              disabled={regenerating}
              title="Regenerate assessment questions from content"
            >
              <RefreshCw size={12} className={regenerating ? 'hf-glow-active' : ''} />
              {regenerating ? 'Regenerating…' : 'Regenerate'}
            </button>
          )}
        </div>
      ) : isAssessment && section.questions.length > 0 && !editing ? (
        <>
          <QuestionList questions={section.questions} onExclude={onExclude} />
          <div className="ssd-assessment-actions">
            {onRegenerate && (
              <button
                className="hf-btn-ghost ssd-regen-btn"
                onClick={onRegenerate}
                disabled={regenerating}
                title="Regenerate assessment questions from content"
              >
                <RefreshCw size={12} className={regenerating ? 'hf-glow-active' : ''} />
                {regenerating ? 'Regenerating…' : 'Regenerate'}
              </button>
            )}
            {sourceId && isAssessment && (
              <Link href={`/x/content-sources/${sourceId}`} className="hf-btn-ghost ssd-bank-link" title="View full question bank">
                <ExternalLink size={12} />
                Question bank
              </Link>
            )}
          </div>
        </>
      ) : editing ? (
        <SurveyPhaseEditor steps={draft} onChange={setDraft} disabled={saving} />
      ) : (
        <QuestionList questions={section.questions} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SurveyStopDetail({
  type,
  playbookConfig,
  onSave,
  saving,
  mcqPreview,
  midTestMcqPreview,
  postTestMcqPreview,
  isComprehension,
  onRegenerate,
  regenerating,
  onAssessmentConfigChange,
}: SurveyStopDetailProps): React.ReactElement {
  const cfg = (playbookConfig ?? {}) as Record<string, any>;
  const questionCount = cfg.assessment?.preTest?.questionCount ?? 5;
  const excludedIds = new Set<string>((cfg.assessment?.preTest?.excludedQuestionIds as string[]) ?? []);

  const { sections } = resolveQuestions(
    type, playbookConfig as Record<string, unknown>, mcqPreview, excludedIds,
    midTestMcqPreview, postTestMcqPreview, isComprehension,
  );

  const handleQuestionCountChange = useCallback((count: number) => {
    onAssessmentConfigChange?.({ questionCount: count }, 'preTest');
  }, [onAssessmentConfigChange]);

  const handleExclude = useCallback((questionId: string) => {
    const current = (cfg.assessment?.preTest?.excludedQuestionIds as string[]) ?? [];
    if (current.includes(questionId)) return;
    onAssessmentConfigChange?.({ excludedQuestionIds: [...current, questionId] }, 'preTest');
  }, [cfg, onAssessmentConfigChange]);

  // Resolve sourceId per section type
  const getSourceId = (key: string): string | undefined => {
    if (key === 'pre_test') return mcqPreview?.sourceId;
    if (key === 'mid_test') return midTestMcqPreview?.sourceId;
    if (key === 'post_test') return (isComprehension ? postTestMcqPreview : mcqPreview)?.sourceId;
    return undefined;
  };

  return (
    <div className="ssd-root">
      {sections.map((section) => (
        <SectionBlock
          key={section.key}
          section={section}
          onSave={onSave}
          saving={saving}
          onRegenerate={(section.key === 'pre_test' || section.key === 'mid_test' || section.key === 'post_test') ? onRegenerate : undefined}
          regenerating={regenerating}
          questionCount={questionCount}
          onQuestionCountChange={(section.key === 'pre_test') ? handleQuestionCountChange : undefined}
          onExclude={(section.key === 'pre_test') ? handleExclude : undefined}
          sourceId={getSourceId(section.key)}
        />
      ))}
    </div>
  );
}
