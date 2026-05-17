'use client';

/**
 * CourseSetupTracker — numbered pipeline showing course setup progress.
 *
 * Three phases:
 *   Foundation (sequential): ①②③ — Course Created → Content → Teaching Points
 *   Configure  (parallel):   ④⑤  — Lesson Plan + Tutor (independent, any order)
 *   Launch     (gates both): ⑥   — Ready to Teach (needs 4+5)
 *
 * Always visible above tabs. Collapsed to a single bar when all complete.
 * Expandable to show per-stage detail + source-level sub-progress.
 */

import { useState, useEffect, useCallback } from 'react';
import { Check, ChevronDown, PlayCircle, AlertCircle } from 'lucide-react';
import { useCourseSetupStatus, type SetupStatusInput, type StageStatus } from '@/hooks/useCourseSetupStatus';
import { useSourceStatus } from '@/hooks/useSourceStatus';
import { SourceStatusDots } from '@/components/shared/SourceStatusDots';
import './course-setup-tracker.css';

// ── Types ──────────────────────────────────────────────

interface CourseSetupTrackerProps {
  courseId: string;
  /** Playbook detail — already loaded by parent */
  detail: SetupStatusInput['detail'];
  /** Subjects summary — already loaded by parent */
  subjects: SetupStatusInput['subjects'];
  /** Sessions/lesson plan — may be null if not yet loaded */
  sessions: SetupStatusInput['sessions'];
  /** Callback when "Try a Practice Call" is clicked */
  onSimCall?: () => void;
  /** Reports readiness changes to parent (e.g. for hero badge) */
  onReadinessChange?: (completedCount: number, allComplete: boolean) => void;
}

// ── Component ─────────────────────────────────────────

