'use client';

import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
import { CourseSummaryCard } from './CourseSummaryCard';
import { archetypeLabel } from '@/lib/course/group-specs';
import { INTERACTION_PATTERN_LABELS, type InteractionPattern } from '@/lib/content-trust/resolve-config';
import { getTeachingProfile } from '@/lib/content-trust/teaching-profiles';
import { getAudienceOption } from '@/lib/prompt/composition/transforms/audience';
import type { PlaybookConfig } from '@/lib/types/json-fields';
import type { SetupStatusInput } from '@/hooks/useCourseSetupStatus';

// ── Types ──────────────────────────────────────────

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

export type CourseOverviewTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
    publishedAt?: string | null;
    version?: number;
  };
  subjects: SubjectSummary[];
  persona: PersonaInfo;
  sessionPlan: SessionPlanInfo;
  sessions: SetupStatusInput['sessions'];
  onSimCall?: () => void;
  instructionTotal: number;
  categoryCounts?: Record<string, number>;
  contentMethods?: MethodBreakdown[];
  onNavigate: (tab: string) => void;
};

// ── Main Component ─────────────────────────────────

export function CourseOverviewTab({
  courseId,
  detail,
  subjects,
  persona,
  sessionPlan,
  sessions,
  onSimCall,
  instructionTotal,
  categoryCounts,
  contentMethods,
  onNavigate,
}: CourseOverviewTabProps): React.ReactElement {
  const config = (detail.config || {}) as PlaybookConfig;
  const goals = config.goals || [];
  const audienceId = config.audience || '';
  const audienceOption = audienceId ? getAudienceOption(audienceId) : null;

  // Derive interaction pattern label from first subject's teaching profile
  const firstProfile = subjects.find(s => s.teachingProfile)?.teachingProfile;
  const profile = firstProfile ? getTeachingProfile(firstProfile) : null;
  const patternLabel = profile
    ? (INTERACTION_PATTERN_LABELS[profile.interactionPattern as InteractionPattern]?.label ?? profile.interactionPattern)
    : null;

  const totalTPs = subjects.reduce((sum, s) => sum + s.assertionCount, 0);
  const totalSources = (() => {
    const seen = new Set<string>();
    for (const s of subjects) for (const src of (s.sources ?? [])) seen.add(src.id);
    return seen.size || subjects.reduce((sum, s) => sum + s.sourceCount, 0);
  })();

  return (
    <>
      <CourseSetupTracker
        courseId={courseId}
        detail={detail}
        subjects={subjects}
        sessions={sessions}
        onSimCall={onSimCall}
      />

      <CourseSummaryCard
        interactionPattern={patternLabel}
        teachingMode={profile?.teachingMode ?? null}
        audienceLabel={audienceOption?.label ?? null}
        audienceAges={audienceOption?.ages ?? null}
        subjectCount={subjects.length}
        totalTPs={totalTPs}
        totalSources={totalSources}
        instructionTotal={instructionTotal}
        categoryCounts={categoryCounts}
        contentMethods={contentMethods}
        goals={goals.map(g => ({ type: g.type, name: g.name }))}
        personaName={persona?.name ?? null}
        personaArchetype={persona?.extendsAgent ? archetypeLabel(persona.extendsAgent) : null}
        sessionPlan={sessionPlan}
        publishedAt={(detail as any).publishedAt ?? null}
        version={String((detail as any).version ?? '1')}
        subjectNames={subjects.map(s => s.name)}
        onNavigate={onNavigate}
      />
    </>
  );
}
