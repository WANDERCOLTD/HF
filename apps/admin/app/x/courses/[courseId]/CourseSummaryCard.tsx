'use client';

import {
  Users2, Target, Sparkles, PlayCircle, BookMarked,
  ChevronRight, FileText,
} from 'lucide-react';
import { GOAL_TYPE_CONFIG } from '@/lib/goals/goal-constants';
import { CONTENT_CATEGORIES, CATEGORY_ORDER } from '@/lib/content-categories';
import { TEACH_METHOD_CONFIG } from '@/lib/content-trust/resolve-config';

// ── Types ──────────────────────────────────────────

export type MethodBreakdown = { teachMethod: string; count: number };

export type CourseSummaryCardProps = {
  // Identity row
  interactionPattern: string | null;
  teachingMode: string | null;
  audienceLabel: string | null;
  audienceAges: string | null;
  // Stats
  subjectCount: number;
  totalTPs: number;
  totalSources: number;
  instructionTotal: number;
  // Content breakdown (optional — enhances content + sessions rows)
  categoryCounts?: Record<string, number>;
  contentMethods?: MethodBreakdown[];
  // Goals
  goals: Array<{ type: string; name: string }>;
  // Teaching
  personaName: string | null;
  personaArchetype: string | null;
  // Sessions
  sessionPlan: { estimatedSessions: number; totalDurationMins: number } | null;
  // Footer
  publishedAt: string | null;
  version: string;
  // Subjects (for content row)
  subjectNames: string[];
  // Navigation
  onNavigate: (tab: string) => void;
};

// ── Helpers ────────────────────────────────────────

function SummaryRow({ icon: Icon, children, onClick }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button type="button" className="csc-row" onClick={onClick}>
      <div className="csc-row-left">
        <Icon size={15} className="hf-text-muted csc-row-icon" />
        {children}
      </div>
      <ChevronRight size={14} className="csc-chevron" />
    </button>
  );
}

function StatChip({ value, label }: { value: number; label: string }) {
  return (
    <span className="csc-stat-chip">
      <span className="csc-stat-value">{value}</span>{' '}{label}
    </span>
  );
}

// ── Component ──────────────────────────────────────

