'use client';

import { SessionFlowEditor } from '@/components/session-flow/SessionFlowEditor';
import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
import { BandingPicker } from '@/components/shared/BandingPicker';
import { CollapsibleCard } from '@/components/shared/CollapsibleCard';
import { FeltProgressSettings } from '@/components/course-design/FeltProgressSettings';
import { FirstSessionSettings } from '@/components/course-design/FirstSessionSettings';
import { CourseSummaryCard } from './CourseSummaryCard';
import { archetypeLabel } from '@/lib/course/group-specs';
import { INTERACTION_PATTERN_LABELS, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import { getTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import { getAudienceOption } from '@/lib/prompt/composition/transforms/audience';
import type { PlaybookConfig } from '@/lib/types/json-fields';
import type { SetupStatusInput } from '@/hooks/useCourseSetupStatus';

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

// ── Main Component ─────────────────────────────────────

export function CourseDesignTab({
  courseId, playbookConfig,
  detail, subjects, persona, sessionPlan, sessions,
  onSimCall, instructionTotal, categoryCounts, contentMethods, onNavigate,
  onReadinessChange,
}: CourseDesignTabProps): React.ReactElement {
  // Session-flow state (intake, NPS, welcome message, onboarding/offboarding
  // phases, mode, etc.) is owned end-to-end by <SessionFlowEditor>, which
  // fetches /api/courses/:id/session-flow on mount and persists via PUT.
  // No mirroring here — one canonical surface.

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
      {/* ── Summary (absorbed from Overview) ──
          Collapsed by default — see CourseSummaryCard. `persistKey` lets each
          course remember its own preference. */}
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
            persistKey={courseId}
          />
        </>
      )}

      {/* ── Session Flow (canonical editor — absorbed from retired tab) ──
          The Session Flow tab was retired in favour of one canonical editor
          on the Design tab. SessionFlowEditor owns its own data fetching
          (GET /api/courses/:id/session-flow) and persistence, so we mount it
          directly — no prop plumbing, no duplicate state. */}
      <CollapsibleCard
        title="Session Flow"
        hint="Before / during / after phases, intake, NPS, welcome"
        defaultOpen
        className="hf-mb-lg"
      >
        <SessionFlowEditor courseId={courseId} />
      </CollapsibleCard>

      {/* ── Felt Progress controls (#784 S6 Section 1 — #779 + #780 namespaces) ── */}
      <CollapsibleCard
        title="Felt Progress"
        hint="Mid-call acknowledgement + structured offboarding summary"
        className="hf-mb-lg"
      >
        <FeltProgressSettings courseId={courseId} playbookConfig={pbConfig} />
      </CollapsibleCard>

      {/* ── Call 1 / First Session settings (#784 S6 Section 2 + #790 S8) ── */}
      <CollapsibleCard
        title="Call 1 / First Session"
        hint="firstCallMode, behaviour targets, course-ref preview"
        className="hf-mb-lg"
      >
        <FirstSessionSettings courseId={courseId} playbookConfig={pbConfig} />
      </CollapsibleCard>

      {/* ── Skill Banding (#417 Story C — per-playbook tier mapping) ── */}
      <CollapsibleCard
        title="Skill Banding"
        hint="Per-course tier mapping override"
        className="hf-mb-lg"
      >
        <BandingPicker
          courseId={courseId}
          current={playbookConfig?.skillTierMapping}
        />
      </CollapsibleCard>

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
