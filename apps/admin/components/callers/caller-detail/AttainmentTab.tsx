"use client";

import { useEffect, useState } from "react";
import { TrendingUp, AlertTriangle, Info } from "lucide-react";

import {
  ABOVE_TARGET,
  AWAITING_EVIDENCE,
  TierCell,
} from "@/components/shared/TierCell";
import { tierLabel } from "@/lib/banding/tier-colors";

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
  freshMasteryActive: boolean;
}

interface AttainmentGoal {
  id: string;
  ref: string | null;
  name: string;
  type: string;
  status: string;
  progress: number;
  strategy: string | null;
  lastEvidence: {
    evidence: string | null;
    tier: string | null;
    band: number | null;
    callId: string | null;
    at: string | null;
  } | null;
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
  empty: boolean;
}

interface SkillEvidenceItem {
  callId: string;
  measuredAt: string;
  score: number;
  confidence: number;
  excerpts: string[];
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

interface Props {
  callerId: string;
}

export function AttainmentTab({ callerId }: Props) {
  const [data, setData] = useState<AttainmentResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedSkillRef, setExpandedSkillRef] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<Record<string, SkillEvidenceItem[]>>({});
  const [evidenceLoading, setEvidenceLoading] = useState<string | null>(null);

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
      </header>

      <SkillBandsSection
        bands={data.skillBands}
        expandedSkillRef={expandedSkillRef}
        evidence={evidence}
        evidenceLoading={evidenceLoading}
        onToggleSkill={handleToggleSkill}
      />

      <ModulesSection
        modules={data.modules}
        useFreshMastery={data.useFreshMastery}
      />

      <GoalsSection goals={data.goals} />
    </div>
  );
}

// ── Skill Bands section ─────────────────────────────────────────────────────

function SkillBandsSection({
  bands,
  expandedSkillRef,
  evidence,
  evidenceLoading,
  onToggleSkill,
}: {
  bands: SkillBand[];
  expandedSkillRef: string | null;
  evidence: Record<string, SkillEvidenceItem[]>;
  evidenceLoading: string | null;
  onToggleSkill: (skillRef: string) => void;
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
            <div key={band.skillRef} className="hf-attainment-skill-row">
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
        </div>
      ))}
    </div>
  );
}

// ── Modules section (SP4-C will deepen this) ────────────────────────────────

function ModulesSection({
  modules,
  useFreshMastery,
}: {
  modules: ModuleProgress[];
  useFreshMastery: boolean;
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
        Per-module rollup of LO mastery.
        {useFreshMastery
          ? " · Mock-exam: this course resets per session, so figures reflect long-term mastery only — not the current mock."
          : ""}
      </p>
      <div className="hf-attainment-module-rows">
        {modules.map((m) => {
          const pct = Math.round(m.mastery * 100);
          return (
            <div key={m.moduleId} className="hf-attainment-module-row">
              <div className="hf-attainment-module-title">{m.moduleTitle}</div>
              <div className="hf-attainment-module-bar">
                <div
                  className="hf-attainment-module-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="hf-attainment-module-meta">
                {pct}% · {m.status}
                {m.attemptsCount > 0 ? ` · ${m.attemptsCount} attempt(s)` : ""}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Goals section (SP4-D will deepen this) ──────────────────────────────────

function GoalsSection({ goals }: { goals: AttainmentGoal[] }) {
  if (goals.length === 0) {
    return (
      <section className="hf-attainment-section">
        <h3 className="hf-attainment-section-title">Goal progress</h3>
        <p className="hf-attainment-empty-text">
          No goals instantiated for this learner yet.
        </p>
      </section>
    );
  }
  return (
    <section className="hf-attainment-section">
      <h3 className="hf-attainment-section-title">Goal progress</h3>
      <p className="hf-attainment-section-desc">
        Per-goal progress with the strategy driving it.
      </p>
      <div className="hf-attainment-goal-rows">
        {goals.slice(0, 12).map((g) => {
          const pct = Math.round(g.progress * 100);
          return (
            <div key={g.id} className="hf-attainment-goal-row">
              <div className="hf-attainment-goal-meta">
                <span className="hf-attainment-goal-type">{g.type}</span>
                <span className="hf-attainment-goal-name">{g.name}</span>
                {g.strategy ? (
                  <span className="hf-attainment-goal-strategy">
                    {tierLabelForStrategy(g.strategy)}
                  </span>
                ) : null}
              </div>
              <div className="hf-attainment-goal-bar">
                <div
                  className="hf-attainment-goal-bar-fill"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="hf-attainment-goal-pct">{pct}%</div>
              {g.lastEvidence?.evidence ? (
                <div className="hf-attainment-goal-evidence">
                  <strong>Last:</strong> {g.lastEvidence.evidence}
                  {g.lastEvidence.tier
                    ? ` (${tierLabel(g.lastEvidence.tier.toLowerCase())})`
                    : ""}
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

function tierLabelForStrategy(strategy: string): string {
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
