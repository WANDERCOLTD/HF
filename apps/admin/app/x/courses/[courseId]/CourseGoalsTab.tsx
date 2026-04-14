'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { Target, Users } from 'lucide-react';
import { CallerPill } from '@/src/components/shared/EntityPill';
import { GOAL_TYPE_CONFIG } from '@/lib/goals/goal-constants';

// ── Types ──────────────────────────────────────────────

/** One entry from playbook.config.goals[] — the course template. */
type TemplateGoal = {
  type: string;
  name: string;
  description?: string | null;
  isAssessmentTarget?: boolean;
  priority?: number;
};

/** A per-caller Goal row (for the student rollup section). */
type StudentGoal = {
  id: string;
  type: string;
  name: string;
  status: string;
  progress: number;
  caller: { id: string; name: string };
};

export type CourseGoalsTabProps = {
  courseId: string;
  /** The playbook's config JSON — read from detail.config on the parent page. */
  playbookConfig?: Record<string, unknown> | null;
};

// ── Main Component ─────────────────────────────────────

export function CourseGoalsTab({ courseId, playbookConfig }: CourseGoalsTabProps): React.ReactElement {
  // Course template goals come from playbook.config.goals — the course-level
  // intent set by the educator via the wizard. These are NOT per-caller rows.
  const templateGoals: TemplateGoal[] = useMemo(() => {
    const raw = (playbookConfig?.goals as TemplateGoal[] | undefined) || [];
    return Array.isArray(raw) ? raw : [];
  }, [playbookConfig]);

  // Student rollup — how enrolled learners are tracking against the template.
  // Fetched lazily so the primary "course goals" view renders instantly.
  const [studentGoals, setStudentGoals] = useState<StudentGoal[]>([]);
  const [studentLoading, setStudentLoading] = useState(true);

  useEffect(() => {
    setStudentLoading(true);
    fetch(`/api/goals?playbookId=${courseId}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && Array.isArray(data.goals)) setStudentGoals(data.goals);
      })
      .catch(() => {
        // Non-fatal — the primary view still renders from template goals.
      })
      .finally(() => setStudentLoading(false));
  }, [courseId]);

  // Aggregate enrolled callers for the "Students tracking these goals" section.
  const studentRollup = useMemo(() => {
    const byCaller = new Map<string, { caller: StudentGoal['caller']; count: number; avgProgress: number }>();
    for (const g of studentGoals) {
      const existing = byCaller.get(g.caller.id);
      if (existing) {
        existing.count += 1;
        existing.avgProgress = (existing.avgProgress * (existing.count - 1) + g.progress) / existing.count;
      } else {
        byCaller.set(g.caller.id, { caller: g.caller, count: 1, avgProgress: g.progress });
      }
    }
    return [...byCaller.values()].sort((a, b) => a.caller.name.localeCompare(b.caller.name));
  }, [studentGoals]);

  // ── Empty: no template goals ──────────────────────────

  if (templateGoals.length === 0) {
    return (
      <div className="hf-empty-state hf-mt-lg">
        <div className="hf-empty-state-icon"><Target size={48} /></div>
        <div className="hf-empty-state-title">No course goals yet</div>
        <div className="hf-empty-state-desc">
          Course goals come from the learning outcomes you set during course creation.
          Open the course wizard and add learning outcomes to populate this view.
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────

  return (
    <div className="hf-mt-md">
      {/* Primary view: course-level goals (the template) */}
      <div className="hf-section-header">
        <h3 className="hf-section-title">
          <Target size={18} className="hf-text-muted" />
          Course Goals
        </h3>
        <div className="hf-section-desc">
          The learning outcomes every enrolled student is working towards. Defined during course creation.
        </div>
      </div>

      <div className="hf-flex-col hf-gap-sm hf-mb-lg">
        {templateGoals.map((g, i) => {
          const typeConfig = GOAL_TYPE_CONFIG[g.type] || {
            label: g.type,
            icon: '\u{1F3AF}',
            color: 'var(--text-muted)',
            glow: 'var(--text-muted)',
          };
          return (
            <div key={`${g.name}-${i}`} className="hf-card hf-card-compact">
              <div className="hf-flex hf-items-start hf-gap-sm">
                <div
                  className="hf-icon-box"
                  style={{
                    background: `color-mix(in srgb, ${typeConfig.color} 12%, transparent)`,
                    color: typeConfig.color,
                  }}
                >
                  <span style={{ fontSize: 20 }}>{typeConfig.icon}</span>
                </div>
                <div className="hf-flex-1 hf-min-w-0">
                  <div className="hf-flex hf-items-center hf-gap-xs hf-mb-2xs">
                    <span
                      className="hf-chip hf-chip-xs"
                      style={{
                        background: `color-mix(in srgb, ${typeConfig.color} 10%, transparent)`,
                        color: typeConfig.color,
                      }}
                    >
                      {typeConfig.label}
                    </span>
                    {g.isAssessmentTarget && (
                      <span className="hf-chip hf-chip-xs hf-chip-warning">
                        Assessment target
                      </span>
                    )}
                  </div>
                  <div className="hf-text-sm hf-text-primary hf-text-bold">{g.name}</div>
                  {g.description && (
                    <div className="hf-text-xs hf-text-muted hf-mt-2xs">{g.description}</div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Secondary: which students are tracking these goals */}
      <div className="hf-section-header">
        <h3 className="hf-section-title">
          <Users size={18} className="hf-text-muted" />
          Enrolled Students
        </h3>
        <div className="hf-section-desc">
          {studentLoading
            ? 'Loading student progress…'
            : studentRollup.length === 0
              ? 'No students are currently tracking these goals. Enrol a caller to start.'
              : `${studentRollup.length} student${studentRollup.length !== 1 ? 's' : ''} working on ${templateGoals.length} course goal${templateGoals.length !== 1 ? 's' : ''}.`}
        </div>
      </div>

      {!studentLoading && studentRollup.length > 0 && (
        <div className="hf-flex-col hf-gap-xs">
          {studentRollup.map(({ caller, count, avgProgress }) => (
            <Link
              key={caller.id}
              href={`/x/callers/${caller.id}?tab=learning`}
              className="hf-list-row hf-list-row-clickable"
            >
              <CallerPill label={caller.name} size="compact" />
              <div className="hf-flex-1 hf-text-xs hf-text-muted">
                {count} goal{count !== 1 ? 's' : ''} instantiated
              </div>
              <div className="hf-text-xs hf-text-muted hf-text-right hf-flex-shrink-0">
                {Math.round(avgProgress * 100)}% avg progress
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
