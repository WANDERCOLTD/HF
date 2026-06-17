"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  TrendingUp,
  AlertTriangle,
  Info,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Circle,
  CircleDot,
} from "lucide-react";

import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  TierCell,
} from "@/components/shared/TierCell";
import { tierLabel } from "@/lib/banding/tier-colors";

import { AttainmentCertProgressSection } from "./AttainmentCertProgressSection";

import "./attainment-tab.css";

/**
 * Caller Detail → Attainment tab (SP4-A).
 *
 * Unified per-learner "where they are right now" view across the four
 * parallel state stores: skill EMA bands, LO mastery, module mastery,
 * goal progress. Replaces fragmented coverage in `ProgressTab`,
 * `SkillBandStripCard`, `ModulesSection`, `GoalsSection`, `MockResultCard`
 * which will be tagged `WILL_RETIRE` in SP4-E once the foundation
 * registry from S5 ships.
 *
 * Sprint 4 SP4-A shell: Skill Bands section fully built (consumes
 * `/api/callers/[id]/skills-evidence` for the per-skill evidence expand).
 * Module Mastery + Goals sections are scaffolded; full SP4-C / SP4-D
 * polish lands in follow-ups.
 *
 * STUDENT may view their OWN data (route uses `studentAllowedToReadCaller`).
 * OPERATOR+ may view any caller.
 */

interface SkillBand {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  currentScore: number | null;
  targetValue: number;
  callsUsed: number;
  tier: string;
  bandLabel: number | null;
  exceedsTarget: boolean;
}

interface ModuleProgress {
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  mastery: number;
  status: string;
  attemptsCount: number;
  /**
   * #1703 Theme 9 — count of incomplete attempts on this module
   * (incremented when Session ends below `minSpeakingSec` OR with
   * GHOST/FAILED outcome). Surfaced as a chip in ModulesSection when > 0
   * per Epic #1700 missing-surface sweep (surface 3 of 3).
   */
  incompleteAttempts: number;
  freshMasteryActive: boolean;
}

interface AttainmentGoalTrail {
  excerpts: string[];
  totalCount: number;
  firstNoticedAt: string | null;
  lastMentionedAt: string | null;
  sourceCallId: string | null;
  lastMentionedCallId: string | null;
  mentionCount: number;
  extractionMethod: string | null;
  confidence: number | null;
}

interface AttainmentGoal {
  id: string;
  ref: string | null;
  name: string;
  type: string;
  status: string;
  progress: number;
  strategy: string | null;
  trail: AttainmentGoalTrail | null;
}

/**
 * #1747 follow-on — talk-time chip data for the most recent voice/sim
 * call. `null` when the caller has no recent transcript-bearing session.
 */
interface AttainmentRecentCallTalkTime {
  sessionId: string;
  kind: string;
  startedAt: string;
  evaluation: {
    overBudget: boolean;
    exceededBy: Array<"maxTutorTurnSec" | "maxTutorRatio">;
    budgets: { maxTutorTurnSec: number; maxTutorRatio: number };
  };
  stats: {
    tutorTurnCount: number;
    learnerTurnCount: number;
    tutorWordCount: number;
    learnerWordCount: number;
    maxTutorTurnWords: number;
    maxTutorTurnSec: number;
    tutorRatio: number;
    wordsPerSecond: number;
  };
}

interface ProfileField {
  key: string;
  label: string;
  value: string;
  confidence: number;
}

interface AttainmentResponse {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  useFreshMastery: boolean;
  skillBands: SkillBand[];
  modules: ModuleProgress[];
  goals: AttainmentGoal[];
  recentCallTalkTime: AttainmentRecentCallTalkTime | null;
  profile: ProfileField[];
  empty: boolean;
}

interface SkillEvidenceItem {
  callId: string;
  measuredAt: string;
  score: number;
  confidence: number;
  excerpts: string[];
  // Wave A2 — score-provenance fields from CallScore via (callId,
  // parameterId). Surface the AI's reasoning + spec + #566 badges so
  // ProgressTab v1's ScoresSection can retire without losing this
  // detail. All optional — legacy paths leave them null.
  reasoning?: string | null;
  analysisSpecName?: string | null;
  hasLearnerEvidence?: boolean | null;
  evidenceQuality?: number | null;
  scoredBy?: string | null;
}