export function CourseSummaryCard({
  interactionPattern,
  teachingMode,
  audienceLabel,
  audienceAges,
  subjectCount,
  totalTPs,
  totalSources,
  instructionTotal,
  categoryCounts,
  contentMethods,
  goals,
  personaName,
  personaArchetype,
  sessionPlan,
  publishedAt,
  version,
  subjectNames,
  onNavigate,
}: CourseSummaryCardProps): React.ReactElement {
  const hasIdentity = interactionPattern || audienceLabel || teachingMode;
  const hasContent = subjectCount > 0 || totalTPs > 0 || totalSources > 0;
  const hasSessions = sessionPlan && sessionPlan.estimatedSessions > 0;
  const hasAnyRow = hasIdentity || goals.length > 0 || hasContent || personaName || hasSessions;

  // Unique goal types for badge pills
  const goalTypes = [...new Set(goals.map(g => g.type))];

  return (
    <div className="hf-card-compact csc-card">
      <div className="csc-header">
        <span className="hf-text-xs hf-text-bold hf-text-muted hf-uppercase">Course at a Glance</span>
      </div>

      <div className="csc-body">
        {!hasAnyRow && (
          <div className="hf-text-sm hf-text-muted csc-empty">
            Complete the setup steps above to see your course summary here.
          </div>
        )}

        {/* ── Identity row ──────────────────────────── */}
        {hasIdentity && (
          <SummaryRow icon={Users2} onClick={() => onNavigate('design')}>
            <div className="csc-row-content">
              <div className="csc-identity-labels">
                {[interactionPattern, audienceLabel && (audienceAges ? `${audienceLabel} (${audienceAges})` : audienceLabel), teachingMode]
                  .filter(Boolean)
                  .map((label, i) => (
                    <span key={i} className="hf-insight-badge">{label}</span>
                  ))}
              </div>
            </div>
          </SummaryRow>
        )}

        {/* ── Goals row (configured templates, not live instances) */}
        {goals.length > 0 && (
          <SummaryRow icon={Target} onClick={() => onNavigate('goals')}>
            <div className="csc-row-content">
              <span className="hf-text-sm">{goals.length} {goals.length === 1 ? 'goal' : 'goals'} configured</span>
              {goalTypes.length > 0 && (
                <div className="csc-goal-types">
                  {goalTypes.map(type => {
                    const cfg = GOAL_TYPE_CONFIG[type];
                    return (
                      <span
                        key={type}
                        className="hf-badge hf-badge-sm"
                        style={{ color: cfg?.color, borderColor: cfg?.color }}
                      >
                        {cfg?.label || type}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          </SummaryRow>
        )}

        {/* ── Content row ──────────────────────────── */}
        {hasContent && (
          <SummaryRow icon={BookMarked} onClick={() => onNavigate('content')}>
            <div className="csc-row-content">
              <div className="csc-stat-row">
                {subjectCount > 0 && <StatChip value={subjectCount} label={subjectCount === 1 ? 'subject' : 'subjects'} />}
                {totalTPs > 0 && <StatChip value={totalTPs} label="teaching points" />}
                {totalSources > 0 && <StatChip value={totalSources} label={totalSources === 1 ? 'source' : 'sources'} />}
              </div>
              {subjectNames.length > 0 && (
                <div className="csc-subject-names">
                  {subjectNames.slice(0, 3).map((name, i) => (
                    <span key={i} className="hf-insight-badge">{name}</span>
                  ))}
                  {subjectNames.length > 3 && (
                    <span className="hf-text-xs hf-text-muted">+{subjectNames.length - 3} more</span>
                  )}
                </div>
              )}
              {categoryCounts && totalTPs > 0 && (
                <div className="hf-flex hf-gap-xs hf-flex-wrap" style={{ marginTop: 4 }}>
                  {CATEGORY_ORDER
                    .filter(cat => (categoryCounts[cat] ?? 0) > 0)
                    .map(cat => {
                      const meta = CONTENT_CATEGORIES[cat];
                      return (
                        <span
                          key={cat}
                          className="hf-badge hf-badge-sm"
                          title={meta.label}
                          style={{ color: meta.color, borderColor: meta.color }}
                        >
                          {meta.icon && `${meta.icon} `}{categoryCounts[cat]} {meta.label}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          </SummaryRow>
        )}

        {/* ── Teaching / persona row ───────────────── */}
        {personaName && (
          <SummaryRow icon={Sparkles} onClick={() => onNavigate('design')}>
            <div className="csc-row-content">
              <span className="hf-text-sm">
                {personaName}
                {personaArchetype && (
                  <span className="hf-text-xs hf-text-muted"> ({personaArchetype})</span>
                )}
              </span>
              {instructionTotal > 0 && (
                <span className="csc-stat-chip">
                  <FileText size={11} className="hf-icon-inline" /> {instructionTotal} rules
                </span>
              )}
            </div>
          </SummaryRow>
        )}

        {/* ── Sessions row ─────────────────────────── */}
        {hasSessions && (
          <SummaryRow icon={PlayCircle} onClick={() => onNavigate('design')}>
            <div className="csc-row-content">
              <span className="hf-text-sm">
                {sessionPlan.estimatedSessions} {sessionPlan.estimatedSessions === 1 ? 'session' : 'sessions'}
                {sessionPlan.totalDurationMins > 0 && (
                  <>
                    {' '}&middot;{' '}
                    {Math.round(sessionPlan.totalDurationMins / sessionPlan.estimatedSessions)}m avg
                    {' '}&middot;{' '}
                    {sessionPlan.totalDurationMins >= 60
                      ? `${Math.round(sessionPlan.totalDurationMins / 60 * 10) / 10}h total`
                      : `${sessionPlan.totalDurationMins}m total`
                    }
                  </>
                )}
              </span>
              {contentMethods && contentMethods.length > 0 && (
                <div className="hf-flex hf-gap-xs hf-flex-wrap" style={{ marginTop: 4 }}>
                  {contentMethods
                    .filter(m => m.count > 0)
                    .slice(0, 5)
                    .map(m => {
                      const cfg = TEACH_METHOD_CONFIG[m.teachMethod as keyof typeof TEACH_METHOD_CONFIG];
                      return (
                        <span key={m.teachMethod} className="csc-stat-chip">
                          {cfg?.icon || '?'} <span className="csc-stat-value">{m.count}</span> {cfg?.label || m.teachMethod}
                        </span>
                      );
                    })}
                </div>
              )}
            </div>
          </SummaryRow>
        )}
      </div>

      {/* ── Footer ─────────────────────────────────── */}
      <div className="csc-footer">
        <span className="hf-text-xs hf-text-muted">
          {publishedAt
            ? `Published ${new Date(publishedAt).toLocaleDateString()}`
            : 'Draft'
          }
          {' '}&middot; v{version}
        </span>
      </div>
    </div>
  );
}
