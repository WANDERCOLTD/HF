'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wand2, ArrowRight, Check, Brain, Sparkles, ThumbsUp } from 'lucide-react';
import type { IntakeConfig, NpsConfig } from '@/lib/types/json-fields';
import { DEFAULT_INTAKE_CONFIG, DEFAULT_NPS_CONFIG } from '@/lib/types/json-fields';
import { IntakeToggleGroup, type IntakeValues } from '@/components/wizards/IntakeToggleGroup';
import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
import { CourseSummaryCard } from './CourseSummaryCard';
import { archetypeLabel } from '@/lib/course/group-specs';
import { INTERACTION_PATTERN_LABELS, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import { getTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import { getAudienceOption } from '@/lib/prompt/composition/transforms/audience';
import type { PlaybookConfig } from '@/lib/types/json-fields';
import type { SetupStatusInput } from '@/hooks/useCourseSetupStatus';
import './course-design-tab.css';

// ── Types ──────────────────────────────────────────────

type SubjectSummary = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  defaultTrustLevel: string;
  teachingProfile: string | null;
  sourceCount: number;
  curriculumCount: number;
  assertionCount: number;
};

type PersonaInfo = {
  name: string;
  extendsAgent: string | null | undefined;
  roleStatement: string | null;
  primaryGoal: string | null;
} | null;

type SessionPlanInfo = {
  estimatedSessions: number;
  totalDurationMins: number;
  generatedAt?: string | null;
} | null;

type MethodBreakdown = { teachMethod: string; count: number };

export type CourseDesignTabProps = {
  courseId: string;
  playbookConfig?: Record<string, unknown> | null;
  // Overview data (absorbed from CourseOverviewTab)
  detail?: { id: string; name: string; status: string; config?: Record<string, unknown> | null; domain: { id: string; name: string; slug: string }; publishedAt?: string | null; version?: number } | null;
  subjects?: SubjectSummary[];
  persona?: PersonaInfo;
  sessionPlan?: SessionPlanInfo;
  sessions?: SetupStatusInput['sessions'] | null;
  onSimCall?: () => void;
  instructionTotal?: number;
  categoryCounts?: Record<string, number>;
  contentMethods?: MethodBreakdown[];
  onNavigate?: (tab: string) => void;
  /** Reports setup readiness (completedCount, allComplete) to parent for hero badge */
  onReadinessChange?: (completedCount: number, allComplete: boolean) => void;
};

type FlowState = 'WELCOME' | 'LEARNING' | 'NPS' | 'COMPLETE';

interface FlowStateConfig {
  key: FlowState;
  label: string;
  icon: React.ReactNode;
  description: string;
}

const FLOW_STATES: FlowStateConfig[] = [
  { key: 'WELCOME', label: 'Welcome', icon: <Sparkles size={16} />, description: 'First-time student experience' },
  { key: 'LEARNING', label: 'Learning', icon: <Brain size={16} />, description: 'Teaching sessions' },
  { key: 'NPS', label: 'Feedback', icon: <ThumbsUp size={16} />, description: 'Satisfaction & NPS' },
  { key: 'COMPLETE', label: 'Complete', icon: <Check size={16} />, description: 'Course finished' },
];

// ── Intake ↔ IntakeValues mapping ───────────────────────
//
// `IntakeConfig` is the canonical persistence shape under
// `Playbook.config.sessionFlow.intake`. `IntakeValues` is the flat shape used
// by the shared `<IntakeToggleGroup>` (single source of truth across wizard
// and Design tab). Convert at the UI boundary.

function intakeToValues(i: IntakeConfig): IntakeValues {
  return {
    goals: i.goals.enabled,
    aboutYou: i.aboutYou.enabled,
    knowledgeCheck: i.knowledgeCheck.enabled,
    knowledgeCheckMode: i.knowledgeCheck.deliveryMode ?? 'mcq',
    aiIntroCall: i.aiIntroCall.enabled,
  };
}

function valuesToIntake(v: IntakeValues): IntakeConfig {
  return {
    goals: { enabled: v.goals },
    aboutYou: { enabled: v.aboutYou },
    knowledgeCheck: { enabled: v.knowledgeCheck, deliveryMode: v.knowledgeCheckMode },
    aiIntroCall: { enabled: v.aiIntroCall },
  };
}

// ── Main Component ─────────────────────────────────────

export function CourseDesignTab({
  courseId, playbookConfig,
  detail, subjects, persona, sessionPlan, sessions,
  onSimCall, instructionTotal, categoryCounts, contentMethods, onNavigate,
  onReadinessChange,
}: CourseDesignTabProps): React.ReactElement {
  const [intake, setIntake] = useState<IntakeConfig>(DEFAULT_INTAKE_CONFIG);
  const [nps, setNps] = useState<NpsConfig>(DEFAULT_NPS_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<FlowState>('WELCOME');

  // Load config from playbook — prefer canonical sessionFlow.intake, fall back
  // to legacy `welcome` shape (matches resolveSessionFlow precedence).
  useEffect(() => {
    if (!playbookConfig) return;
    const sf = (playbookConfig.sessionFlow as { intake?: Partial<IntakeConfig> } | undefined);
    if (sf?.intake) {
      setIntake({ ...DEFAULT_INTAKE_CONFIG, ...sf.intake } as IntakeConfig);
    } else if (playbookConfig.welcome) {
      const w = playbookConfig.welcome as {
        goals?: { enabled?: boolean };
        aboutYou?: { enabled?: boolean };
        knowledgeCheck?: { enabled?: boolean };
        aiIntroCall?: { enabled?: boolean };
      };
      setIntake({
        goals: { enabled: w.goals?.enabled ?? DEFAULT_INTAKE_CONFIG.goals.enabled },
        aboutYou: { enabled: w.aboutYou?.enabled ?? DEFAULT_INTAKE_CONFIG.aboutYou.enabled },
        knowledgeCheck: {
          enabled: w.knowledgeCheck?.enabled ?? DEFAULT_INTAKE_CONFIG.knowledgeCheck.enabled,
          deliveryMode: DEFAULT_INTAKE_CONFIG.knowledgeCheck.deliveryMode,
        },
        aiIntroCall: { enabled: w.aiIntroCall?.enabled ?? DEFAULT_INTAKE_CONFIG.aiIntroCall.enabled },
      });
    }
    if (playbookConfig.nps) {
      setNps({ ...DEFAULT_NPS_CONFIG, ...(playbookConfig.nps as Partial<NpsConfig>) });
    }
  }, [playbookConfig]);

  // Persist via the session-flow route. That route writes both
  // `sessionFlow.intake` (canonical) and mirrors to legacy `welcome` for the
  // dual-read window — same pattern the wizard uses. Single write path means
  // every reader (resolveSessionFlow, isPreSurveyEnabled, pedagogy.ts) sees
  // the same shape regardless of where the educator made the change.
  const saveConfig = useCallback(async (newIntake: IntakeConfig, newNps: NpsConfig) => {
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      const res = await fetch(`/api/courses/${courseId}/session-flow`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionFlow: { intake: newIntake }, nps: newNps }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `Save failed (${res.status})`);
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }, [courseId]);

  const handleIntakeChange = useCallback((next: IntakeValues) => {
    const updated = valuesToIntake(next);
    // Skip the redundant initial onChange that fires from IntakeToggleGroup's
    // mount effect — only persist when values actually differ.
    if (JSON.stringify(updated) === JSON.stringify(intake)) return;
    setIntake(updated);
    saveConfig(updated, nps);
  }, [intake, nps, saveConfig]);

  const toggleNps = useCallback(() => {
    const updated = { ...nps, enabled: !nps.enabled };
    setNps(updated);
    saveConfig(intake, updated);
  }, [intake, nps, saveConfig]);

  // Duration from playbook config (sessionCount is now just a budget, not pacing)
  const durationMins = (playbookConfig?.durationMins as number) || null;

  // Overview-derived data (from absorbed CourseOverviewTab)
  const pbConfig = (playbookConfig || {}) as PlaybookConfig;
  const goals = pbConfig.goals || [];
  const audienceId = pbConfig.audience || '';
  const audienceOption = audienceId ? getAudienceOption(audienceId) : null;
  const firstProfile = (subjects || []).find(s => s.teachingProfile)?.teachingProfile;
  const profile = firstProfile ? getTeachingProfile(firstProfile) : null;
  const patternLabel = profile
    ? (INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern]?.label ?? profile.interactionPattern)
    : null;
  const totalTPs = (subjects || []).reduce((sum, s) => sum + s.assertionCount, 0);
  const totalSources = (() => {
    const seen = new Set<string>();
    for (const s of (subjects || [])) for (const src of (s.sources ?? [])) seen.add(src.id);
    return seen.size || (subjects || []).reduce((sum, s) => sum + s.sourceCount, 0);
  })();

  return (
    <div className="hf-mt-lg">
      {/* ── Summary (absorbed from Overview) ── */}
      {detail && (
        <>
          <CourseSummaryCard
            interactionPattern={patternLabel}
            teachingMode={profile?.teachingMode ?? null}
            audienceLabel={audienceOption?.label ?? null}
            audienceAges={audienceOption?.ages ?? null}
            subjectCount={(subjects || []).length}
            totalTPs={totalTPs}
            totalSources={totalSources}
            instructionTotal={instructionTotal || 0}
            categoryCounts={categoryCounts}
            contentMethods={contentMethods}
            goals={goals.map(g => ({ type: g.type, name: g.name }))}
            personaName={persona?.name ?? null}
            personaArchetype={persona?.extendsAgent ? archetypeLabel(persona.extendsAgent) : null}
            sessionPlan={sessionPlan ?? null}
            publishedAt={detail.publishedAt ?? null}
            version={String(detail.version ?? '1')}
            subjectNames={(subjects || []).map(s => s.name)}
            onNavigate={onNavigate || (() => {})}
          />
        </>
      )}

      {/* ── Student Experience Flow (tab-card) ────────── */}
      <div className="hf-card hf-mb-lg">
        <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
          <Wand2 size={16} className="hf-text-muted" />
          <span className="hf-section-title" style={{ margin: 0 }}>Student Experience Flow</span>
          {saving && <span className="hf-text-xs hf-text-muted">Saving...</span>}
          {saved && <span className="hf-text-xs" style={{ color: 'var(--status-success-text)' }}>Saved</span>}
          {saveError && (
            <span className="hf-text-xs" style={{ color: 'var(--status-error-text)' }}>
              Save failed — {saveError}
            </span>
          )}
        </div>

        {/* Tab strip */}
        <div className="cdt-flow-row" role="tablist" aria-label="Student experience phases">
          {FLOW_STATES.map((state, i) => (
            <div key={state.key} className="cdt-flow-item">
              <button
                role="tab"
                aria-selected={activeState === state.key}
                aria-controls={`cdt-panel-${state.key}`}
                className={`cdt-flow-bubble ${activeState === state.key ? 'cdt-flow-bubble--active' : ''}`}
                onClick={() => setActiveState(state.key)}
              >
                {state.icon}
                <span className="cdt-flow-label">{state.label}</span>
              </button>
              {i < FLOW_STATES.length - 1 && (
                <ArrowRight size={14} className="cdt-flow-arrow" />
              )}
            </div>
          ))}
        </div>

        {/* Divider */}
        <div className="cdt-flow-divider" />

        {/* Panel content */}
        {activeState === 'WELCOME' && (
          <div role="tabpanel" id="cdt-panel-WELCOME" className="cdt-flow-panel">
            <div className="hf-section-title hf-mb-sm">Welcome Flow Phases</div>
            <p className="hf-text-xs hf-text-muted hf-mb-md">
              Configure what students see before their first learning session. Toggle phases on or off.
            </p>
            <IntakeToggleGroup
              initial={intakeToValues(intake)}
              onChange={handleIntakeChange}
              showHeader={false}
            />

            {/* Welcome message preview */}
            {typeof playbookConfig?.welcomeMessage === 'string' && playbookConfig.welcomeMessage && (
              <div className="hf-mt-md">
                <div className="hf-text-xs hf-text-bold hf-mb-xs">Welcome Message</div>
                <div className="cdt-welcome-preview">
                  {String(playbookConfig.welcomeMessage).slice(0, 120)}
                  {String(playbookConfig.welcomeMessage).length > 120 ? '...' : ''}
                </div>
              </div>
            )}
          </div>
        )}

        {activeState === 'LEARNING' && (
          <div role="tabpanel" id="cdt-panel-LEARNING" className="cdt-flow-panel">
            <div className="hf-section-title hf-mb-sm">Learning Sessions</div>
            <div className="cdt-info-grid">
              <div className="cdt-info-item">
                <span className="hf-text-xs hf-text-muted">Pacing</span>
                <span className="hf-text-sm hf-text-bold">Scheduler-driven</span>
              </div>
              {(playbookConfig?.sessionCount as number) > 0 && (
                <div className="cdt-info-item">
                  <span className="hf-text-xs hf-text-muted">Session budget</span>
                  <span className="hf-text-sm hf-text-bold">{playbookConfig?.sessionCount as number}</span>
                </div>
              )}
              {durationMins && (
                <div className="cdt-info-item">
                  <span className="hf-text-xs hf-text-muted">Duration</span>
                  <span className="hf-text-sm hf-text-bold">{durationMins} min</span>
                </div>
              )}
            </div>
            <p className="hf-text-xs hf-text-muted hf-mt-sm">
              Session count and duration can be changed on the Journey tab.
            </p>
          </div>
        )}

        {activeState === 'NPS' && (
          <div role="tabpanel" id="cdt-panel-NPS" className="cdt-flow-panel">
            <div className="hf-section-title hf-mb-sm">Student Feedback</div>
            <p className="hf-text-xs hf-text-muted hf-mb-md">
              When enabled, students are asked for feedback (NPS + satisfaction) after reaching the mastery threshold.
            </p>
            <label className="cdt-phase-row">
              <div className="cdt-phase-toggle">
                <input
                  type="checkbox"
                  checked={nps.enabled}
                  onChange={toggleNps}
                  className="hf-checkbox"
                />
              </div>
              <div className="cdt-phase-icon"><ThumbsUp size={14} /></div>
              <div className="cdt-phase-info">
                <span className="cdt-phase-name">NPS & Satisfaction</span>
                <span className="cdt-phase-desc">
                  {nps.trigger === 'mastery'
                    ? `Triggered at ${nps.threshold}% mastery`
                    : `Triggered after ${nps.threshold} sessions`}
                </span>
              </div>
            </label>
          </div>
        )}

        {activeState === 'COMPLETE' && (
          <div role="tabpanel" id="cdt-panel-COMPLETE" className="cdt-flow-panel">
            <div className="hf-section-title hf-mb-sm">Course Complete</div>
            <p className="hf-text-xs hf-text-muted">
              When all learning outcomes are mastered and feedback is submitted (if enabled),
              students see their progress dashboard with goals, topics, and test scores.
            </p>
          </div>
        )}
      </div>

      {/* ── Setup Tracker (bottom — readiness reported to hero via callback) ── */}
      {detail && (
        <CourseSetupTracker
          courseId={courseId}
          detail={detail}
          subjects={subjects || []}
          sessions={sessions ?? { plan: null }}
          onSimCall={onSimCall}
          onReadinessChange={onReadinessChange}
        />
      )}
    </div>
  );
}
