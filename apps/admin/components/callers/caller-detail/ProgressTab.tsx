"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { BookOpen, CheckSquare, Layers, Target, Check, X } from "lucide-react";
import { VerticalSlider, SliderGroup } from "@/components/shared/VerticalSlider";
import { GoalPill, PlaybookPill, StatusBadge } from "@/src/components/shared/EntityPill";
import { EXAM_LEVEL_CONFIG } from "@/lib/curriculum/constants";
import { useViewMode } from "@/contexts/ViewModeContext";
import { TwoColumnTargetsDisplay } from "./CallsTab";
import { ModuleDetailPanel } from "./cards/ModuleDetailPanel";
import type { CallScore, CurriculumProgress, LearnerProfile, Goal, Call, MemorySummary } from "./types";
import { CATEGORY_COLORS } from "./constants";
import { GOAL_TYPE_CONFIG } from "@/lib/goals/goal-constants";
import { getSessionTypeLabel, getSessionTypeColor } from "@/lib/lesson-plan/session-ui";
import { BandChip } from "@/components/shared/BandChip";
import { Acronym } from "@/components/shared/Acronym";

// =====================================================
// ScoresSection
// =====================================================

export function ScoresSection({ scores }: { scores: CallScore[] }) {
  const { isAdvanced } = useViewMode();
  const [expandedParam, setExpandedParam] = useState<string | null>(null);
  const [expandedScore, setExpandedScore] = useState<string | null>(null);

  if (!scores || scores.length === 0) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">📈</div>
        <div className="hf-empty-state-title">No scores yet</div>
        <div className="hf-empty-state-desc">Run analysis to generate parameter scores</div>
      </div>
    );
  }

  // Group all scores by parameter (agent behavior has its own Behaviour tab via BehaviorMeasurement)
  const groupByParameter = (scoreList: CallScore[]) => {
    const grouped: Record<string, CallScore[]> = {};
    for (const score of scoreList) {
      const key = score.parameterId;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(score);
    }
    return grouped;
  };

  const allGrouped = groupByParameter(scores);

  // Score color helper
  const scoreColor = (v: number) => ({
    primary: v >= 0.7 ? "var(--status-success-text)" : v >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)",
    glow: v >= 0.7 ? "var(--status-success-text)" : v >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)",
  });


  // Render a group of score sliders
  const renderScoreSliders = (grouped: Record<string, CallScore[]>, groupColor: { primary: string; glow: string }, groupTitle: string, emptyMessage: string) => {
    const entries = Object.entries(grouped);
    if (entries.length === 0) {
      return (
        <div className="hf-text-center hf-text-muted hf-text-xs hf-p-md">
          {emptyMessage}
        </div>
      );
    }

    return (
      <div>
        <div className="hf-flex-wrap hf-gap-md">
          {entries.map(([parameterId, paramScores]) => {
            const avg = paramScores.reduce((sum, s) => sum + s.score, 0) / paramScores.length;
            const paramName = paramScores[0]?.parameter?.name || parameterId;
            const isExpanded = expandedParam === parameterId;
            const color = scoreColor(avg);

            // Build history sorted oldest→newest
            const history = [...paramScores]
              .sort((a, b) => new Date(a.call.createdAt).getTime() - new Date(b.call.createdAt).getTime())
              .map(s => s.score);

            const historyInfo = history.length >= 2
              ? `\n\nHistory: ${history.length} calls\nRange: ${(Math.min(...history) * 100).toFixed(0)}% - ${(Math.max(...history) * 100).toFixed(0)}%`
              : "";
            const tooltip = `${paramName}\n\nAverage: ${(avg * 100).toFixed(0)}% (${paramScores.length} scores)${historyInfo}\n\n${paramScores[0]?.parameter?.definition || ""}\n\nClick for details`;

            return (
              <div key={parameterId} className="hf-flex-col hf-items-center">
                <VerticalSlider
                  value={avg}
                  color={color}
                  onClick={() => setExpandedParam(isExpanded ? null : parameterId)}
                  isActive={isExpanded}
                  tooltip={tooltip}
                  width={56}
                  height={140}
                  showGauge={false}
                  historyPoints={history}
                />

                {/* Label */}
                <div
                  className="hf-slider-label"
                  style={{ color: isExpanded ? color.primary : "var(--text-muted)" }}
                  onClick={() => setExpandedParam(isExpanded ? null : parameterId)}
                >
                  {paramName}
                </div>

                {/* Sparkline - now handled automatically by VerticalSlider when historyPoints is provided */}
              </div>
            );
          })}
        </div>

        {/* Expanded detail panel */}
        {expandedParam && grouped[expandedParam] && (() => {
          const paramScores = grouped[expandedParam];
          const paramName = paramScores[0]?.parameter?.name || expandedParam;
          const avg = paramScores.reduce((sum, s) => sum + s.score, 0) / paramScores.length;
          const sorted = [...paramScores].sort((a, b) => new Date(b.call.createdAt).getTime() - new Date(a.call.createdAt).getTime());

          return (
            <div className="hf-detail-panel">
              {/* Header */}
              <div className="hf-detail-panel-header">
                <div>
                  <div className="hf-text-md hf-text-bold">{paramName}</div>
                  <div className="hf-text-xs hf-text-muted">{paramScores[0]?.parameter?.definition || ""}</div>
                </div>
                <div className="hf-score-avg" style={{ color: scoreColor(avg).primary }}>
                  {(avg * 100).toFixed(0)}% <span className="hf-score-avg-sub">avg of {paramScores.length}</span>
                </div>
              </div>

              {/* Individual scores */}
              {sorted.map((s) => {
                const isScoreExpanded = expandedScore === s.id;
                return (
                  <div key={s.id} className="hf-border-bottom">
                    <button
                      onClick={() => setExpandedScore(isScoreExpanded ? null : s.id)}
                      className={`hf-flex hf-gap-md hf-score-row-btn ${isScoreExpanded ? "hf-score-row-btn-active" : ""}`}
                    >
                      <div
                        className="hf-score-badge"
                        style={{
                          background: s.score >= 0.7 ? "var(--status-success-bg)" : s.score >= 0.4 ? "var(--status-warning-bg)" : "var(--status-error-bg)",
                          color: s.score >= 0.7 ? "var(--status-success-text)" : s.score >= 0.4 ? "var(--status-warning-text)" : "var(--status-error-text)",
                        }}
                      >
                        {(s.score * 100).toFixed(0)}
                      </div>
                      <div className="hf-text-xs hf-text-muted hf-w-50">
                        {(s.confidence * 100).toFixed(0)}% conf
                      </div>
                      <div className="hf-text-secondary hf-text-xs hf-flex-1">
                        {new Date(s.call.createdAt).toLocaleString()}
                      </div>
                      {s.analysisSpec && (
                        <span className="hf-micro-badge hf-micro-badge-purple">
                          {s.analysisSpec.slug || s.analysisSpec.name}
                        </span>
                      )}
                      <span className="hf-text-placeholder hf-text-xs">{isScoreExpanded ? "\u25BC" : "\u25B6"}</span>
                    </button>

                    {isScoreExpanded && (
                      <div className="hf-detail-panel-body">
                        {isAdvanced && s.evidence && s.evidence.length > 0 && (
                          <div className="hf-mb-sm">
                            <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Evidence</div>
                            {s.evidence.map((e: string, i: number) => (
                              <div key={i} className="hf-evidence-quote">
                                {e}
                              </div>
                            ))}
                          </div>
                        )}
                        {isAdvanced && s.reasoning && (
                          <div className="hf-mb-sm">
                            <div className="hf-text-xs hf-text-bold hf-text-muted hf-mb-xs">Reasoning</div>
                            <div className="hf-text-xs hf-text-secondary hf-text-italic">{s.reasoning}</div>
                          </div>
                        )}
                        <div className="hf-flex hf-gap-lg hf-text-xs hf-text-placeholder">
                          <span>Call ID: {s.callId?.slice(0, 8)}...</span>
                          <span>Scored: {new Date(s.scoredAt).toLocaleString()}</span>
                          {s.analysisSpecId && <span>Spec: {s.analysisSpecId.slice(0, 8)}...</span>}
                          {s.scoredBy && <span>By: {s.scoredBy}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </div>
    );
  };

  return (
    <SliderGroup
      title={`Caller Scores (${Object.keys(allGrouped).length})`}
      color={{ primary: "var(--button-primary-bg)", glow: "var(--button-primary-bg)" }}
    >
      {renderScoreSliders(allGrouped, { primary: "var(--button-primary-bg)", glow: "var(--button-primary-bg)" }, "Scores", "No scores yet")}
    </SliderGroup>
  );
}

// =====================================================
// TrustProgressSection
// =====================================================

// Trust-Weighted Progress Section
const TRUST_BADGE_COLORS: Record<string, { bg: string; text: string }> = {
  REGULATORY_STANDARD: { bg: "var(--status-error-bg)", text: "var(--trust-l5-text, #991b1b)" },
  ACCREDITED_MATERIAL: { bg: "var(--status-warning-bg)", text: "var(--trust-l4-text, #854d0e)" },
  PUBLISHED_REFERENCE: { bg: "var(--badge-blue-bg)", text: "var(--status-info-text)" },
  EXPERT_CURATED: { bg: "var(--badge-purple-bg, #f5f3ff)", text: "var(--badge-purple-text, #5b21b6)" },
  AI_ASSISTED: { bg: "var(--status-success-bg)", text: "var(--status-success-text)" },
  UNVERIFIED: { bg: "var(--surface-secondary)", text: "var(--text-muted)" },
};

const TRUST_LABELS: Record<string, string> = {
  REGULATORY_STANDARD: "L5 Regulatory",
  ACCREDITED_MATERIAL: "L4 Accredited",
  PUBLISHED_REFERENCE: "L3 Published",
  EXPERT_CURATED: "L2 Expert",
  AI_ASSISTED: "L1 AI",
  UNVERIFIED: "L0 Unverified",
};

type TrustCurriculum = {
  specSlug: string;
  specName: string;
  specId: string | null;
  certifiedMastery: number;
  supplementaryMastery: number;
  certificationReadiness: number;
  moduleBreakdown: Record<string, {
    mastery: number;
    trustLevel: string;
    trustWeight: number;
    countsToCertification: boolean;
  }>;
};

export function TrustProgressSection({ callerId }: { callerId: string }) {
  const [curricula, setCurricula] = useState<TrustCurriculum[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const loadedForRef = useRef<string | null>(null);

  useEffect(() => {
    if (loadedForRef.current === callerId) return;
    loadedForRef.current = callerId;
    fetch(`/api/callers/${callerId}/trust-progress`)
      .then((r) => r.json())
      .then((data) => {
        if (data.ok && data.curricula?.length > 0) {
          setCurricula(data.curricula);
        }
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [callerId]);

  if (loading || curricula.length === 0) return null;

  return (
    <div className="hf-gradient-card">
      <div className="hf-flex hf-gap-sm hf-mb-md">
        <div className="hf-status-dot hf-status-dot-success" />
        <span className="hf-section-header-label">Certification Progress</span>
      </div>

      {curricula.map((curr) => {
        const modules = Object.entries(curr.moduleBreakdown);
        const certCount = modules.filter(([, m]) => m.countsToCertification).length;

        return (
          <div key={curr.specSlug} style={{ marginBottom: curricula.length > 1 ? 16 : 0 }}>
            <div className="hf-text-sm hf-text-bold hf-text-primary hf-mb-10">
              {curr.specName}
            </div>

            {/* Dual-track bars */}
            <div className="hf-flex-col hf-gap-sm">
              {/* Certification Readiness */}
              <div className="hf-flex hf-gap-md">
                <span className="hf-text-xs hf-text-bold hf-text-success hf-w-140 hf-flex-shrink-0">
                  Cert. Readiness
                </span>
                <div className="hf-progress-track">
                  <div
                    className="hf-progress-fill"
                    style={{
                      width: `${Math.round(curr.certificationReadiness * 100)}%`,
                      background: "var(--status-success-text)",
                    }}
                  />
                </div>
                <span className="hf-mono hf-text-bold hf-text-success hf-w-40 hf-text-right">
                  {Math.round(curr.certificationReadiness * 100)}%
                </span>
              </div>

              {/* General Understanding */}
              <div className="hf-flex hf-gap-md">
                <span className="hf-text-xs hf-text-bold hf-text-muted hf-w-140 hf-flex-shrink-0">
                  General Understanding
                </span>
                <div className="hf-progress-track">
                  <div
                    className="hf-progress-fill"
                    style={{
                      width: `${Math.round(curr.supplementaryMastery * 100)}%`,
                      background: "var(--accent-secondary, #8b5cf6)",
                    }}
                  />
                </div>
                <span className="hf-mono hf-text-bold hf-w-40 hf-text-right hf-text-accent-secondary">
                  {Math.round(curr.supplementaryMastery * 100)}%
                </span>
              </div>
            </div>

            {/* Summary line */}
            <div className="hf-text-xs hf-text-muted hf-mt-6">
              {certCount} of {modules.length} modules count toward certification (L3+)
            </div>

            {/* Expandable module breakdown */}
            {modules.length > 0 && (
              <div className="hf-mt-sm">
                <button
                  onClick={() => setExpanded(!expanded)}
                  className="hf-expand-btn hf-text-xs hf-text-muted hf-gap-xs hf-py-sm hf-p-0"
                >
                  <span className={`hf-caret ${expanded ? "hf-caret-open" : ""}`}>&#9654;</span>
                  Module breakdown
                </button>

                {expanded && (
                  <div className="hf-flex-col hf-gap-xs hf-mt-6">
                    {modules.map(([moduleId, mod]) => {
                      const badgeColors = TRUST_BADGE_COLORS[mod.trustLevel] || TRUST_BADGE_COLORS.UNVERIFIED;
                      const label = TRUST_LABELS[mod.trustLevel] || mod.trustLevel;
                      return (
                        <div key={moduleId} className="hf-module-row">
                          <span className="hf-flex-1 hf-text-500 hf-text-primary">{moduleId}</span>
                          <span
                            className="hf-micro-badge"
                            style={{
                              background: badgeColors.bg,
                              color: badgeColors.text,
                            }}
                          >
                            {label}
                          </span>
                          <span className="hf-mono hf-text-bold hf-w-36 hf-text-right" style={{ color: mod.mastery >= 0.8 ? "var(--status-success-text)" : mod.mastery >= 0.5 ? "var(--status-warning-text)" : "var(--text-muted)" }}>
                            {Math.round(mod.mastery * 100)}%
                          </span>
                          <span className="hf-text-xs hf-text-center hf-w-14" style={{ color: mod.countsToCertification ? "var(--status-success-text)" : "var(--text-placeholder)" }}>
                            {mod.countsToCertification ? "\u2713" : "\u2212"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =====================================================
// ProgressRing (private helper)
// =====================================================

// Learning Section - displays goals, curriculum progress and learner profile
function ProgressRing({ progress, size = 64, strokeWidth = 5, color }: { progress: number; size?: number; strokeWidth?: number; color: string }) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - progress * circumference;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)", flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--border-default)" strokeWidth={strokeWidth} />
      <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={color} strokeWidth={strokeWidth} strokeDasharray={circumference} strokeDashoffset={offset} strokeLinecap="round" style={{ transition: "stroke-dashoffset 0.3s ease" }} />
      <text x={size / 2} y={size / 2} textAnchor="middle" dominantBaseline="central" style={{ transform: "rotate(90deg)", transformOrigin: "center", fontSize: size * 0.22, fontWeight: 700, fill: color, fontFamily: "ui-monospace, monospace" }}>
        {Math.round(progress * 100)}%
      </text>
    </svg>
  );
}

/**
 * #417 follow-up — affordance shown in place of the misleading raw-progress
 * value when a SKILL-NN ACHIEVE goal has no real measurement evidence yet.
 *
 * Two states:
 *  - "awaiting_evidence": BehaviorTarget exists, just no scores accumulated
 *  - "not_configured":   playbook has no BehaviorTarget for this skillRef
 *                        (legacy course pre-#417 — re-project to enable)
 *
 * Copy is educator-facing: tells them WHY the value is blank and WHAT to do.
 */
function SkillMeasurementAffordance({
  status,
  ref,
}: {
  status: "awaiting_evidence" | "not_configured";
  ref: string;
}) {
  if (status === "awaiting_evidence") {
    return (
      <div className="hf-banner hf-banner-info hf-mt-xs">
        <div className="hf-text-xs">
          <strong>Awaiting first call evidence</strong> — this skill ({ref}) is
          part of the course&apos;s framework but the learner hasn&apos;t been
          scored on it yet. Progress will populate after their next call.
        </div>
      </div>
    );
  }
  return (
    <div className="hf-banner hf-banner-warning hf-mt-xs">
      <div className="hf-text-xs">
        <strong>Skill scoring not configured</strong> — this goal references{" "}
        {ref} but the course has no skills framework wired in. The previous
        progress value reflected transcript keywords, not actual skill
        measurement. <strong>Re-project the course through the wizard</strong>{" "}
        with a Skills Framework section to enable per-call per-skill scoring.
      </div>
    </div>
  );
}

// =====================================================
// AssessmentTargetsCard
// =====================================================

export function AssessmentTargetsCard({ goals, callerId }: { goals: Goal[]; callerId: string }) {
  const [confirming, setConfirming] = useState<string | null>(null);

  const assessmentGoals = goals.filter(g => g.isAssessmentTarget);
  if (assessmentGoals.length === 0) return null;

  const handleAction = async (goalId: string, action: "confirm" | "dismiss") => {
    setConfirming(goalId);
    try {
      const res = await fetch(`/api/goals/${goalId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (res.ok) {
        // Reload the page to reflect changes
        window.location.reload();
      }
    } finally {
      setConfirming(null);
    }
  };

  return (
    <div className="hf-gradient-card-lg">
      <div className="hf-flex hf-gap-sm hf-mb-md">
        <Target size={16} className="hf-text-accent" />
        <span className="hf-section-header-label">Assessment Targets</span>
      </div>
      <div className="hf-flex-col hf-gap-md">
        {assessmentGoals.map((goal) => {
          const threshold = goal.assessmentConfig?.threshold ?? 0.8;
          const pct = Math.round(goal.progress * 100);
          const thresholdPct = Math.round(threshold * 100);
          const isNearReady = goal.progress >= threshold * 0.85;
          const isCompleted = goal.status === "COMPLETED";
          const hasPending = !!goal.pendingSignal;
          // #417 follow-up — SKILL-NN goals carry a measurementStatus so the
          // UI can distinguish "real per-skill score" from "engagement-heuristic
          // noise" for legacy / not-yet-projected courses.
          const isSkillGoal = typeof goal.ref === "string" && goal.ref.startsWith("SKILL-");
          const skillStatus = goal.measurementStatus;
          const isUnmeasured = isSkillGoal && skillStatus && skillStatus !== "measured";

          const progressColor = isUnmeasured
            ? "var(--text-muted)"
            : isCompleted
              ? "var(--status-success-text)"
              : isNearReady
                ? "var(--accent-primary)"
                : goal.progress < 0.3
                  ? "var(--status-error-text)"
                  : "var(--status-warning-text)";

          return (
            <div key={goal.id} className="hf-card-compact">
              <div className="hf-flex hf-gap-lg">
                <ProgressRing
                  progress={isUnmeasured ? 0 : goal.progress}
                  size={64}
                  color={progressColor}
                />
                <div className="hf-flex-1">
                  <div className="hf-flex hf-gap-sm hf-mb-xs hf-items-center">
                    <span className="hf-section-title">{goal.name}</span>
                    {isCompleted && (
                      <StatusBadge status="validated" size="compact" />
                    )}
                  </div>
                  {goal.description && (
                    <div className="hf-text-xs hf-text-muted hf-mb-xs">{goal.description}</div>
                  )}
                  {isUnmeasured ? (
                    <SkillMeasurementAffordance status={skillStatus!} ref={goal.ref!} />
                  ) : (
                    <div className="hf-flex hf-gap-sm hf-items-center hf-flex-wrap">
                      <div className="hf-text-xs hf-text-secondary">
                        {pct}% ready — target: {thresholdPct}%
                      </div>
                      {isSkillGoal &&
                        skillStatus === "measured" &&
                        typeof goal.skillCurrentScore === "number" && (
                          <BandChip
                            score={goal.skillCurrentScore}
                            mapping={goal.tierMapping}
                            size="compact"
                          />
                        )}
                    </div>
                  )}

                  {/* Pending self-report signal (suppressed when unmeasured —
                      we don't want educators confirming a score they haven't
                      actually seen real evidence for) */}
                  {hasPending && !isCompleted && !isUnmeasured && (
                    <div className="hf-flex hf-gap-sm hf-mt-sm hf-items-center hf-p-sm hf-border-radius-md"
                      style={{ background: "var(--status-warning-bg)", border: "1px solid var(--status-warning-border)" }}>
                      <span className="hf-text-xs hf-text-warning hf-flex-1">
                        Learner reported passing
                        {goal.pendingSignal?.evidence && (
                          <span className="hf-text-muted"> — &ldquo;{goal.pendingSignal.evidence}&rdquo;</span>
                        )}
                      </span>
                      <button
                        className="hf-btn hf-btn-sm hf-btn-success"
                        onClick={() => handleAction(goal.id, "confirm")}
                        disabled={confirming === goal.id}
                      >
                        <Check size={12} /> Confirm
                      </button>
                      <button
                        className="hf-btn hf-btn-sm hf-btn-ghost"
                        onClick={() => handleAction(goal.id, "dismiss")}
                        disabled={confirming === goal.id}
                      >
                        <X size={12} /> Dismiss
                      </button>
                    </div>
                  )}

                  {/* Manual completion for goals without self-report
                      (suppressed when unmeasured) */}
                  {!hasPending && !isCompleted && !isUnmeasured && (
                    <button
                      className="hf-btn hf-btn-sm hf-btn-outline hf-mt-sm"
                      onClick={() => handleAction(goal.id, "confirm")}
                      disabled={confirming === goal.id}
                    >
                      Mark as achieved
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================
// LearningSection
// =====================================================

export function LearningSection({
  curriculum,
  learnerProfile,
  goals,
  callerId
}: {
  curriculum: CurriculumProgress | null | undefined;
  learnerProfile: LearnerProfile | null | undefined;
  goals: Goal[] | undefined;
  callerId: string;
}) {
  const [showArchived, setShowArchived] = useState(false);
  const [selectedModule, setSelectedModule] = useState<{ id: string; name: string; mastery: number } | null>(null);
  const hasCurriculum = curriculum && curriculum.hasData;
  const hasProfile = learnerProfile && (
    learnerProfile.learningStyle ||
    learnerProfile.pacePreference ||
    learnerProfile.interactionStyle ||
    learnerProfile.preferredModality ||
    learnerProfile.questionFrequency ||
    learnerProfile.feedbackStyle ||
    Object.keys(learnerProfile.priorKnowledge).length > 0
  );
  const hasGoals = goals && goals.length > 0;

  if (!hasCurriculum && !hasProfile && !hasGoals) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">🎯</div>
        <div className="hf-empty-state-title">No goals yet</div>
        <div className="hf-empty-state-desc">Goals are created automatically when a caller is assigned to a domain</div>
      </div>
    );
  }

  const MODULE_STATUS_COLORS: Record<string, { primary: string; glow: string }> = {
    completed: { primary: "var(--status-success-text)", glow: "var(--status-success-text)" },
    in_progress: { primary: "var(--accent-primary)", glow: "var(--accent-primary)" },
    not_started: { primary: "var(--text-muted)", glow: "var(--text-muted)" },
  };

  // #357 follow-up: goals where isAssessmentTarget=true are already rendered
  // by AssessmentTargetsCard above this section. Filter them out here so the
  // user doesn't see two copies of the same "Reach Secure on …" goal.
  const nonAssessmentGoals = goals?.filter(g => !g.isAssessmentTarget) ?? [];
  const activeGoals = nonAssessmentGoals.filter(g => g.status === 'ACTIVE' || g.status === 'PAUSED');
  const archivedGoals = nonAssessmentGoals.filter(g => g.status === 'ARCHIVED' || g.status === 'COMPLETED');

  return (
    <div className="hf-flex-col hf-gap-20">
      {/* Active Goals — each as a visual card */}
      {activeGoals.map((goal) => {
        const typeConfig = GOAL_TYPE_CONFIG[goal.type] || { label: goal.type, icon: "🎯", color: "var(--text-muted)", glow: "var(--text-muted)" };
        const isLearn = goal.type === 'LEARN' && hasCurriculum && curriculum;

        return (
          <div key={goal.id}>
            {isLearn ? (
              /* LEARN goal: SliderGroup with curriculum modules as sliders */
              <>
              <SliderGroup
                title={`${typeConfig.icon} ${goal.name} — ${Math.round(goal.progress * 100)}% — ${curriculum.completedCount}/${curriculum.totalModules} modules`}
                color={{ primary: typeConfig.color, glow: typeConfig.glow }}
              >
                {/* Goal metadata strip */}
                <div className="hf-flex-wrap hf-text-xs hf-text-muted hf-gap-md hf-w-full hf-mb-xs hf-items-center">
                  {goal.description && <span>{goal.description}</span>}
                  {goal.playbook && <PlaybookPill label={`${goal.playbook.name} v${goal.playbook.version}`} size="compact" />}
                  {goal.startedAt && <span className="hf-opacity-70">Started {new Date(goal.startedAt).toLocaleDateString()}</span>}
                  {curriculum.nextModule && (
                    <span className="hf-text-success hf-text-bold">
                      Next: {curriculum.modules.find(m => m.id === curriculum.nextModule)?.name || curriculum.nextModule}
                    </span>
                  )}
                </div>
                {/* One slider per curriculum module — click to drill into LOs */}
                {curriculum.modules.map((mod) => {
                  const modColor = MODULE_STATUS_COLORS[mod.status] || MODULE_STATUS_COLORS.not_started;
                  const isCurrent = mod.id === curriculum.nextModule;
                  const isSelected = selectedModule?.id === mod.id;
                  return (
                    <VerticalSlider
                      key={mod.id}
                      value={mod.mastery}
                      targetValue={0.8}
                      color={isSelected
                        ? { primary: "var(--accent-primary)", glow: "var(--accent-primary)" }
                        : modColor}
                      label={mod.name}
                      tooltip={`${mod.name}\nStatus: ${mod.status}\nMastery: ${Math.round(mod.mastery * 100)}%\n${mod.description}\n\nClick for learning outcomes`}
                      width={56}
                      height={120}
                      isActive={isCurrent || isSelected}
                      showSparkline={false}
                      onClick={() => setSelectedModule(
                        isSelected ? null : { id: mod.id, name: mod.name, mastery: mod.mastery }
                      )}
                    />
                  );
                })}
              </SliderGroup>
              {/* Module detail panel — LO breakdown + assertions */}
              {selectedModule && (
                <ModuleDetailPanel
                  callerId={callerId}
                  moduleSlug={selectedModule.id}
                  moduleTitle={selectedModule.name}
                  moduleMastery={selectedModule.mastery}
                  onClose={() => setSelectedModule(null)}
                />
              )}
              </>
            ) : (
              /* Non-LEARN goal: Progress ring card */
              <div className="hf-gradient-card">
                <div className="hf-flex hf-gap-lg">
                  <ProgressRing progress={goal.progress} size={72} color={typeConfig.color} />
                  <div className="hf-flex-1">
                    <div className="hf-flex hf-gap-sm hf-mb-xs">
                      <span style={{ fontSize: 16 }}>{typeConfig.icon}</span>
                      <GoalPill label={typeConfig.label} size="compact" />
                      <StatusBadge status={goal.status === 'ACTIVE' ? 'active' : 'pending'} size="compact" />
                      {/* #417 Story B — ref + outcome name on LEARN goals
                          carrying provenance from the wizard projection. */}
                      {goal.type === "LEARN" && goal.ref && (
                        <span className="hf-text-xs hf-text-muted">
                          <Acronym>{goal.ref}</Acronym>
                          {goal.loDescription ? ` — ${goal.loDescription}` : null}
                        </span>
                      )}
                    </div>
                    <div className="hf-section-title">{goal.name}</div>
                    {goal.description && (
                      <div className="hf-text-xs hf-text-muted hf-mt-xs">{goal.description}</div>
                    )}
                    {/* #417 Story B — module-touch summary for ref-linked LEARN goals. */}
                    {goal.type === "LEARN" && goal.ref && typeof goal.loTotalModules === "number" && (
                      <div className="hf-text-xs hf-text-muted hf-mt-xs">
                        {goal.loTouchedModules ?? 0} of {goal.loTotalModules} module
                        {goal.loTotalModules === 1 ? "" : "s"} carrying this outcome have evidence
                      </div>
                    )}
                    <div className="hf-flex-wrap hf-text-xs hf-text-muted hf-gap-md hf-mt-sm hf-items-center">
                      {goal.playbook && <PlaybookPill label={`${goal.playbook.name} v${goal.playbook.version}`} size="compact" />}
                      {goal.startedAt && <span>Started {new Date(goal.startedAt).toLocaleDateString()}</span>}
                      {goal.targetDate && <span>Target: {new Date(goal.targetDate).toLocaleDateString()}</span>}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Learner Profile — compact chips */}
      {hasProfile && learnerProfile && (
        <div className="hf-gradient-card">
          <div className="hf-flex hf-gap-sm hf-mb-md">
            <div className="hf-status-dot hf-status-dot-purple" />
            <span className="hf-section-header-label">Learner Profile</span>
          </div>
          <div className="hf-flex-wrap hf-gap-sm">
            {learnerProfile.learningStyle && (
              <span className="hf-profile-chip">
                <strong>Style:</strong> {learnerProfile.learningStyle}
              </span>
            )}
            {learnerProfile.pacePreference && (
              <span className="hf-profile-chip">
                <strong>Pace:</strong> {learnerProfile.pacePreference}
              </span>
            )}
            {learnerProfile.interactionStyle && (
              <span className="hf-profile-chip">
                <strong>Interaction:</strong> {learnerProfile.interactionStyle}
              </span>
            )}
            {learnerProfile.preferredModality && (
              <span className="hf-profile-chip">
                <strong>Modality:</strong> {learnerProfile.preferredModality}
              </span>
            )}
            {learnerProfile.questionFrequency && (
              <span className="hf-profile-chip">
                <strong>Questions:</strong> {learnerProfile.questionFrequency}
              </span>
            )}
            {learnerProfile.feedbackStyle && (
              <span className="hf-profile-chip">
                <strong>Feedback:</strong> {learnerProfile.feedbackStyle}
              </span>
            )}
            {Object.entries(learnerProfile.priorKnowledge).map(([domain, level]) => (
              <span key={domain} className="hf-profile-chip-info">
                <strong>{domain}:</strong> {level}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Trust-Weighted Progress */}
      <TrustProgressSection callerId={callerId} />

      {/* Archived Goals — collapsed by default */}
      {archivedGoals.length > 0 && (
        <div>
          <button
            onClick={() => setShowArchived(!showArchived)}
            className="hf-expand-btn hf-text-xs hf-text-muted hf-gap-sm hf-py-sm hf-p-0"
          >
            <span className={`hf-caret hf-caret-lg ${showArchived ? "hf-caret-open" : ""}`}>&#9654;</span>
            {archivedGoals.length} archived goal{archivedGoals.length > 1 ? "s" : ""}
          </button>
          {showArchived && (
            <div className="hf-flex-col hf-gap-sm hf-mt-xs">
              {archivedGoals.map((goal) => {
                const typeConfig = GOAL_TYPE_CONFIG[goal.type] || { label: goal.type, icon: "🎯", color: "var(--text-muted)", glow: "var(--text-muted)" };
                return (
                  <div
                    key={goal.id}
                    className="hf-flex hf-gap-md hf-archived-goal-row"
                  >
                    <span className="hf-text-md">{typeConfig.icon}</span>
                    <span className="hf-text-sm hf-text-secondary hf-text-500 hf-flex-1">{goal.name}</span>
                    <span className="hf-mono hf-text-bold" style={{ color: typeConfig.color }}>
                      {Math.round(goal.progress * 100)}%
                    </span>
                    <StatusBadge status={goal.status === 'COMPLETED' ? 'validated' : 'archived'} size="compact" />
                    {goal.playbook && (
                      <PlaybookPill label={goal.playbook.name} size="compact" />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// TopicsCoveredSection
// =====================================================

export function TopicsCoveredSection({ memorySummary, keyFactCount }: { memorySummary: MemorySummary | null; keyFactCount: number }) {
  const topTopics = memorySummary?.topTopics ?? [];
  const topicCount = memorySummary?.topicCount ?? 0;

  if (!topTopics.length && !keyFactCount) {
    return (
      <div className="hf-text-center hf-text-muted hf-text-sm hf-p-md">
        No topics or key facts recorded yet.
      </div>
    );
  }

  return (
    <div className="hf-flex-col hf-gap-lg">
      {/* Stats row */}
      <div className="hf-flex hf-gap-md">
        <div className="hf-summary-card hf-flex-1">
          <div className="hf-summary-card-label">
            <BookOpen size={12} /> Topics Discussed
          </div>
          <div className="hf-summary-card-value">{topicCount}</div>
        </div>
        <div className="hf-summary-card hf-flex-1">
          <div className="hf-summary-card-label">
            <CheckSquare size={12} /> Key Facts
          </div>
          <div className="hf-summary-card-value">{keyFactCount}</div>
        </div>
      </div>

      {/* Topic chips */}
      {topTopics.length > 0 && (
        <div className="hf-card-compact hf-mb-0">
          <div className="hf-flex-wrap hf-gap-sm">
            {topTopics.map((t) => (
              <span
                key={t.topic}
                className="hf-topic-pill"
                style={{
                  background: CATEGORY_COLORS.TOPIC.bg,
                  color: CATEGORY_COLORS.TOPIC.text,
                }}
              >
                <BookOpen size={11} />
                {t.topic}
                {t.lastMentioned && (
                  <span className="hf-text-xs hf-opacity-70">
                    {formatRelativeDate(t.lastMentioned)}
                  </span>
                )}
              </span>
            ))}
          </div>
          {topicCount > topTopics.length && (
            <p className="hf-text-xs hf-text-muted hf-mt-sm">
              +{topicCount - topTopics.length} more topics discussed across calls
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// =====================================================
// formatRelativeDate (private helper)
// =====================================================

function formatRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / 86400000);
  if (diffDays === 0) return "today";
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// =====================================================
// ExamReadinessSection
// =====================================================

// Exam Readiness Section - shows readiness scores, gate status, weak modules, attempt history
export function ExamReadinessSection({ callerId, onDataLoaded }: { callerId: string; onDataLoaded?: (hasData: boolean) => void }) {
  const [curricula, setCurricula] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const examLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (examLoadedRef.current === callerId) return;
    examLoadedRef.current = callerId;
    fetch(`/api/callers/${callerId}/exam-readiness`)
      .then((r) => r.json())
      .then((result) => {
        if (result.ok) {
          const data = result.curricula || [];
          setCurricula(data);
          onDataLoaded?.(data.length > 0);
        } else {
          setError(result.error || "Failed to load exam readiness");
          onDataLoaded?.(false);
        }
      })
      .catch(() => { setError("Network error"); onDataLoaded?.(false); })
      .finally(() => setLoading(false));
  }, [callerId]);

  // Don't render anything if no data (chip won't show either)
  if (loading) return null;
  if (error || curricula.length === 0) return null;

  const LEVEL_CONFIG = EXAM_LEVEL_CONFIG;

  return (
    <div className="hf-flex-col hf-gap-20">
      {curricula.map((curr: any) => {
        const levelCfg = LEVEL_CONFIG[curr.level] || LEVEL_CONFIG.not_ready;
        const pct = Math.round(curr.readinessScore * 100);
        const weakModules: string[] = curr.weakModules || [];
        const moduleMastery: Record<string, number> = curr.moduleMastery || {};
        const moduleEntries = Object.entries(moduleMastery);

        return (
          <div key={curr.specSlug} className="hf-gradient-card-lg">
            {/* Header: spec slug + level badge + gate */}
            <div className="hf-flex-between hf-flex-wrap hf-gap-md hf-mb-lg">
              <div className="hf-flex hf-gap-md">
                <div className="hf-status-dot" style={{ background: levelCfg.color, boxShadow: `0 0 8px ${levelCfg.color}` }} />
                <span className="hf-text-md hf-text-bold hf-text-primary" style={{ fontSize: 15 }}>{curr.specSlug}</span>
                <span
                  className="hf-badge"
                  style={{
                    background: levelCfg.bg,
                    color: levelCfg.color,
                    border: `1px solid ${levelCfg.border}`,
                    letterSpacing: "0.02em",
                  }}
                >
                  {levelCfg.label}
                </span>
              </div>
              <span
                className="hf-badge"
                style={{
                  background: curr.gateStatus?.allowed ? "var(--status-success-bg)" : "var(--status-error-bg)",
                  color: curr.gateStatus?.allowed ? "var(--status-success-text)" : "var(--status-error-text)",
                  border: `1px solid ${curr.gateStatus?.allowed ? "var(--status-success-border)" : "var(--status-error-border)"}`,
                }}
              >
                {curr.gateStatus?.allowed ? "Gate: OPEN" : "Gate: LOCKED"}
              </span>
            </div>

            {/* Readiness Score — large ring */}
            <div className="hf-flex hf-gap-xl hf-mb-lg">
              <div className="hf-ring-container">
                <svg width={80} height={80} viewBox="0 0 80 80">
                  <circle cx={40} cy={40} r={34} fill="none" stroke="var(--border-default)" strokeWidth={6} />
                  <circle
                    cx={40} cy={40} r={34}
                    fill="none"
                    stroke={levelCfg.color}
                    strokeWidth={6}
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - curr.readinessScore)}`}
                    transform="rotate(-90 40 40)"
                    style={{ filter: `drop-shadow(0 0 4px ${levelCfg.color})` }}
                  />
                </svg>
                <div className="hf-ring-overlay" style={{ color: levelCfg.color }}>
                  {pct}%
                </div>
              </div>
              <div className="hf-flex-1">
                <div className="hf-text-sm hf-text-bold hf-text-primary hf-mb-xs">Readiness Score</div>
                <div className="hf-text-xs hf-text-muted hf-leading-relaxed">
                  {curr.gateStatus?.reason}
                </div>
                <div className="hf-flex-wrap hf-gap-lg hf-mt-sm">
                  {curr.formativeScore !== null && (
                    <span className="hf-text-xs hf-text-muted">
                      Formative: <strong className="hf-text-secondary">{Math.round(curr.formativeScore * 100)}%</strong>
                    </span>
                  )}
                  <span className="hf-text-xs hf-text-muted">
                    Attempts: <strong className="hf-text-secondary">{curr.attemptCount}</strong>
                  </span>
                  {curr.bestScore !== null && (
                    <span className="hf-text-xs hf-text-muted">
                      Best: <strong className="hf-text-secondary">{Math.round(curr.bestScore * 100)}%</strong>
                    </span>
                  )}
                  {curr.lastAttemptPassed !== null && (
                    <span className={`hf-text-xs ${curr.lastAttemptPassed ? "hf-text-success" : "hf-text-error"}`}>
                      Last: {curr.lastAttemptPassed ? "PASSED" : "FAILED"}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Module Mastery Bars */}
            {moduleEntries.length > 0 && (
              <div style={{ marginBottom: weakModules.length > 0 ? 16 : 0 }}>
                <div className="hf-text-xs hf-text-bold hf-text-secondary hf-mb-sm hf-tracking-wide">
                  Module Mastery
                </div>
                <div className="hf-flex-col hf-gap-sm">
                  {moduleEntries.map(([moduleId, mastery]) => {
                    const masteryPct = Math.round((mastery as number) * 100);
                    const isWeak = weakModules.includes(moduleId);
                    const barColor = isWeak ? "var(--status-warning-text)" : "var(--status-success-text)";
                    return (
                      <div key={moduleId} className="hf-flex hf-gap-md">
                        <div
                          className="hf-truncate hf-text-xs hf-w-140 hf-flex-shrink-0"
                          style={{
                            color: isWeak ? "var(--status-warning-text)" : "var(--text-muted)",
                            fontWeight: isWeak ? 600 : 400,
                          }}
                          title={moduleId}
                        >
                          {moduleId}
                        </div>
                        <div className="hf-mastery-bar-track">
                          <div className="hf-mastery-bar-fill" style={{
                            width: `${masteryPct}%`,
                            background: barColor,
                            boxShadow: `0 0 6px ${barColor}`,
                          }} />
                        </div>
                        <span
                          className="hf-text-xs hf-text-bold hf-w-36 hf-text-right hf-flex-shrink-0"
                          style={{
                            color: isWeak ? "var(--status-warning-text)" : "var(--text-secondary)",
                          }}
                        >
                          {masteryPct}%
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Weak Modules Warning */}
            {weakModules.length > 0 && (
              <div className="hf-banner hf-banner-warning hf-mb-0 hf-leading-relaxed">
                <strong>Weak modules:</strong> {weakModules.join(", ")} — targeted revision recommended before exam attempt
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// =====================================================
// TopLevelAgentBehaviorSection
// =====================================================

// Top-Level Targets Section - shows behavior targets for this caller
// Top-Level Behaviour Section - shows targets + measurements across all calls
export function TopLevelAgentBehaviorSection({ callerId, calls: propCalls, callerTargets: propCallerTargets }: { callerId: string; calls?: any[]; callerTargets?: any[] }) {
  const { isAdvanced } = useViewMode();
  const [measurements, setMeasurements] = useState<any[]>([]);
  const [callerTargets, setCallerTargets] = useState<any[]>(propCallerTargets || []);
  const [behaviorTargets, setBehaviorTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const behaviorLoadedRef = useRef<string | null>(null);

  useEffect(() => {
    if (behaviorLoadedRef.current === callerId) return;
    behaviorLoadedRef.current = callerId;
    fetchData();
  }, [callerId]);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Use calls from props if available, otherwise fetch
      let calls = propCalls;
      if (!calls) {
        const res = await fetch(`/api/callers/${callerId}`);
        const data = await res.json();
        if (data.ok) {
          calls = data.calls || [];
          setCallerTargets(data.callerTargets || []);
        } else {
          calls = [];
        }
      }

      if (calls.length > 0) {
        // Fetch measurements from each call
        const allMeasurements: any[] = [];
        for (const call of calls.slice(0, 10)) {
          const callRes = await fetch(`/api/calls/${call.id}`);
          const callData = await callRes.json();
          if (callData.ok && callData.measurements) {
            allMeasurements.push(
              ...callData.measurements.map((m: any) => ({
                ...m,
                callCreatedAt: call.createdAt,
              }))
            );
          }
        }
        setMeasurements(allMeasurements);

        // Fetch behavior targets from the most recent call
        const mostRecentCall = calls[0];
        const callDetailRes = await fetch(`/api/calls/${mostRecentCall.id}`);
        const callDetail = await callDetailRes.json();
        if (callDetail.ok) {
          setBehaviorTargets(callDetail.effectiveTargets || []);
        }
      }
    } catch (err) {
      console.error("Error fetching behaviour data:", err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="hf-text-center hf-p-lg">
        <div className="hf-text-muted">Loading behaviour data...</div>
      </div>
    );
  }

  if (measurements.length === 0 && behaviorTargets.length === 0 && callerTargets.length === 0) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">🤖</div>
        <div className="hf-empty-state-title">No behaviour data</div>
        <div className="hf-empty-state-desc">
          Targets and measurements will appear here after calls are analyzed
        </div>
      </div>
    );
  }

  // Group measurements by parameter and calculate averages
  const grouped: Record<string, any[]> = {};
  for (const m of measurements) {
    const key = m.parameterId;
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(m);
  }

  // Transform measurements into format for TwoColumnTargetsDisplay
  // We show average measurements as the primary value
  const avgMeasurements = Object.entries(grouped).map(([parameterId, paramMeasurements]) => {
    const avg = paramMeasurements.reduce((sum, m) => sum + m.actualValue, 0) / paramMeasurements.length;
    return {
      parameterId,
      actualValue: avg,
    };
  });

  // Build per-parameter history arrays sorted oldest-to-newest for sparklines
  const historyByParameter: Record<string, number[]> = {};
  for (const [parameterId, paramMeasurements] of Object.entries(grouped)) {
    const sorted = [...paramMeasurements].sort(
      (a, b) => new Date(a.callCreatedAt).getTime() - new Date(b.callCreatedAt).getTime()
    );
    historyByParameter[parameterId] = sorted.map((m: any) => m.actualValue);
  }

  // Advanced: full two-column targets + measurements with layer cascade
  if (isAdvanced) {
    return <TwoColumnTargetsDisplay callerTargets={callerTargets} behaviorTargets={behaviorTargets} measurements={avgMeasurements} historyByParameter={historyByParameter} />;
  }

  // Simple: measurement averages as clean sliders (no targets, no scope cascade)
  if (avgMeasurements.length === 0) {
    return (
      <div className="hf-empty-state">
        <div className="hf-empty-state-icon">🤖</div>
        <div className="hf-empty-state-title">No measurements yet</div>
        <div className="hf-empty-state-desc">
          Behaviour measurements will appear here after calls are analyzed
        </div>
      </div>
    );
  }

  // Build a label lookup from behaviorTargets or callerTargets
  const paramNames: Record<string, string> = {};
  for (const t of [...behaviorTargets, ...callerTargets]) {
    if (t.parameter?.name) paramNames[t.parameterId] = t.parameter.name;
  }

  return (
    <SliderGroup
      title={`Behaviour (${avgMeasurements.length})`}
      color={{ primary: "var(--badge-indigo-text)", glow: "var(--button-primary-bg)" }}
    >
      <div className="hf-flex-wrap hf-gap-md">
        {avgMeasurements.map((m) => {
          const name = paramNames[m.parameterId] || m.parameterId;
          const history = historyByParameter[m.parameterId] || [];
          const color = m.actualValue >= 0.7
            ? { primary: "var(--status-success-text)", glow: "var(--status-success-text)" }
            : m.actualValue >= 0.4
            ? { primary: "var(--status-warning-text)", glow: "var(--status-warning-text)" }
            : { primary: "var(--status-error-text)", glow: "var(--status-error-text)" };

          return (
            <div key={m.parameterId} className="hf-flex-col hf-items-center">
              <VerticalSlider
                value={m.actualValue}
                color={color}
                tooltip={`${name}\n\nAverage: ${(m.actualValue * 100).toFixed(0)}%${history.length >= 2 ? `\nHistory: ${history.length} calls` : ""}`}
                width={56}
                height={140}
                showGauge={false}
                historyPoints={history}
              />
              <div className="hf-slider-label hf-text-muted">
                {name.replace("BEH-", "").replace(/-/g, " ")}
              </div>
            </div>
          );
        })}
      </div>
    </SliderGroup>
  );
}

// =====================================================
// PlanProgressSection
// =====================================================

// ------------------------------------------------------------------
// Plan Progress Section - shows lesson plan progress for a caller
// ------------------------------------------------------------------

// Session type labels/colors now come from canonical getSessionTypeLabel/getSessionTypeColor

export function PlanProgressSection({
  callerId,
  calls,
  domainId,
  onDataLoaded,
}: {
  callerId: string;
  calls: Call[];
  domainId: string | null | undefined;
  onDataLoaded?: (hasData: boolean) => void;
}) {
  const [plan, setPlan] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!domainId) {
      setLoading(false);
      onDataLoaded?.(false);
      return;
    }
    // Find curriculum for this caller's domain, then fetch its lesson plan
    (async () => {
      try {
        // Find subject for this domain
        const domainRes = await fetch(`/api/domains/${domainId}`);
        const domainData = await domainRes.json();
        if (!domainData.ok || !domainData.domain?.subjects?.length) {
          setLoading(false);
          onDataLoaded?.(false);
          return;
        }
        const subjectId = domainData.domain.subjects[0].subjectId;

        // Get curriculum for this subject
        const currRes = await fetch(`/api/subjects/${subjectId}/curriculum`);
        const currData = await currRes.json();
        if (!currData.curriculum?.id) {
          setLoading(false);
          onDataLoaded?.(false);
          return;
        }

        // Get lesson plan
        const planRes = await fetch(`/api/curricula/${currData.curriculum.id}/lesson-plan`);
        const planData = await planRes.json();
        if (planData.ok && planData.plan) {
          setPlan(planData.plan);
          onDataLoaded?.(true);
        } else {
          onDataLoaded?.(false);
        }
      } catch {
        onDataLoaded?.(false);
      }
      setLoading(false);
    })();
  }, [domainId]);

  // Don't render anything if no data
  if (loading) return null;
  if (!plan || !plan.entries?.length) return null;

  const entries: any[] = plan.entries;
  const completedCalls = calls.length;
  const totalPlanned = entries.length;

  // Map calls to plan entries by index (call 1 → session 1, etc.)
  const progressEntries = entries.map((entry: any, i: number) => {
    const callIndex = i;
    const call = calls.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())[callIndex];

    let status: "completed" | "current" | "upcoming";
    if (callIndex < completedCalls - 1) {
      status = "completed";
    } else if (callIndex === completedCalls - 1) {
      status = "current";
    } else {
      status = "upcoming";
    }

    return {
      ...entry,
      status,
      call: call || null,
      callDate: call?.createdAt || null,
    };
  });

  const progressPct = totalPlanned > 0 ? Math.round((Math.min(completedCalls, totalPlanned) / totalPlanned) * 100) : 0;

  return (
    <div className="hf-p-md">
      <h3 className="hf-section-title hf-mb-xs">Plan Progress</h3>
      <div className="hf-section-desc hf-mb-12">
        Call {completedCalls} of {totalPlanned} planned ({progressPct}% through plan)
      </div>

      {/* Progress bar */}
      <div className="hf-mb-md hf-progress-track-thin">
        <div
          className="hf-progress-fill-animated"
          style={{
            background: progressPct === 100 ? "var(--status-success-text)" : "var(--accent-primary)",
            width: `${progressPct}%`,
          }}
        />
      </div>

      {/* Session list */}
      <div className="hf-grid-gap-4">
        {progressEntries.map((e: any) => {
          const sessionCfg = { label: getSessionTypeLabel(e.type), color: getSessionTypeColor(e.type) };
          return (
            <div key={e.session} className="hf-plan-row" style={{
              border: e.status === "current" ? "1px solid var(--accent-primary)" : "1px solid var(--border-subtle)",
              background: e.status === "current"
                ? "color-mix(in srgb, var(--accent-primary) 6%, transparent)"
                : e.status === "completed"
                  ? "var(--surface-primary)"
                  : "transparent",
              opacity: e.status === "upcoming" ? 0.6 : 1,
            }}>
              {/* Status icon */}
              <span className="hf-text-center hf-text-md hf-w-18">
                {e.status === "completed" ? "\u2705" : e.status === "current" ? "\uD83D\uDD35" : "\u2B1C"}
              </span>

              {/* Session number */}
              <span className="hf-text-xs hf-text-bold hf-text-muted hf-w-20 hf-text-right hf-tabular-nums">
                {e.session}.
              </span>

              {/* Label */}
              <span className="hf-text-sm hf-flex-1 hf-text-primary" style={{ fontWeight: e.status === "current" ? 600 : 400 }}>
                {e.label}
              </span>

              {/* Session type badge */}
              <span
                className="hf-session-badge"
                style={{
                  color: sessionCfg.color,
                  backgroundColor: `color-mix(in srgb, ${sessionCfg.color} 12%, transparent)`,
                }}
              >
                {sessionCfg.label}
              </span>

              {/* Module label */}
              {e.moduleLabel && (
                <span className="hf-text-xs hf-text-muted hf-truncate hf-max-w-120">
                  {e.moduleLabel}
                </span>
              )}

              {/* Call date */}
              {e.callDate && (
                <span className="hf-text-xs hf-text-muted hf-tabular-nums">
                  {new Date(e.callDate).toLocaleDateString()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// =====================================================
// ModuleProgressView — first-class module mastery
// =====================================================

interface ModuleProgressItem {
  id: string;
  mastery: number;
  status: string;
  callCount: number;
  module: {
    id: string;
    slug: string;
    title: string;
    sortOrder: number;
    curriculum: { id: string; name: string };
  };
}

export function ModuleProgressView({ callerId }: { callerId: string }) {
  const [items, setItems] = useState<ModuleProgressItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/callers/${callerId}/module-progress`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.statusText);
      const data = await res.json();
      setItems(data.progress || []);
    } catch (err: any) {
      if (err.name !== "AbortError") setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [callerId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return null; // Don't show spinner — section appears when data exists
  if (error) {
    return (
      <div className="hf-banner hf-banner-error hf-mb-md">
        Module progress: {error}
      </div>
    );
  }
  if (items.length === 0) return null; // No module progress yet — hide section

  const statusColor = (status: string) => {
    if (status === "COMPLETED") return "var(--status-success-text)";
    if (status === "IN_PROGRESS") return "var(--accent-primary)";
    return "var(--text-muted)";
  };

  return (
    <div className="hf-card hf-mb-md">
      <div className="hf-flex hf-gap-sm hf-items-center hf-mb-md">
        <Layers size={16} style={{ color: "var(--accent-primary)" }} />
        <span className="hf-section-title" style={{ margin: 0 }}>Module Progress</span>
        <span className="hf-text-xs hf-text-muted">
          {items.filter((i) => i.status === "COMPLETED").length}/{items.length} completed
        </span>
      </div>
      <div style={{ display: "grid", gap: 8 }}>
        {items.map((item) => (
          <div key={item.id} className="hf-list-row hf-flex hf-items-center hf-gap-sm">
            <span className="hf-text-xs hf-mono" style={{ fontWeight: 700, color: "var(--accent-primary)", minWidth: 48 }}>
              {item.module.slug}
            </span>
            <span className="hf-text-sm hf-text-primary hf-flex-1">{item.module.title}</span>
            {/* Mastery bar */}
            <div style={{
              width: 80,
              height: 6,
              borderRadius: 3,
              background: "var(--surface-secondary)",
              overflow: "hidden",
            }}>
              <div style={{
                width: `${Math.round(item.mastery * 100)}%`,
                height: "100%",
                borderRadius: 3,
                background: statusColor(item.status),
                transition: "width 0.3s ease",
              }} />
            </div>
            <span className="hf-text-xs hf-text-muted" style={{ minWidth: 32, textAlign: "right" }}>
              {Math.round(item.mastery * 100)}%
            </span>
            <span className="hf-text-xs" style={{ color: statusColor(item.status), minWidth: 36 }}>
              {item.status === "COMPLETED" ? "Done" : item.status === "IN_PROGRESS" ? "Active" : "—"}
            </span>
            <span className="hf-text-xs hf-text-muted">{item.callCount} call{item.callCount !== 1 ? "s" : ""}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
