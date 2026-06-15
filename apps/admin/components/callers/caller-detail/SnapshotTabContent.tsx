"use client";

/**
 * SnapshotTabContent — #1660 (Group C foundation of Epic #1606).
 *
 * Replaces the S5 placeholder card at `CallerDetailPage.tsx:1163-1173`.
 * Composes the v3 caller-detail Snapshot tab from 5 sections:
 *
 *   1. Header — trajectory sparklines (`LearningTrajectoryCard`)
 *   2. "Who we think they are" — personality (A.7 fills the stub)
 *   3. Skill Bands summary (from `/api/callers/[id]/attainment`)
 *   4. LO heatmap slot (#1661 mounts the real component here)
 *   5. "Why this call?" summary (#1663 fills the stub)
 *   6. Goals + evidence trail (from same `/attainment` response)
 *   7. Carry-over actions slot (A.9 fills the stub)
 *
 * Decision 4 (#1660 AC): cold load = 4 parallel fetches via `Promise.all`.
 * Heatmap (#1661) and personality (#1665) handle their own fetches when
 * they replace the slots. Sub-skills (#1662) and scheduler-decision
 * (#1663) routes don't exist yet — the fetches degrade silently on 404
 * so the foundation ships ahead of the sibling stories.
 *
 * Decision 4 follow-on trigger: if module count > 12, switch the heatmap
 * to viewport-lazy via IntersectionObserver. Below the foundation's
 * concern — only #1661 implementation needs to act on it.
 *
 * STUDENT scope: every underlying route (attainment, skills-evidence)
 * already gates via `studentAllowedToReadCaller`. Sub-skills + scheduler
 * routes inherit the same pattern when they ship.
 */

import { useEffect, useState } from "react";

import { LearningTrajectoryCard } from "./cards/LearningTrajectoryCard";
import { SnapshotLoHeatmap } from "./SnapshotLoHeatmap";
import { SnapshotCarryOverActions } from "./SnapshotCarryOverActions";
import { SnapshotSubSkills } from "./SnapshotSubSkills";
import { SnapshotWhyThisCall } from "./SnapshotWhyThisCall";
import { SnapshotPersonalityBlock } from "./SnapshotPersonalityBlock";
import { SnapshotMemoryBlock } from "./SnapshotMemoryBlock";
import { SnapshotEnrollmentBlock } from "./SnapshotEnrollmentBlock";
import { SnapshotInsightsBlock } from "./SnapshotInsightsBlock";
import { SnapshotHeroBlock } from "./SnapshotHeroBlock";
import { SnapshotEngagementBlock } from "./SnapshotEngagementBlock";
import { SnapshotMockResultsBlock } from "./SnapshotMockResultsBlock";
import { SnapshotRecentCallsBlock } from "./SnapshotRecentCallsBlock";

import "./snapshot-tab.css";

interface SnapshotTabContentProps {
  callerId: string;
  /**
   * Caller's domainId — needed by SnapshotEnrollmentBlock to power the
   * "Enroll in another course" picker. Passed down from CallerDetailPage
   * where the caller record is already loaded. Optional/null so Snapshot
   * still renders if the caller has no domain assigned (rare).
   */
  domainId?: string | null;
}

