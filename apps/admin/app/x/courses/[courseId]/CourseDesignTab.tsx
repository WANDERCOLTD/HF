'use client';

import { CourseDesignConsole } from './_components/CourseDesignConsole';
import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
import { BandingPicker } from '@/components/shared/BandingPicker';
import { CollapsibleCard } from '@/components/shared/CollapsibleCard';
import { FeltProgressSettings } from '@/components/course-design/FeltProgressSettings';
import { FirstSessionSettings } from '@/components/course-design/FirstSessionSettings';
import { TolerancesSettings } from '@/components/course-design/TolerancesSettings';
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
  // Session-flow state is owned end-to-end by `<CourseDesignConsole>` →
  // `<SessionFlowEditor>`, which fetches /api/courses/:id/session-flow on
  // mount and persists via PUT. No mirroring here — one canonical surface.
  const pbConfig = (playbookConfig || {}) as PlaybookConfig;

  return (
    <div className="hf-mt-lg">
      {/* COURSE AT A GLANCE was retired from the Design tab in #1266 cleanup.
          The same widget now lives at the top of the Content tab
          (`CourseIntelligenceTab.tsx`) where the data it summarises actually
          comes from. The Design tab focuses on the journey lenses below. */}

      {/* ── Course Design Console (#1263 / Slice 1 #1266) ──
          Replaces the Session Flow CollapsibleCard with a lens-shell that
          surfaces Intake / Onboarding / Stops / Offboarding / Welcome
          journey lenses, plus 6 Behaviour lenses (Slice 2 — soon) and a
          Preview lens (Slice 3 — soon). Reads + writes still go through
          SessionFlowEditor → GET/PUT /api/courses/:id/session-flow. */}
      <div className="hf-mb-lg">
        <CourseDesignConsole courseId={courseId} />
      </div>

      {/* ── Progress Signals controls (#784 S6 Section 1 — #779 + #780 namespaces;
          internally still the "Felt Progress" epic) ── */}
      <CollapsibleCard
        title="Progress Signals"
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

      {/* ── Tolerances (split from caller Tune, post-#849) ──
          Course-default Mastery Threshold + Retrieval Cadence Override +
          Memory Decay Scale. The per-learner Mastery Threshold override
          stays in PromptTunerSidebar on the caller page. */}
      <CollapsibleCard
        title="Tolerances"
        hint="Course-default mastery threshold, retrieval cadence, memory decay"
        className="hf-mb-lg"
      >
        <TolerancesSettings
          courseId={courseId}
          playbookId={courseId}
          playbookConfig={pbConfig}
        />
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
