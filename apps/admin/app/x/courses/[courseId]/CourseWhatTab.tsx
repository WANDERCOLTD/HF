'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import {
  BookMarked, FileText, Plus, Pencil,
  AlertTriangle, ChevronRight, Upload, Target, ListOrdered,
} from 'lucide-react';
import { TeachMethodStats } from '@/components/shared/TeachMethodStats';
import { TrustBadge } from '@/app/x/content-sources/_components/shared/badges';
import type { GoalTemplate, PlaybookConfig } from '@/lib/types/json-fields';

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

type MethodBreakdown = { teachMethod: string; count: number; reviewed: number };

type SessionPlanInfo = {
  estimatedSessions: number;
  totalDurationMins: number;
  generatedAt?: string | null;
} | null;

export type CourseWhatTabProps = {
  courseId: string;
  detail: {
    id: string;
    name: string;
    config?: Record<string, unknown> | null;
    domain: { id: string; name: string; slug: string };
  };
  subjects: SubjectSummary[];
  contentMethods: MethodBreakdown[];
  contentTotal: number;
  isOperator: boolean;
  sessionPlan: SessionPlanInfo;
  onContentRefresh?: (methods: MethodBreakdown[], total: number) => void;
  onDetailUpdate?: (updater: (prev: any) => any) => void;
};

// ── Goal type labels (shared with /x/goals page) ───────

const GOAL_TYPE_CONFIG: Record<string, { label: string; color: string }> = {
  LEARN: { label: 'Learn', color: 'var(--accent-primary)' },
  ACHIEVE: { label: 'Achieve', color: 'var(--status-warning-text)' },
  CHANGE: { label: 'Change', color: 'var(--badge-purple-text)' },
  CONNECT: { label: 'Connect', color: 'var(--badge-pink-text)' },
  SUPPORT: { label: 'Support', color: 'var(--status-success-text)' },
  CREATE: { label: 'Create', color: 'var(--badge-cyan-text)' },
};

// ── Section Header ─────────────────────────────────────

function SectionHeader({ title, icon: Icon }: { title: string; icon: React.ComponentType<{ size?: number; className?: string }> }) {
  return (
    <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md hf-section-divider">
      <Icon size={18} className="hf-text-muted" />
      <h2 className="hf-section-title hf-mb-0">{title}</h2>
    </div>
  );
}

// ── Main Component ─────────────────────────────────────

