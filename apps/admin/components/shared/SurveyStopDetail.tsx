'use client';

/**
 * SurveyStopDetail — preview + inline edit of survey questions for a journey rail stop.
 * Shows what learners will see when they reach this survey stop.
 *
 * When `onSave` is provided, each editable section gets an "Edit" button that swaps
 * the read-only list to a SurveyPhaseEditor. Save writes to the parent (typically
 * a PATCH to playbook config).
 */

import { useState, useCallback } from 'react';
import { ClipboardList, Star, Hash, MessageSquare, CircleDot, CheckCircle2, Pencil, X, Check, RefreshCw } from 'lucide-react';
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
// Props
// ---------------------------------------------------------------------------

export interface SurveyStopDetailProps {
  type: string;
  playbookConfig?: Record<string, unknown> | null;
  /** When provided, sections become editable. Called with (sectionKey, questions). */
  onSave?: (sectionKey: string, questions: SurveyStepConfig[]) => void;
  /** Whether a save is in progress */
  saving?: boolean;
  /** Pre-loaded MCQ questions for assessment preview (from buildPreTest) */
  mcqPreview?: { questions: SurveyStepConfig[]; skipped: boolean; skipReason?: string } | null;
  /** Callback to regenerate MCQs — when provided, shows "Regenerate" button on assessment sections */
  onRegenerate?: () => void;
  /** Whether regeneration is in progress */
  regenerating?: boolean;
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
  mcqPreview?: { questions: SurveyStepConfig[]; skipped: boolean; skipReason?: string } | null,
): { sections: Section[] } {
  const cfg = config ?? {};
  const surveys = cfg.surveys as Record<string, { enabled?: boolean; questions?: SurveyStepConfig[] }> | undefined;
  const assessment = cfg.assessment as Record<string, { enabled?: boolean; questions?: SurveyStepConfig[]; questionCount?: number }> | undefined;

  if (type === 'pre_survey') {
    const personalityQs = assessment?.personality?.questions ?? DEFAULT_PERSONALITY_QUESTIONS;
    const preTestEnabled = assessment?.preTest?.enabled !== false;
    const preTestCount = (assessment?.preTest as any)?.questionCount ?? 5;

    const sections: Section[] = [
      { key: 'personality', label: 'Personality', description: 'Learning preferences & self-assessment', questions: personalityQs, editable: true },
    ];
    if (preTestEnabled) {
      const hasMcqs = mcqPreview && !mcqPreview.skipped && mcqPreview.questions.length > 0;
      sections.push({
        key: 'pre_test',
        label: 'Pre-Test',
        description: hasMcqs
          ? `${mcqPreview!.questions.length} questions from uploaded content`
          : mcqPreview?.skipped
            ? `No questions available (${mcqPreview.skipReason ?? 'no content'})`
            : `${preTestCount} questions sourced from curriculum content (MCQ)`,
        questions: hasMcqs ? mcqPreview!.questions : [],
        isDynamic: !hasMcqs,
      });
    }
    return { sections };
  }

  if (type === 'mid_survey') {
    const midQs = surveys?.mid?.questions ?? DEFAULT_MID_SURVEY;
    return { sections: [{ key: 'mid', label: 'Mid Check-in', description: 'Progress & satisfaction', questions: midQs, editable: true }] };
  }

  if (type === 'post_survey') {
    const sections: Section[] = [];
    const preTestEnabled = assessment?.preTest?.enabled !== false;
    if (preTestEnabled) {
      const hasMcqs = mcqPreview && !mcqPreview.skipped && mcqPreview.questions.length > 0;
      sections.push({
        key: 'post_test',
        label: 'Post-Test',
        description: hasMcqs
          ? `Same ${mcqPreview!.questions.length} questions as pre-test — measures knowledge uplift`
          : 'Same questions as pre-test — measures knowledge uplift',
        questions: hasMcqs ? mcqPreview!.questions : [],
        isDynamic: !hasMcqs,
      });
    }
    const postQs = surveys?.post?.questions ?? DEFAULT_OFFBOARDING_SURVEY;
    sections.push({ key: 'post', label: 'Feedback', description: 'Satisfaction & NPS', questions: postQs, editable: true });
    return { sections };
  }

  return { sections: [] };
}

// ---------------------------------------------------------------------------
// Read-only question list
// ---------------------------------------------------------------------------

function QuestionList({ questions }: { questions: SurveyStepConfig[] }): React.ReactElement {
  return (
    <ul className="ssd-question-list">
      {questions.map((q) => {
        const Icon = TYPE_ICONS[q.type] ?? MessageSquare;
        return (
          <li key={q.id} className="ssd-question-row">
            <Icon size={12} className="ssd-question-icon" />
            <span className="ssd-question-prompt">{q.prompt}</span>
            {q.options && q.options.length > 0 && (
              <span className="hf-text-xs hf-text-muted">
                {q.options.length} options
              </span>
            )}
            {q.optional && (
              <span className="ssd-optional-badge">optional</span>
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
}: {
  section: Section;
  onSave?: (sectionKey: string, questions: SurveyStepConfig[]) => void;
  saving?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<SurveyStepConfig[]>(section.questions);
  const canEdit = section.editable && !!onSave;

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
        {!section.isDynamic && !editing && section.questions.length > 0 && (
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
      ) : section.questions.length > 0 && !editing && onRegenerate && (section.key === 'pre_test' || section.key === 'post_test') ? (
        <>
          <QuestionList questions={section.questions} />
          <button
            className="hf-btn-ghost ssd-regen-btn"
            onClick={onRegenerate}
            disabled={regenerating}
            title="Regenerate assessment questions from content"
          >
            <RefreshCw size={12} className={regenerating ? 'hf-glow-active' : ''} />
            {regenerating ? 'Regenerating…' : 'Regenerate'}
          </button>
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

export function SurveyStopDetail({ type, playbookConfig, onSave, saving, mcqPreview, onRegenerate, regenerating }: SurveyStopDetailProps): React.ReactElement {
  const { sections } = resolveQuestions(type, playbookConfig as Record<string, unknown>, mcqPreview);

  return (
    <div className="ssd-root">
      {sections.map((section) => (
        <SectionBlock
          key={section.key}
          section={section}
          onSave={onSave}
          saving={saving}
          onRegenerate={(section.key === 'pre_test' || section.key === 'post_test') ? onRegenerate : undefined}
          regenerating={regenerating}
        />
      ))}
    </div>
  );
}