interface AttainmentSkillBand {
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

interface AttainmentGoal {
  id: string;
  type: string;
  name: string;
  description: string | null;
  progress: number;
  trail: {
    excerpts: string[];
    totalCount: number;
    extractionMethod: "EXPLICIT" | "INFERRED" | null;
    sourceCallId: string | null;
  } | null;
}

interface AttainmentResponse {
  callerId: string;
  callerName: string | null;
  playbookId: string | null;
  playbookName: string | null;
  useFreshMastery: boolean;
  skillBands: AttainmentSkillBand[];
  modules: Array<{ id: string; slug: string; title: string }>;
  goals: AttainmentGoal[];
  empty: boolean;
}

interface SkillsEvidenceEntry {
  skillRef: string;
  excerpts: Array<{ excerpt: string; callId: string | null; at: string | null }>;
}

interface SkillsEvidenceResponse {
  callerId: string;
  evidence: SkillsEvidenceEntry[];
}

export function SnapshotTabContent({ callerId, domainId }: SnapshotTabContentProps) {
  const [attainment, setAttainment] = useState<AttainmentResponse | null>(null);
  const [skillsEvidence, setSkillsEvidence] = useState<SkillsEvidenceResponse | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    // Foundation fires 2 parallel fetches; each sibling slot component
    // (SnapshotSubSkills #1662, SnapshotCarryOverActions #1666,
    // SnapshotWhyThisCall #1663) owns its own fetch.
    const tasks: Promise<unknown>[] = [
      fetch(`/api/callers/${callerId}/attainment`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: AttainmentResponse | null) => {
          if (!cancelled) setAttainment(j);
        })
        .catch(() => {
          if (!cancelled) setError("Failed to load attainment");
        }),
      fetch(`/api/callers/${callerId}/skills-evidence`)
        .then((r) => (r.ok ? r.json() : null))
        .then((j: SkillsEvidenceResponse | null) => {
          if (!cancelled) setSkillsEvidence(j);
        })
        .catch(() => {}),
    ];

    Promise.all(tasks).catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [callerId]);

  if (error) {
    return (
      <div className="hf-card" role="alert">
        <h2 className="hf-section-title">Snapshot</h2>
        <p className="hf-section-desc">{error}</p>
      </div>
    );
  }

  return (
    <div className="hf-snapshot" data-testid="hf-snapshot-tab">
      <section className="hf-snapshot-section hf-snapshot-header">
        <LearningTrajectoryCard callerId={callerId} />
      </section>

      {/* Wave C1 — Hero proof points (Mastery + Confidence + Knowledge
       * donuts with pre/post markers + Calls + Days-active StatTiles +
       * mastery micro-sparkline) lifted from Uplift v2 HeroSection so
       * the uplift-v2 tab can retire without losing the headline
       * deltas. Sits at the top so the operator sees the donuts first. */}
      <SnapshotHeroBlock callerId={callerId} />

      {/* Wave B — computed signals (Momentum + Achievements +
       * Focus areas) lifted from OverviewV2Tab's At-a-Glance card,
       * Achievements card, and FocusAreas card. Sits high so the
       * operator gets the "what shape is this learner in right now"
       * signal before scrolling. */}
      <SnapshotInsightsBlock callerId={callerId} />

      {/* Wave C1 — Recent calls TimelineRibbon (last 5 calls with
       * click-through) lifted from overview-v2's RecentCallsV2 so the
       * at-a-glance call history survives the legacy-tab retirement. */}
      <SnapshotRecentCallsBlock callerId={callerId} />

      {/* Wave C1 — Mock results card (latest Mock score donut + delta
       * vs prior Mock). Self-hides for callers with no Mock calls. */}
      <SnapshotMockResultsBlock callerId={callerId} />

      <SnapshotPersonalityBlock callerId={callerId} />

      <SnapshotSkillBandsSection
        skillBands={
          attainment === null
            ? null
            : Array.isArray(attainment.skillBands)
              ? attainment.skillBands
              : []
        }
        evidence={skillsEvidence?.evidence ?? null}
      />

      <SnapshotSubSkills callerId={callerId} />

      {/* #1661 — real LO heatmap replaces the placeholder slot. The
       * heatmap owns its per-module lo-mastery fetches; the foundation
       * here just hands it the modules list + useFreshMastery flag from
       * the already-fetched attainment response. */}
      <SnapshotLoHeatmap
        callerId={callerId}
        modules={
          Array.isArray(attainment?.modules) ? (attainment?.modules ?? []) : []
        }
        useFreshMastery={attainment?.useFreshMastery ?? false}
      />

      <SnapshotWhyThisCall callerId={callerId} />

      <SnapshotGoalsSection
        goals={
          attainment === null
            ? null
            : Array.isArray(attainment.goals)
              ? attainment.goals
              : []
        }
      />

      <SnapshotCarryOverActions callerId={callerId} />

      {/* Wave A1 — Profile-fold-in. Memories + Enrollments live here
       * now so ProfileTab can retire without operator workflow loss.
       * Placed after the call-flow sections (Skill / Heatmap / Goals
       * / Actions) so the operator-state sections sit higher; these
       * two are caller-administrative and natural to scroll down to. */}
      <SnapshotMemoryBlock callerId={callerId} />

      {/* Wave C1 — Engagement (memories slice donut + Calls/week
       * StatTile + 14-day CalendarStrip) lifted from Uplift v2
       * EngagementSection. Sits next to MemoryBlock since both surface
       * memory + cadence signals. */}
      <SnapshotEngagementBlock callerId={callerId} />

      <SnapshotEnrollmentBlock callerId={callerId} domainId={domainId} />
    </div>
  );
}

