'use client';

import { CourseDesignConsole } from './_components/CourseDesignConsole';
import { CourseSetupTracker } from '@/components/shared/CourseSetupTracker';
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

export type CourseDesignTabProps = {
  courseId: string;
  playbookConfig?: Record<string, unknown> | null;
  detail?: { id: string; name: string; status: string; config?: Record<string, unknown> | null; domain: { id: string; name: string; slug: string }; publishedAt?: string | null; version?: number } | null;
  subjects?: SubjectSummary[];
  sessions?: SetupStatusInput['sessions'] | null;
  onSimCall?: () => void;
  /** Reports setup readiness (completedCount, allComplete) to parent for hero badge */
  onReadinessChange?: (completedCount: number, allComplete: boolean) => void;
};

// ── Main Component ─────────────────────────────────────

/**
 * Course Design tab — now just hosts the `<CourseDesignConsole>` lens shell
 * and the `<CourseSetupTracker>` at the bottom. The four legacy
 * CollapsibleCards (Progress Signals, Call 1 / First Session, Tolerances,
 * Skill Banding) were absorbed as Behaviour lenses inside the Console in
 * Slice 2 of epic #1263 — see `_components/CourseDesignConsole.tsx`.
 *
 * All other per-course context (subjects, persona, sessions, content
 * methods, goals) lives on the Content tab now (#1266 cleanup) — the
 * Design tab is purely the Journey + Behaviour + Preview console.
 */
export function CourseDesignTab({
  courseId, playbookConfig,
  detail, subjects, sessions,
  onSimCall, onReadinessChange,
}: CourseDesignTabProps): React.ReactElement {
  const pbConfig = (playbookConfig || {}) as PlaybookConfig;

  return (
    <div className="hf-mt-lg">
      <div className="hf-mb-lg">
        <CourseDesignConsole courseId={courseId} playbookConfig={pbConfig} />
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