interface SkillEvidenceRow {
  skillRef: string;
  parameterId: string;
  parameterName: string;
  evidence: SkillEvidenceItem[];
}

interface SkillEvidenceResponse {
  callerId: string;
  rows: SkillEvidenceRow[];
}

type LoMasteryStatus = "mastered" | "in_progress" | "not_started";

interface LoMasteryEntry {
  ref: string;
  description: string;
  mastery: number | null;
  tier: string | null;
  bandLabel: number | null;
  masteryThreshold: number | null;
  status: LoMasteryStatus;
  updatedAt: string | null;
}

interface LoMasteryResponse {
  callerId: string;
  playbookId: string | null;
  moduleId: string;
  moduleSlug: string;
  moduleTitle: string;
  useFreshMastery: boolean;
  scratchSourceCallId: string | null;
  learningObjectives: LoMasteryEntry[];
}

interface Props {
  callerId: string;
}

export function AttainmentTab({ callerId }: Props) {
  const searchParams = useSearchParams();
  const deepLinkSkillRef = searchParams?.get("skillRef") ?? null;
  const skillRowRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const autoExpandedRef = useRef(false);

  const [data, setData] = useState<AttainmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkillRef, setExpandedSkillRef] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, SkillEvidenceItem[]>>({});
  const [evidenceLoading, setEvidenceLoading] = useState<string | null>(null);
  const [expandedModuleId, setExpandedModuleId] = useState<string | null>(null);
  const [loBreakdown, setLoBreakdown] = useState<Record<string, LoMasteryResponse>>({});
  const [loLoading, setLoLoading] = useState<string | null>(null);
  const [loError, setLoError] = useState<Record<string, string>>({});
  const [expandedGoalId, setExpandedGoalId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/callers/${callerId}/attainment`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        return res.json();
      })
      .then((payload: AttainmentResponse) => {
        if (!cancelled) setData(payload);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [callerId]);

  const handleToggleModule = async (moduleId: string) => {
    const next = expandedModuleId === moduleId ? null : moduleId;
    setExpandedModuleId(next);
    if (next && !loBreakdown[moduleId]) {
      setLoLoading(moduleId);
      setLoError((prev) => {
        const { [moduleId]: _, ...rest } = prev;
        void _;
        return rest;
      });
      try {
        const res = await fetch(
          `/api/callers/${callerId}/lo-mastery?moduleId=${encodeURIComponent(moduleId)}`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `${res.status} ${res.statusText}`);
        }
        const payload: LoMasteryResponse = await res.json();
        setLoBreakdown((prev) => ({ ...prev, [moduleId]: payload }));
      } catch (err) {
        setLoError((prev) => ({
          ...prev,
          [moduleId]: (err as Error).message,
        }));
      } finally {
        setLoLoading(null);
      }
    }
  };

  const handleToggleSkill = async (skillRef: string) => {
    const next = expandedSkillRef === skillRef ? null : skillRef;
    setExpandedSkillRef(next);
    if (next && !evidence[skillRef]) {
      setEvidenceLoading(skillRef);
      try {
        const res = await fetch(`/api/callers/${callerId}/skills-evidence`);
        if (res.ok) {
          const body: SkillEvidenceResponse = await res.json();
          const map: Record<string, SkillEvidenceItem[]> = {};
          for (const row of body.rows) {
            map[row.skillRef] = row.evidence;
          }
          setEvidence((prev) => ({ ...prev, ...map }));
        }
      } finally {
        setEvidenceLoading(null);
      }
    }
  };

  // SP4-F deep-link receive — when arriving from the Cohort Heatmap
  // (or any inbound `?skillRef=…` link) auto-expand the matching skill
  // row and scroll it into view. Fires once per mount.
  useEffect(() => {
    if (autoExpandedRef.current) return;
    if (!deepLinkSkillRef || !data) return;
    const match = data.skillBands.find(
      (b) => b.skillRef === deepLinkSkillRef,
    );
    if (!match) return;
    autoExpandedRef.current = true;
    void handleToggleSkill(deepLinkSkillRef);
    requestAnimationFrame(() => {
      const node = skillRowRefs.current[deepLinkSkillRef];
      node?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
    // handleToggleSkill is stable for this purpose — re-running only on
    // data/deepLinkSkillRef change. The guard `autoExpandedRef.current`
    // makes the effect idempotent across re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, deepLinkSkillRef]);

  if (loading) {
    return (
      <div className="hf-attainment-loading" role="status" aria-live="polite">
        Loading attainment…
      </div>
    );
  }

  if (error) {
    return (
      <div className="hf-attainment-error hf-banner-error" role="alert">
        <AlertTriangle size={16} />
        <div>
          <strong>Could not load Attainment.</strong>
          <div>{error}</div>
        </div>
      </div>
    );
  }

  if (!data) return null;

  if (data.empty || !data.playbookId) {
    return (
      <div className="hf-attainment-empty">
        <Info size={20} aria-hidden />
        <div>
          <strong>No course enrolment found.</strong>
          <p>
            This learner isn&apos;t enrolled on a course yet. Once enrolled,
            their attainment across skills, modules, and goals shows here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="hf-attainment-tab">
      <header className="hf-attainment-header">
        <h2 className="hf-section-title">
          <TrendingUp size={18} aria-hidden /> Attainment
        </h2>
        <p className="hf-section-desc">
          Where this learner is right now —{" "}
          {data.playbookName ? <strong>{data.playbookName}</strong> : null}.
          {data.useFreshMastery
            ? " · Mock-exam mode: mastery resets each session."
            : ""}
        </p>
        {data.recentCallTalkTime?.evaluation.overBudget ? (
          <TalkTimeOverBudgetChip telemetry={data.recentCallTalkTime} />
        ) : null}
      </header>

      <SkillBandsSection
        bands={data.skillBands}
        expandedSkillRef={expandedSkillRef}
        evidence={evidence}
        evidenceLoading={evidenceLoading}
        onToggleSkill={handleToggleSkill}
        rowRefs={skillRowRefs}
      />

      <ModulesSection
        modules={data.modules}
        useFreshMastery={data.useFreshMastery}
        expandedModuleId={expandedModuleId}
        loBreakdown={loBreakdown}
        loLoading={loLoading}
        loError={loError}
        onToggleModule={handleToggleModule}
      />

      <GoalsSection
        goals={data.goals}
        expandedGoalId={expandedGoalId}
        onToggleGoal={(id) =>
          setExpandedGoalId((current) => (current === id ? null : id))
        }
      />

      {/* #1704 Theme 10 — captured learner-profile fields for tester review. */}
      <ProfileSection profile={data.profile} />

      {/* Wave A2 — lifted from ProgressTab v1's TrustProgressSection.
       * Renders trust-weighted certification readiness + per-module
       * L0–L5 chips so progress-v2 + v1 can retire without losing the
       * cert-readiness signal educators rely on. */}
      <AttainmentCertProgressSection callerId={callerId} />
    </div>
  );
}

// ── Learner profile section (#1704 Theme 10) ────────────────────────────────

function ProfileSection({ profile }: { profile: ProfileField[] }) {
  if (profile.length === 0) return null;
  return (
    <section className="hf-attainment-section">
      <h3 className="hf-attainment-section-title">Learner profile</h3>
      <p className="hf-attainment-section-desc">
        Captured from conversation during the session — for tester review.
      </p>
      <div className="hf-attainment-goal-rows">
        {profile.map((field) => (
          <div key={field.key} className="hf-attainment-goal-row">
            <span className="hf-attainment-goal-name">{field.label}</span>
            <span className="hf-attainment-goal-pct">{field.value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Skill Bands section ─────────────────────────────────────────────────────

function SkillBandsSection({
  bands,
  expandedSkillRef,
  evidence,
  evidenceLoading,
  onToggleSkill,
  rowRefs,
}: {
  bands: SkillBand[];
  expandedSkillRef: string | null;
  evidence: Record<string, SkillEvidenceItem[]>;
  evidenceLoading: string | null;
  onToggleSkill: (skillRef: string) => void;
  rowRefs?: React.MutableRefObject<Record<string, HTMLDivElement | null>>;
}) {
  if (bands.length === 0) {
    return (
      <section className="hf-attainment-section">
        <h3 className="hf-attainment-section-title">Skill bands</h3>
        <p className="hf-attainment-empty-text">
          No skills declared for this course yet.
        </p>
      </section>
    );
  }
  return (
    <section className="hf-attainment-section">
      <h3 className="hf-attainment-section-title">Skill bands</h3>
      <p className="hf-attainment-section-desc">
        Continuous EMA per cross-cutting skill. Tier banded via the
        course&apos;s configured rubric. Click a skill to see the most recent
        evidence the AI tutor cited.
      </p>
      <div className="hf-attainment-skill-rows">
        {bands.map((band) => {
          const tierForCell = band.exceedsTarget
            ? ABOVE_TARGET
            : band.currentScore == null
              ? AWAITING_EVIDENCE
              : band.tier;
          const expanded = expandedSkillRef === band.skillRef;
          return (
            <div
              key={band.skillRef}
              ref={(el) => {
                if (rowRefs) rowRefs.current[band.skillRef] = el;
              }}
              className="hf-attainment-skill-row"
            >
              <button
                type="button"
                className="hf-attainment-skill-header"
                onClick={() => onToggleSkill(band.skillRef)}
                aria-expanded={expanded}
              >
                <span className="hf-attainment-skill-ref">{band.skillRef}</span>
                <span className="hf-attainment-skill-name">
                  {band.parameterName}
                </span>
                <TierCell
                  tier={tierForCell}
                  size="compact"
                  caption={
                    band.currentScore != null
                      ? `${(band.currentScore * 10).toFixed(1)} · ${band.callsUsed} calls`
                      : "Awaiting"
                  }
                  target={band.tier === "secure" || band.tier === "distinction"}
                />
                <span className="hf-attainment-skill-target">
                  Target: {(band.targetValue * 10).toFixed(1)}
                </span>
                <span className="hf-attainment-skill-chevron" aria-hidden>
                  {expanded ? "▾" : "▸"}
                </span>
              </button>
              {expanded ? (
                <SkillEvidencePanel
                  skillRef={band.skillRef}
                  evidence={evidence[band.skillRef] ?? null}
                  loading={evidenceLoading === band.skillRef}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SkillEvidencePanel({
  skillRef,
  evidence,
  loading,
}: {
  skillRef: string;
  evidence: SkillEvidenceItem[] | null;
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="hf-attainment-evidence-loading" aria-live="polite">
        Loading evidence…
      </div>
    );
  }
  if (!evidence || evidence.length === 0) {
    return (
      <div className="hf-attainment-evidence-empty">
        <em>No evidence captured for {skillRef} yet.</em>
      </div>
    );
  }
  return (
    <div className="hf-attainment-evidence-list">
      <div className="hf-attainment-evidence-title">
        Last {evidence.length} time{evidence.length === 1 ? "" : "s"} the AI
        tutor scored this skill
      </div>
      {evidence.map((item, i) => (
        <div key={`${item.callId}-${i}`} className="hf-attainment-evidence-item">
          <div className="hf-attainment-evidence-meta">
            <span className="hf-attainment-evidence-date">
              {new Date(item.measuredAt).toLocaleDateString()}
            </span>
            <span className="hf-attainment-evidence-score">
              Score {(item.score * 10).toFixed(1)} · conf{" "}
              {(item.confidence * 100).toFixed(0)}%
            </span>
            {/* Wave A2 — score-provenance badges (#566 + analysis spec
              + scoredBy) lifted from ProgressTab v1 detail-expand. */}
            {item.hasLearnerEvidence === true && (
              <span
                className="hf-badge hf-badge-success"
                style={{ marginLeft: 4 }}
                title="Score backed by learner transcript"
              >
                learner-backed
              </span>
            )}
            {item.hasLearnerEvidence === false && (
              <span
                className="hf-badge hf-badge-warning"
                style={{ marginLeft: 4 }}
                title="Score derived from tutor prose only (#566)"
              >
                tutor-only
              </span>
            )}
            {typeof item.evidenceQuality === "number" && (
              <span
                className="hf-badge hf-badge-muted"
                style={{ marginLeft: 4 }}
                title="Scorer's evidence-quality judgment (0..1, #566)"
              >
                evidence q {(item.evidenceQuality * 100).toFixed(0)}%
              </span>
            )}
            {item.scoredBy && (
              <span
                className="hf-text-sm hf-text-muted"
                style={{ marginLeft: 4 }}
              >
                via {item.scoredBy}
              </span>
            )}
          </div>
          {item.excerpts.length > 0 ? (
            <ul className="hf-attainment-evidence-quotes">
              {item.excerpts.map((q, j) => (
                <li key={j}>&ldquo;{q}&rdquo;</li>
              ))}
            </ul>
          ) : (
            <em className="hf-attainment-evidence-quote-empty">
              No transcript excerpts recorded for this measurement.
            </em>
          )}
          {item.reasoning && (
            <div
              className="hf-text-sm hf-text-muted"
              style={{ marginTop: 4 }}
              data-testid="hf-attainment-evidence-reasoning"
            >
              <strong>Reasoning:</strong> {item.reasoning}
            </div>
          )}
          {item.analysisSpecName && (
            <div
              className="hf-text-sm hf-text-muted"
              style={{ marginTop: 2 }}
              data-testid="hf-attainment-evidence-spec"
            >
              Spec: {item.analysisSpecName}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Modules section + per-LO drill (SP4-C) ──────────────────────────────────

function ModulesSection({
  modules,
  useFreshMastery,
  expandedModuleId,
  loBreakdown,
  loLoading,
  loError,
  onToggleModule,
}: {
  modules: ModuleProgress[];
  useFreshMastery: boolean;
  expandedModuleId: string | null;
  loBreakdown: Record<string, LoMasteryResponse>;
  loLoading: string | null;
  loError: Record<string, string>;
  onToggleModule: (moduleId: string) => void;
}) {
  if (modules.length === 0) {
    return (
      <section className="hf-attainment-section">
        <h3 className="hf-attainment-section-title">Module mastery</h3>
        <p className="hf-attainment-empty-text">
          No module progress captured yet.
        </p>
      </section>
    );
  }
  return (
    <section className="hf-attainment-section">
      <h3 className="hf-attainment-section-title">Module mastery</h3>
      <p className="hf-attainment-section-desc">
        Per-module rollup of LO mastery. Click a module to see what&apos;s
        mastered, what&apos;s in progress, and what hasn&apos;t been touched yet.
        {useFreshMastery
          ? " · Mock-exam: this course resets per session — figures reflect the most recent mock, not long-term mastery."
          : ""}
      </p>
      <div className="hf-attainment-module-rows">
        {modules.map((m) => {
          const pct = Math.round(m.mastery * 100);
          const expanded = expandedModuleId === m.moduleId;
          const breakdown = loBreakdown[m.moduleId];
          const isLoading = loLoading === m.moduleId;
          const err = loError[m.moduleId] ?? null;
          return (
            <div key={m.moduleId} className="hf-attainment-module-row">
              <button
                type="button"
                className="hf-attainment-module-header"
                onClick={() => onToggleModule(m.moduleId)}
                aria-expanded={expanded}
                aria-controls={`hf-attainment-module-body-${m.moduleId}`}
              >
                <span
                  className="hf-attainment-module-chevron"
                  aria-hidden="true"
                >
                  {expanded ? (
                    <ChevronDown size={14} />
                  ) : (
                    <ChevronRight size={14} />
                  )}
                </span>
                <span className="hf-attainment-module-title">
                  {m.moduleTitle}
                </span>
                <span className="hf-attainment-module-bar">
                  <span
                    className="hf-attainment-module-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="hf-attainment-module-meta">
                  {pct}% · {m.status}
                  {m.attemptsCount > 0
                    ? ` · ${m.attemptsCount} attempt(s)`
                    : ""}
                </span>
                {m.incompleteAttempts > 0 ? (
                  <span
                    className="hf-attainment-module-incomplete-chip"
                    title="Sessions that ended below the module's minSpeakingSec threshold or with GHOST / FAILED outcome (#1703 Theme 9)"
                    data-testid={`hf-attainment-module-incomplete-${m.moduleSlug}`}
                  >
                    {m.incompleteAttempts} incomplete
                  </span>
                ) : null}
              </button>
              {expanded ? (
                <div
                  id={`hf-attainment-module-body-${m.moduleId}`}
                  className="hf-attainment-module-body"
                >
                  {isLoading ? (
                    <div
                      className="hf-attainment-lo-loading"
                      role="status"
                      aria-live="polite"
                    >
                      Loading learning objectives…
                    </div>
                  ) : err ? (
                    <div
                      className="hf-attainment-lo-error hf-banner-error"
                      role="alert"
                    >
                      <AlertTriangle size={14} />
                      <span>Could not load LO mastery: {err}</span>
                    </div>
                  ) : breakdown ? (
                    <LoBreakdown breakdown={breakdown} />
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function LoBreakdown({ breakdown }: { breakdown: LoMasteryResponse }) {
  if (breakdown.learningObjectives.length === 0) {
    return (
      <p className="hf-attainment-empty-text">
        No learner-visible objectives declared for this module yet.
      </p>
    );
  }
  const mastered = breakdown.learningObjectives.filter(
    (lo) => lo.status === "mastered",
  ).length;
  const inProgress = breakdown.learningObjectives.filter(
    (lo) => lo.status === "in_progress",
  ).length;
  const notStarted = breakdown.learningObjectives.filter(
    (lo) => lo.status === "not_started",
  ).length;
  const total = breakdown.learningObjectives.length;
  return (
    <div className="hf-attainment-lo-list">
      <div className="hf-attainment-lo-summary">
        <span className="hf-attainment-lo-summary-pill hf-attainment-lo-summary-pill-mastered">
          <CheckCircle2 size={12} /> {mastered} mastered
        </span>
        <span className="hf-attainment-lo-summary-pill hf-attainment-lo-summary-pill-in-progress">
          <CircleDot size={12} /> {inProgress} in progress
        </span>
        <span className="hf-attainment-lo-summary-pill hf-attainment-lo-summary-pill-not-started">
          <Circle size={12} /> {notStarted} yet to do
        </span>
        <span className="hf-attainment-lo-summary-total">
          {total} learning objective{total === 1 ? "" : "s"}
        </span>
      </div>
      {breakdown.useFreshMastery && !breakdown.scratchSourceCallId ? (
        <p className="hf-attainment-lo-note">
          Mock-exam course: mastery resets each session. No scoring call
          recorded yet, so every objective shows as &ldquo;yet to do&rdquo;.
        </p>
      ) : null}
      <ul className="hf-attainment-lo-rows">
        {breakdown.learningObjectives.map((lo) => {
          const pct = lo.mastery == null ? 0 : Math.round(lo.mastery * 100);
          return (
            <li key={lo.ref} className="hf-attainment-lo-row">
              <span
                className={`hf-attainment-lo-status hf-attainment-lo-status-${lo.status}`}
                aria-label={loStatusLabel(lo.status)}
              >
                {lo.status === "mastered" ? (
                  <CheckCircle2 size={14} />
                ) : lo.status === "in_progress" ? (
                  <CircleDot size={14} />
                ) : (
                  <Circle size={14} />
                )}
              </span>
              <span className="hf-attainment-lo-ref">{lo.ref}</span>
              <span className="hf-attainment-lo-desc">{lo.description}</span>
              {lo.mastery != null ? (
                <>
                  <span className="hf-attainment-lo-bar">
                    <span
                      className="hf-attainment-lo-bar-fill"
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="hf-attainment-lo-pct">{pct}%</span>
                  <span className="hf-attainment-lo-tier">
                    {lo.tier ? tierLabel(lo.tier) : ""}
                  </span>
                </>
              ) : (
                <span className="hf-attainment-lo-empty">Not yet scored</span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function loStatusLabel(status: LoMasteryStatus): string {
  switch (status) {
    case "mastered":
      return "Mastered";
    case "in_progress":
      return "In progress";
    case "not_started":
      return "Yet to do";
  }
}

// ── Goals section (SP4-D will deepen this) ──────────────────────────────────

function GoalsSection({
  goals,
  expandedGoalId,
  onToggleGoal,
}: {
  goals: AttainmentGoal[];
  expandedGoalId: string | null;
  onToggleGoal: (goalId: string) => void;
}) {
  if (goals.length === 0) {
    return (
      <section className="hf-attainment-section">
        <h3 className="hf-attainment-section-title">Goal progress</h3>
        <p className="hf-attainment-empty-text">
          No goals instantiated for this learner yet — the first few calls
          haven&apos;t surfaced anything specific to chase.
        </p>
      </section>
    );
  }
  return (
    <section className="hf-attainment-section">
      <h3 className="hf-attainment-section-title">Goal progress</h3>
      <p className="hf-attainment-section-desc">
        Per-goal progress with the strategy driving it. Click a goal to see
        the evidence trail — what the learner said and when.
      </p>
      <div className="hf-attainment-goal-rows">
        {goals.slice(0, 12).map((g) => {
          const pct = Math.round(g.progress * 100);
          const expanded = expandedGoalId === g.id;
          const hasTrail = g.trail != null && (
            g.trail.excerpts.length > 0 ||
            g.trail.mentionCount > 0 ||
            g.trail.firstNoticedAt != null
          );
          return (
            <div key={g.id} className="hf-attainment-goal-row">
              <button
                type="button"
                className="hf-attainment-goal-header"
                onClick={() => onToggleGoal(g.id)}
                aria-expanded={expanded}
                aria-controls={`hf-attainment-goal-body-${g.id}`}
                disabled={!hasTrail}
              >
                <span
                  className="hf-attainment-goal-chevron"
                  aria-hidden="true"
                >
                  {hasTrail ? (
                    expanded ? (
                      <ChevronDown size={12} />
                    ) : (
                      <ChevronRight size={12} />
                    )
                  ) : (
                    <span className="hf-attainment-goal-chevron-spacer" />
                  )}
                </span>
                <span className="hf-attainment-goal-type">{g.type}</span>
                <span className="hf-attainment-goal-name">{g.name}</span>
                {g.strategy ? (
                  <span className="hf-attainment-goal-strategy">
                    via {strategyLabel(g.strategy)}
                  </span>
                ) : null}
                <span className="hf-attainment-goal-bar">
                  <span
                    className="hf-attainment-goal-bar-fill"
                    style={{ width: `${pct}%` }}
                  />
                </span>
                <span className="hf-attainment-goal-pct">{pct}%</span>
              </button>
              {hasTrail && g.trail ? (
                <div className="hf-attainment-goal-summary">
                  {goalSummaryLine(g.trail)}
                </div>
              ) : (
                <div className="hf-attainment-goal-summary hf-attainment-goal-summary-empty">
                  No transcript evidence captured for this goal yet.
                </div>
              )}
              {expanded && g.trail ? (
                <div
                  id={`hf-attainment-goal-body-${g.id}`}
                  className="hf-attainment-goal-body"
                >
                  <GoalTrailDetail trail={g.trail} />
                </div>
              ) : null}
            </div>
          );
        })}
        {goals.length > 12 ? (
          <div className="hf-attainment-goal-more">
            + {goals.length - 12} more goals
          </div>
        ) : null}
      </div>
    </section>
  );
}

function GoalTrailDetail({ trail }: { trail: AttainmentGoalTrail }) {
  return (
    <div className="hf-attainment-trail">
      <div className="hf-attainment-trail-meta">
        {trail.extractionMethod ? (
          <span className="hf-attainment-trail-pill">
            {trail.extractionMethod === "EXPLICIT"
              ? "Said directly"
              : trail.extractionMethod === "INFERRED"
                ? "Inferred"
                : trail.extractionMethod}
          </span>
        ) : null}
        {trail.confidence != null ? (
          <span className="hf-attainment-trail-pill hf-attainment-trail-pill-muted">
            {Math.round(trail.confidence * 100)}% confidence
          </span>
        ) : null}
        {trail.mentionCount > 0 ? (
          <span className="hf-attainment-trail-pill hf-attainment-trail-pill-muted">
            Mentioned {trail.mentionCount}×
          </span>
        ) : null}
      </div>
      {trail.excerpts.length > 0 ? (
        <ul className="hf-attainment-trail-excerpts">
          {trail.excerpts.map((excerpt, i) => (
            <li key={i}>&ldquo;{excerpt}&rdquo;</li>
          ))}
        </ul>
      ) : (
        <p className="hf-attainment-trail-empty">
          No transcript excerpt captured at extraction time.
        </p>
      )}
      {trail.totalCount > trail.excerpts.length ? (
        <p className="hf-attainment-trail-more">
          + {trail.totalCount - trail.excerpts.length} older mention
          {trail.totalCount - trail.excerpts.length === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}

/** Educator-friendly one-liner summarising the trail. */
function goalSummaryLine(trail: AttainmentGoalTrail): string {
  const parts: string[] = [];
  if (trail.firstNoticedAt) {
    parts.push(`First noticed ${formatRelativeDate(trail.firstNoticedAt)}`);
  }
  if (
    trail.lastMentionedAt &&
    trail.lastMentionedAt !== trail.firstNoticedAt
  ) {
    parts.push(`last mentioned ${formatRelativeDate(trail.lastMentionedAt)}`);
  }
  if (trail.mentionCount > 1) {
    parts.push(`across ${trail.mentionCount} calls`);
  }
  return parts.length > 0 ? parts.join(" · ") : "Captured once";
}

/** Crude relative-date formatter — "today" / "yesterday" / "N days ago"
 *  / "N weeks ago" / explicit date for older. Educators read these in
 *  pre-call prep so absolute dates beyond a month carry more weight. */
function formatRelativeDate(iso: string): string {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return iso;
  const now = Date.now();
  const diffMs = now - then.getTime();
  const day = 24 * 60 * 60 * 1000;
  const days = Math.floor(diffMs / day);
  if (days < 0) return then.toLocaleDateString();
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 30) {
    const weeks = Math.round(days / 7);
    return `${weeks} week${weeks === 1 ? "" : "s"} ago`;
  }
  return then.toLocaleDateString();
}

function strategyLabel(strategy: string): string {
  switch (strategy.toLowerCase()) {
    case "lo_rollup":
      return "LO rollup";
    case "skill_ema":
      return "Skill EMA";
    case "assessment_readiness":
      return "Assessment readiness";
    case "connect_warmth_avg":
      return "Connection warmth";
    case "manual_only":
      return "Manual";
    default:
      return strategy;
  }
}

/**
 * #1747 follow-on — yellow telemetry chip surfaced when the most recent
 * voice/sim call exceeded the tutor talk-time budgets. Plain-language
 * reasons + the underlying stats so operators can act without
 * inspecting AppLogs.
 */
function TalkTimeOverBudgetChip({
  telemetry,
}: {
  telemetry: AttainmentRecentCallTalkTime;
}) {
  const { evaluation, stats } = telemetry;
  const tutorRatioPct = Math.round(stats.tutorRatio * 100);
  const maxTutorBudgetPct = Math.round(evaluation.budgets.maxTutorRatio * 100);
  const reasons: string[] = [];
  if (evaluation.exceededBy.includes("maxTutorTurnSec")) {
    reasons.push(
      `tutor spoke ${Math.round(stats.maxTutorTurnSec)}s in one turn ` +
        `(budget ${evaluation.budgets.maxTutorTurnSec}s)`,
    );
  }
  if (evaluation.exceededBy.includes("maxTutorRatio")) {
    reasons.push(
      `tutor ${tutorRatioPct}% of session words (budget ${maxTutorBudgetPct}%)`,
    );
  }
  return (
    <div
      className="hf-banner hf-banner-warning hf-attainment-talktime-chip"
      role="status"
    >
      <AlertTriangle size={14} aria-hidden />
      <strong>Tutor over-talked last call</strong>
      <span> · {reasons.join(" · ")}</span>
    </div>
  );
}