export function CourseWhatTab({
  courseId,
  detail,
  subjects,
  contentMethods,
  contentTotal,
  isOperator,
  sessionPlan,
  onContentRefresh,
  onDetailUpdate,
}: CourseWhatTabProps) {
  const config = (detail.config || {}) as PlaybookConfig;
  const goals = config.goals || [];

  // ── Backfill state ────────────────────────────────────
  const [backfilling, setBackfilling] = useState(false);

  // ── Inline edit states ────────────────────────────────
  const [saving, setSaving] = useState(false);

  // ── Config save helper ────────────────────────────────
  const saveConfig = useCallback(async (patch: Record<string, unknown>) => {
    setSaving(true);
    try {
      const res = await fetch(`/api/playbooks/${detail.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: patch }),
      });
      const data = await res.json();
      if (data.ok && onDetailUpdate) {
        onDetailUpdate((prev: any) => prev ? {
          ...prev,
          config: { ...(prev.config || {}), ...patch },
        } : prev);
      }
      return data.ok;
    } finally {
      setSaving(false);
    }
  }, [detail.id, onDetailUpdate]);

  return (
    <>
      {/* ── Goals ─────────────────────────────────────── */}
      <SectionHeader title="Goals" icon={Target} />
      <div className="hf-card-compact hf-mb-lg">
        {goals.length === 0 ? (
          <div className="hf-text-sm hf-text-muted">
            No goals configured. Set goals in the Course Setup wizard to track learner progress.
          </div>
        ) : (
          <div className="hf-flex hf-flex-col hf-gap-sm">
            {goals.map((g, i) => {
              const typeConfig = GOAL_TYPE_CONFIG[g.type] || { label: g.type, color: 'var(--text-muted)' };
              return (
                <div key={i} className="hf-flex hf-gap-sm hf-items-start cov-goal-row">
                  <span
                    className="hf-badge hf-badge-sm"
                    style={{ color: typeConfig.color, borderColor: typeConfig.color }}
                  >
                    {typeConfig.label}
                  </span>
                  <div className="hf-flex-1">
                    <div className="hf-text-sm">{g.name}</div>
                    {g.description && (
                      <div className="hf-text-xs hf-text-muted">{g.description}</div>
                    )}
                  </div>
                  {g.isAssessmentTarget && (
                    <span className="hf-badge hf-badge-sm hf-badge-warning" title={`Assessment target — ${Math.round((g.assessmentConfig?.threshold || 0.8) * 100)}% threshold`}>
                      Assessment
                    </span>
                  )}
                  {g.isDefault && (
                    <span className="hf-badge hf-badge-sm hf-badge-muted">Default</span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── What You're Teaching ──────────────────────── */}
      <div className="hf-flex hf-flex-between hf-items-center hf-mb-md hf-section-divider">
        <div className="hf-flex hf-gap-sm hf-items-center">
          <BookMarked size={18} className="hf-text-muted" />
          <h2 className="hf-section-title hf-mb-0">What You&apos;re Teaching</h2>
        </div>
        {isOperator && subjects.length > 0 && (
          <Link
            href={`/x/courses/new?domainId=${detail.domain.id}`}
            className="hf-btn-sm hf-btn-secondary"
          >
            <Plus size={13} />
            Add Subject
          </Link>
        )}
      </div>

      {subjects.length === 0 ? (
        <div className="hf-empty-compact hf-mb-lg">
          <BookMarked size={36} className="hf-text-tertiary hf-mb-sm" />
          <div className="hf-heading-sm hf-text-secondary hf-mb-sm">No subjects yet</div>
          <p className="hf-text-xs hf-text-muted hf-mb-md">Subjects are created when you upload content or use the Course Setup wizard.</p>
          {isOperator && (
            <Link href={`/x/courses/new?domainId=${detail.domain.id}`} className="hf-btn hf-btn-primary">
              <Plus size={14} />
              Set Up Course
            </Link>
          )}
        </div>
      ) : (
        <div className="hf-card-grid-md hf-mb-lg">
          {subjects.map((sub) => (
            <div key={sub.id} className="hf-card-compact">
              <Link
                href={`/x/courses/${courseId}/subjects/${sub.id}`}
                className="hf-card-link-inner"
              >
                <div className="hf-flex hf-gap-sm hf-items-center hf-mb-sm">
                  <BookMarked size={16} className="hf-text-accent hf-flex-shrink-0" />
                  <h3 className="hf-heading-sm hf-mb-0 hf-flex-1">{sub.name}</h3>
                  <TrustBadge level={sub.defaultTrustLevel} />
                </div>
                {sub.description && (
                  <p className="hf-text-xs hf-text-muted hf-mb-sm hf-line-clamp-2">{sub.description}</p>
                )}
                <div className="hf-flex hf-gap-md hf-text-xs hf-text-muted">
                  {sub.sourceCount === 0 ? (
                    <span className="hf-text-warning hf-flex hf-items-center hf-gap-xs">
                      <AlertTriangle size={12} />No content yet
                    </span>
                  ) : (
                    <span><FileText size={12} className="hf-icon-inline" />{sub.sourceCount} sources</span>
                  )}
                  <span>{sub.assertionCount} teaching points</span>
                  {sub.curriculumCount > 0 && <span>{sub.curriculumCount} curricula</span>}
                </div>
              </Link>
              {isOperator && sub.sourceCount === 0 && (
                <Link
                  href={`/x/courses/${courseId}/subjects/${sub.id}`}
                  className="hf-btn-sm hf-btn-primary hf-mt-sm"
                >
                  <Upload size={13} />
                  Upload Content
                </Link>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Teaching Methods ──────────────────────────── */}
      {contentMethods.length > 0 && (
        <div className="hf-mb-lg">
          <div className="hf-flex hf-items-center hf-gap-sm hf-mb-sm">
            <div className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">
              Teaching Methods
            </div>
            {isOperator && contentMethods.some((m) => m.teachMethod === 'unassigned') && (
              <button
                className="hf-btn hf-btn-xs hf-btn-outline"
                disabled={backfilling}
                onClick={async () => {
                  setBackfilling(true);
                  try {
                    const res = await fetch(`/api/courses/${courseId}/backfill-teach-methods`, { method: 'POST' });
                    const data = await res.json();
                    if (data.ok && data.updated > 0 && onContentRefresh) {
                      const bd = await fetch(`/api/courses/${courseId}/content-breakdown?bySubject=true`).then(r => r.json());
                      if (bd.ok) {
                        onContentRefresh(bd.methods || [], bd.total || 0);
                      }
                    }
                  } catch { /* ignore */ }
                  setBackfilling(false);
                }}
              >
                {backfilling ? 'Assigning\u2026' : `Assign ${contentMethods.find((m) => m.teachMethod === 'unassigned')?.count ?? 0} unassigned`}
              </button>
            )}
          </div>
          <TeachMethodStats methods={contentMethods} total={contentTotal} />
        </div>
      )}

      {/* ── Session Plan Summary ──────────────────────── */}
      {sessionPlan && sessionPlan.estimatedSessions > 0 && (
        <>
          <SectionHeader title="Session Plan" icon={ListOrdered} />
          <div className="hf-card-compact hf-mb-lg">
            <div className="hf-flex hf-gap-lg">
              <div>
                <div className="hf-text-lg hf-text-bold">{sessionPlan.estimatedSessions}</div>
                <div className="hf-text-xs hf-text-muted">Sessions</div>
              </div>
              {sessionPlan.totalDurationMins > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {sessionPlan.totalDurationMins >= 60
                      ? `${Math.round(sessionPlan.totalDurationMins / 60 * 10) / 10}h`
                      : `${sessionPlan.totalDurationMins}m`
                    }
                  </div>
                  <div className="hf-text-xs hf-text-muted">Total Duration</div>
                </div>
              )}
              {sessionPlan.totalDurationMins > 0 && sessionPlan.estimatedSessions > 0 && (
                <div>
                  <div className="hf-text-lg hf-text-bold">
                    {Math.round(sessionPlan.totalDurationMins / sessionPlan.estimatedSessions)}m
                  </div>
                  <div className="hf-text-xs hf-text-muted">Avg per Session</div>
                </div>
              )}
            </div>
            {sessionPlan.generatedAt && (
              <div className="hf-text-xs hf-text-placeholder hf-mt-sm">
                Generated {new Date(sessionPlan.generatedAt).toLocaleDateString()}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