export function CourseSetupTracker({
  courseId,
  detail,
  subjects,
  sessions,
  onSimCall,
  onReadinessChange,
}: CourseSetupTrackerProps) {
  const [expanded, setExpanded] = useState(false);
  const [readiness, setReadiness] = useState<SetupStatusInput['readiness']>(null);

  // Collect all source IDs for batch status polling
  const allSourceIds = subjects.flatMap(
    (s) => s.sources?.map((src) => src.id) ?? []
  );
  const sourceStatusMap = useSourceStatus(allSourceIds, {
    pollInterval: 5_000,
    enabled: allSourceIds.length > 0,
  });

  // Fetch stages 4-6 readiness from the aggregated endpoint
  const fetchReadiness = useCallback(async () => {
    try {
      const res = await fetch(`/api/courses/${courseId}/setup-status`);
      const data = await res.json();
      if (data.ok) {
        setReadiness({
          lessonPlanBuilt: data.lessonPlanBuilt,
          onboardingConfigured: data.onboardingConfigured,
          promptComposable: data.promptComposable,
          allCriticalPass: data.allCriticalPass,
          activeCurriculumMode: data.activeCurriculumMode,
        });
      }
    } catch (err) {
      console.error("[CourseSetupTracker] Readiness check failed:", err);
    }
  }, [courseId]);

  // Poll readiness every 10s while stages 4-6 aren't all complete, then stop
  useEffect(() => {
    fetchReadiness();
    const id = setInterval(() => {
      if (readiness?.allCriticalPass) return;
      fetchReadiness();
    }, 10_000);
    return () => clearInterval(id);
  }, [fetchReadiness, readiness?.allCriticalPass]);

  // Derive the 6 stages
  const setupStatus = useCourseSetupStatus({
    detail,
    subjects,
    sourceStatusMap,
    sessions,
    readiness,
  });

  const { stages, completedCount, allComplete, nextHint } = setupStatus;

  // Report readiness to parent (hero badge)
  useEffect(() => {
    onReadinessChange?.(completedCount, allComplete);
  }, [completedCount, allComplete, onReadinessChange]);

  // Auto-expand when something is in progress, collapse when all done
  useEffect(() => {
    const hasActive = stages.some((s) => s.status === 'active');
    if (hasActive && !expanded) setExpanded(true);
  }, [stages.map((s) => s.status).join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!detail) return null;

  return (
    <div className="cst-tracker">
      {/* ── Header bar (always visible) ──────────── */}
      <div
        className="cst-header"
        onClick={() => setExpanded(!expanded)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && setExpanded(!expanded)}
      >
        <div className="cst-header-left">
          <span className="cst-title">Course Setup</span>
          <StepDots stages={stages} />
          <span className="cst-count">{completedCount} of 6</span>
        </div>
        <div className="cst-header-right">
          {allComplete && (
            <span className="cst-ready-badge">
              <Check size={13} /> Ready to Teach
            </span>
          )}
          {allComplete && onSimCall && (
            <button
              className="hf-btn hf-btn-sm hf-btn-primary"
              onClick={(e) => { e.stopPropagation(); onSimCall(); }}
              type="button"
            >
              <PlayCircle size={14} />
              Practice Call
            </button>
          )}
          <ChevronDown
            size={16}
            className={`cst-chevron${expanded ? ' cst-chevron--open' : ''}`}
          />
        </div>
      </div>

      {/* ── Expanded detail (grouped by phase) ──── */}
      {expanded && (
        <div className="cst-detail">
          {[
            { label: 'Foundation', stageNums: [1, 2, 3] },
            { label: 'Configure', stageNums: [4, 5] },
            { label: 'Launch', stageNums: [6] },
          ].map((phase) => (
            <div key={phase.label} className="cst-phase-section">
              <div className="cst-phase-label">{phase.label}</div>
              <ul className="cst-stage-list">
                {stages
                  .filter((s) => phase.stageNums.includes(s.number))
                  .map((stage) => (
                    <li key={stage.number} className="cst-stage-item">
                      <span className={`cst-stage-num cst-stage-num--${stage.status}`}>
                        {stage.status === 'done' ? (
                          <Check size={12} />
                        ) : stage.status === 'error' ? (
                          <AlertCircle size={12} />
                        ) : (
                          stage.number
                        )}
                      </span>
                      <div className="cst-stage-info">
                        <div className={`cst-stage-label${stage.status === 'pending' ? ' cst-stage-label--pending' : ''}`}>
                          {stage.label}
                        </div>
                        <div className="cst-stage-detail">{stage.detail}</div>
                        {stage.number === 3 && allSourceIds.length > 0 && stage.status !== 'pending' && (
                          <SourceSubProgress subjects={subjects} sourceStatusMap={sourceStatusMap} />
                        )}
                      </div>
                      <StageStatusLabel status={stage.status} />
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {/* ── Next hint bar (only when not all complete) ── */}
      {!allComplete && (
        <div className="cst-hint">
          Next: {nextHint}
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────

/** Phase-aware horizontal dot bar: Foundation ①②③ · Configure ④ ⑤ · Launch ⑥ */
function StepDots({ stages }: { stages: { number: number; status: StageStatus; label: string }[] }) {
  const foundation = stages.filter((s) => s.number <= 3);
  const configure = stages.filter((s) => s.number === 4 || s.number === 5);
  const launch = stages.filter((s) => s.number === 6);

  const statusLabel = (s: StageStatus): string =>
    s === 'done' ? '✓' : s === 'active' ? 'in progress' : s === 'error' ? 'error' : 'pending';

  const renderDot = (stage: { number: number; status: StageStatus; label: string }) => (
    <span
      key={stage.number}
      className={`cst-dot cst-dot--${stage.status}`}
      title={`${stage.label}: ${statusLabel(stage.status)}`}
    >
      {stage.status === 'done' ? <Check size={11} /> : stage.number}
    </span>
  );

  const renderConnector = (status: StageStatus) => (
    <span className={`cst-connector cst-connector--${status === 'done' ? 'done' : 'pending'}`} />
  );

  return (
    <div className="cst-dots">
      {/* Foundation: ①─②─③ (sequential connectors) */}
      <span className="cst-phase-group">
        {foundation.map((stage, i) => (
          <span key={stage.number}>
            {renderDot(stage)}
            {i < foundation.length - 1 && renderConnector(stage.status)}
          </span>
        ))}
      </span>

      <span className="cst-phase-sep" />

      {/* Configure: ④ ⑤ (parallel — no connector between them) */}
      <span className="cst-phase-group cst-phase-group--parallel">
        {configure.map((stage) => (
          <span key={stage.number}>{renderDot(stage)}</span>
        ))}
      </span>

      <span className="cst-phase-sep" />

      {/* Launch: ⑥ */}
      <span className="cst-phase-group">
        {launch.map((stage) => (
          <span key={stage.number}>{renderDot(stage)}</span>
        ))}
      </span>
    </div>
  );
}

/** Per-source extraction sub-progress for stage 3 */
function SourceSubProgress({
  subjects,
  sourceStatusMap,
}: {
  subjects: SetupStatusInput['subjects'];
  sourceStatusMap: Record<string, import('@/components/shared/SourceStatusDots').SourceStatusData>;
}) {
  const sources = Array.from(
    new Map(
      subjects.flatMap(
        (s) => s.sources?.map((src) => ({ ...src, subjectName: s.name })) ?? []
      ).map((src) => [src.id, src])
    ).values()
  );

  if (sources.length === 0) return null;

  return (
    <ul className="cst-source-list">
      {sources.map((src) => (
        <li key={src.id} className="cst-source-item">
          <SourceStatusDots status={sourceStatusMap[src.id] ?? null} compact />
          <span className="cst-source-name" title={src.name || src.id}>
            {src.name || src.id.slice(0, 12)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Status label on the right of each stage row */
function StageStatusLabel({ status }: { status: StageStatus }) {
  if (status === 'done') return <span className="cst-stage-status cst-stage-status--done">Done</span>;
  if (status === 'active') return <span className="cst-stage-status cst-stage-status--active">In progress</span>;
  if (status === 'error') return <span className="cst-stage-status cst-stage-status--error">Error</span>;
  return null; // pending shows nothing
}
