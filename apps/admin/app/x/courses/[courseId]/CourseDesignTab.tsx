'use client';

import { useState, useEffect, useCallback } from 'react';
import { Wand2, ArrowRight, Check, MessageSquare, Target, Brain, ClipboardCheck, Sparkles, ThumbsUp } from 'lucide-react';
import type { WelcomeConfig, NpsConfig } from '@/lib/types/json-fields';
import { DEFAULT_WELCOME_CONFIG, DEFAULT_NPS_CONFIG } from '@/lib/types/json-fields';
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

// ── Welcome Phase Toggles ──────────────────────────────

interface WelcomePhase {
  key: keyof WelcomeConfig;
  label: string;
  description: string;
  icon: React.ReactNode;
}

const WELCOME_PHASES: WelcomePhase[] = [
  { key: 'goals', label: 'Goals', description: 'Students set their learning goals', icon: <Target size={14} /> },
  { key: 'aboutYou', label: 'About You', description: 'Confidence + motivation check', icon: <MessageSquare size={14} /> },
  { key: 'knowledgeCheck', label: 'Knowledge Check', description: 'Baseline MCQs from curriculum', icon: <ClipboardCheck size={14} /> },
  { key: 'aiIntroCall', label: 'AI Introduction', description: 'Warm-up voice/chat call', icon: <Sparkles size={14} /> },
];

// ── Main Component ─────────────────────────────────────

export function CourseDesignTab({
  courseId, playbookConfig,
  detail, subjects, persona, sessionPlan, sessions,
  onSimCall, instructionTotal, categoryCounts, contentMethods, onNavigate,
}: CourseDesignTabProps): React.ReactElement {
  const [welcome, setWelcome] = useState<WelcomeConfig>(DEFAULT_WELCOME_CONFIG);
  const [nps, setNps] = useState<NpsConfig>(DEFAULT_NPS_CONFIG);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [activeState, setActiveState] = useState<FlowState>('WELCOME');

  // Load config from playbook
  useEffect(() => {
    if (playbookConfig?.welcome) {
      setWelcome({ ...DEFAULT_WELCOME_CONFIG, ...(playbookConfig.welcome as Partial<WelcomeConfig>) });
    }
    if (playbookConfig?.nps) {
      setNps({ ...DEFAULT_NPS_CONFIG, ...(playbookConfig.nps as Partial<NpsConfig>) });
    }
  }, [playbookConfig]);

  const saveConfig = useCallback(async (newWelcome: WelcomeConfig, newNps: NpsConfig) => {
    setSaving(true);
    setSaved(false);
    try {
      await fetch(`/api/courses/${courseId}/design`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ welcome: newWelcome, nps: newNps }),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  }, [courseId]);

  const toggleWelcomePhase = useCallback((key: keyof WelcomeConfig) => {
    const updated = { ...welcome, [key]: { enabled: !welcome[key].enabled } };
    setWelcome(updated);
    saveConfig(updated, nps);
  }, [welcome, nps, saveConfig]);

  const toggleNps = useCallback(() => {
    const updated = { ...nps, enabled: !nps.enabled };
    setNps(updated);
    saveConfig(welcome, updated);
  }, [welcome, nps, saveConfig]);

  // Session info from playbook config
  const sessionCount = (playbookConfig?.sessionCount as number) || null;
  const durationMins = (playbookConfig?.durationMins as number) || null;
  const lessonPlanMode = (playbookConfig?.lessonPlanMode as string) || 'structured';

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
  const totalSources = (subjects || []).reduce((sum, s) => sum + s.sourceCount, 0);

  return (
    <div className="hf-mt-lg">
      {/* ── Setup Tracker + Summary (absorbed from Overview) ── */}
      {detail && (
        <>
          <CourseSetupTracker
            courseId={courseId}
            detail={detail}
            subjects={subjects || []}
            sessions={sessions ?? { plan: null }}
            onSimCall={onSimCall}
          />
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

      {/* ── Flow Diagram ─────────────────────────────── */}
      <div className="hf-card hf-mb-lg">
        <div className="hf-flex hf-items-center hf-gap-sm hf-mb-md">
          <Wand2 size={16} className="hf-text-muted" />
          <span className="hf-section-title" style={{ margin: 0 }}>Student Experience Flow</span>
          {saving && <span className="hf-text-xs hf-text-muted">Saving...</span>}
          {saved && <span className="hf-text-xs" style={{ color: 'var(--status-success-text)' }}>Saved</span>}
        </div>

        {/* State machine visual */}
        <div className="cdt-flow-row">
          {FLOW_STATES.map((state, i) => (
            <div key={state.key} className="cdt-flow-item">
              <button
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
      </div>

      {/* ── State Detail Panel ───────────────────────── */}
      {activeState === 'WELCOME' && (
        <div className="hf-card hf-mb-lg">
          <div className="hf-section-title hf-mb-sm">Welcome Flow Phases</div>
          <p className="hf-text-xs hf-text-muted hf-mb-md">
            Configure what students see before their first learning session. Toggle phases on or off.
          </p>
          <div className="cdt-phase-list">
            {WELCOME_PHASES.map((phase) => (
              <label key={phase.key} className="cdt-phase-row">
                <div className="cdt-phase-toggle">
                  <input
                    type="checkbox"
                    checked={welcome[phase.key].enabled}
                    onChange={() => toggleWelcomePhase(phase.key)}
                    className="hf-checkbox"
                  />
                </div>
                <div className="cdt-phase-icon">{phase.icon}</div>
                <div className="cdt-phase-info">
                  <span className="cdt-phase-name">{phase.label}</span>
                  <span className="cdt-phase-desc">{phase.description}</span>
                </div>
              </label>
            ))}
          </div>

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
        <div className="hf-card hf-mb-lg">
          <div className="hf-section-title hf-mb-sm">Learning Sessions</div>
          <div className="cdt-info-grid">
            <div className="cdt-info-item">
              <span className="hf-text-xs hf-text-muted">Mode</span>
              <span className="hf-text-sm hf-text-bold">
                {lessonPlanMode === 'continuous' ? 'Continuous (scheduler-driven)' : 'Structured'}
              </span>
            </div>
            {sessionCount && (
              <div className="cdt-info-item">
                <span className="hf-text-xs hf-text-muted">Sessions</span>
                <span className="hf-text-sm hf-text-bold">{sessionCount}</span>
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
        <div className="hf-card hf-mb-lg">
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
        <div className="hf-card hf-mb-lg">
          <div className="hf-section-title hf-mb-sm">Course Complete</div>
          <p className="hf-text-xs hf-text-muted">
            When all learning outcomes are mastered and feedback is submitted (if enabled),
            students see their progress dashboard with goals, topics, and test scores.
          </p>
        </div>
      )}
    </div>
  );
}