// =============================================================
// Real sections — render now (foundation ships them)
// =============================================================

function SnapshotSkillBandsSection({
  skillBands,
  evidence: _evidence,
}: {
  skillBands: AttainmentSkillBand[] | null;
  evidence: SkillsEvidenceEntry[] | null;
}) {
  if (skillBands === null) {
    return (
      <section className="hf-snapshot-section">
        <div className="hf-card-compact">
          <div className="hf-category-label">Skill bands</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }
  if (skillBands.length === 0) {
    return (
      <section className="hf-snapshot-section">
        <div className="hf-card-compact">
          <div className="hf-category-label">Skill bands</div>
          <span className="hf-badge hf-badge-muted">No skills tracked yet</span>
        </div>
      </section>
    );
  }
  return (
    <section className="hf-snapshot-section" data-testid="hf-snapshot-skill-bands">
      <div className="hf-card-compact">
        <div className="hf-category-label">
          Skill bands — {skillBands.length} tracked
        </div>
        <ul className="hf-list-row">
          {skillBands.map((band) => (
            <li key={band.parameterId}>
              <strong>{band.parameterName}</strong>{" "}
              <span className="hf-badge hf-badge-info">{band.tier}</span>
              {band.exceedsTarget && (
                <span className="hf-badge hf-badge-success" style={{ marginLeft: 4 }}>
                  exceeds target
                </span>
              )}
              {band.currentScore === null && (
                <span className="hf-badge hf-badge-muted" style={{ marginLeft: 4 }}>
                  awaiting evidence
                </span>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function SnapshotGoalsSection({ goals }: { goals: AttainmentGoal[] | null }) {
  if (goals === null) {
    return (
      <section className="hf-snapshot-section">
        <div className="hf-card-compact">
          <div className="hf-category-label">Goals</div>
          <span className="hf-badge hf-badge-muted">Loading…</span>
        </div>
      </section>
    );
  }
  if (goals.length === 0) {
    return (
      <section className="hf-snapshot-section">
        <div className="hf-card-compact">
          <div className="hf-category-label">Goals</div>
          <span className="hf-badge hf-badge-muted">No active goals</span>
        </div>
      </section>
    );
  }
  return (
    <section className="hf-snapshot-section" data-testid="hf-snapshot-goals">
      <div className="hf-card-compact">
        <div className="hf-category-label">Goals — {goals.length} active</div>
        <ul className="hf-list-row">
          {goals.map((goal) => (
            <li key={goal.id}>
              <span className="hf-badge hf-badge-info">{goal.type}</span>{" "}
              <strong>{goal.name}</strong>{" "}
              <span className="hf-text-sm hf-text-muted">
                {Math.round((goal.progress ?? 0) * 100)}%
              </span>
              {goal.trail && goal.trail.totalCount > 0 && (
                <div className="hf-text-sm hf-text-muted">
                  Last evidence ({goal.trail.extractionMethod}):{" "}
                  {goal.trail.excerpts[0]}
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
