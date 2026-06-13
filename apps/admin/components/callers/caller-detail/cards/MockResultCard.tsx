"use client";

// WILL_RETIRE — covered by Attainment (SP4-A/C/D): see docs/retirement-audit/attainment-sp4e.md

/**
 * MockResultCard — surfaces Mock exam results on the Caller overview.
 *
 * Mock calls (e.g. IELTS Full Mock) are the canonical assessment moment
 * but get treated like any other call in the existing UI. This card
 * dedicates a panel to the most recent Mock with:
 *   • Overall per-skill bands from the Mock call's CallScore rows
 *   • Per-Part sub-module breakdown via Mock's `coversModules` fan-out
 *     (#491 Slice 1.5) — each Mock CallScore carries a `moduleId`
 *     pointing to the sub-module the segment was scored against
 *   • Comparison to the previous Mock (if any), showing per-skill delta
 *
 * Hides itself when the caller has zero Mock calls — non-Mock playbooks
 * (or pre-Mock IELTS learners) see nothing.
 *
 * Issue: per-learner UI follow-up to #491 + #564 + #575.
 */

import { BandChip } from "@/components/shared/BandChip";
import { scoreToTier, type SkillTierMapping } from "@/lib/goals/track-progress";

type CallLite = {
  id: string;
  createdAt?: string | Date;
  endedAt?: string | Date | null;
  callSequence?: number | null;
  requestedModuleId?: string | null;
  curriculumModuleId?: string | null;
  curriculumModule?: { slug?: string | null; coversModules?: string[] | null } | null;
};

type ScoreLite = {
  callId: string;
  parameterId: string;
  score: number;
  moduleId?: string | null;
  parameter?: { parameterId?: string; name?: string | null } | null;
  curriculumModule?: { id?: string; slug?: string | null; title?: string | null } | null;
};

interface MockResultCardProps {
  calls: CallLite[];
  scores: ScoreLite[];
  tierMapping?: SkillTierMapping;
}

function isMockCall(c: CallLite): boolean {
  if (c.requestedModuleId === "mock") return true;
  const slug = c.curriculumModule?.slug?.toLowerCase();
  if (slug === "mock") return true;
  const covers = c.curriculumModule?.coversModules ?? [];
  return Array.isArray(covers) && covers.length > 0;
}

function isSkillScore(s: ScoreLite): boolean {
  const id = (s.parameter?.parameterId ?? s.parameterId ?? "").toLowerCase();
  return id.startsWith("skill_");
}

function skillSuffix(parameterId: string): string {
  const m = parameterId.match(/_([a-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : "";
}

function skillName(parameterId: string): string {
  return parameterId
    .replace(/^skill_/i, "")
    .replace(/_(fc|lr|gra|p|a1|a2|b1|b2|c1|c2|band\d+)$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

export function MockResultCard({ calls, scores, tierMapping }: MockResultCardProps) {
  const mockCalls = (calls ?? [])
    .filter(isMockCall)
    .sort((a, b) => {
      const da = new Date(a.endedAt ?? a.createdAt ?? 0).getTime();
      const db = new Date(b.endedAt ?? b.createdAt ?? 0).getTime();
      return db - da;
    });
  if (mockCalls.length === 0) return null;

  const latest = mockCalls[0];
  const previous = mockCalls[1] ?? null;

  const skillScoresFor = (callId: string) =>
    (scores ?? []).filter((s) => s.callId === callId && isSkillScore(s));

  const latestSkillScores = skillScoresFor(latest.id);
  const previousSkillScores = previous ? skillScoresFor(previous.id) : [];

  // Group latest call's skill scores by parameterId.
  // Each skill may appear MULTIPLE times if the Mock fan-out (#491) wrote
  // per-sub-module rows — we average them for the overall reading and
  // also keep the per-module list for the breakdown.
  const grouped = new Map<string, { overall: number[]; perModule: Array<{ moduleSlug: string; score: number }> }>();
  for (const s of latestSkillScores) {
    const key = s.parameter?.parameterId ?? s.parameterId;
    const entry = grouped.get(key) ?? { overall: [], perModule: [] };
    entry.overall.push(s.score);
    const moduleSlug = s.curriculumModule?.slug ?? (s.moduleId ? "—" : "mock");
    if (moduleSlug && moduleSlug !== "mock") {
      entry.perModule.push({ moduleSlug, score: s.score });
    }
    grouped.set(key, entry);
  }

  if (grouped.size === 0) return null;

  const prevAvg = new Map<string, number>();
  for (const s of previousSkillScores) {
    const key = s.parameter?.parameterId ?? s.parameterId;
    const list = prevAvg.get(key) ?? 0;
    prevAvg.set(key, list + s.score);
  }
  // Average prior values (collected as running sum above — convert).
  const prevCounts = new Map<string, number>();
  for (const s of previousSkillScores) {
    const key = s.parameter?.parameterId ?? s.parameterId;
    prevCounts.set(key, (prevCounts.get(key) ?? 0) + 1);
  }
  for (const [k, sum] of prevAvg) {
    const c = prevCounts.get(k) ?? 1;
    prevAvg.set(k, sum / c);
  }

  const mean = (arr: number[]) => (arr.length === 0 ? 0 : arr.reduce((a, b) => a + b, 0) / arr.length);
  const mockDate = latest.endedAt
    ? new Date(latest.endedAt).toLocaleDateString()
    : latest.createdAt
      ? new Date(latest.createdAt).toLocaleDateString()
      : "—";

  // Distinct sub-modules present in the per-module breakdown across all skills.
  const subModules = Array.from(
    new Set(
      Array.from(grouped.values())
        .flatMap((g) => g.perModule.map((p) => p.moduleSlug))
        .filter((s) => s && s !== "mock"),
    ),
  ).sort();

  return (
    <div className="hf-card">
      <div className="mock-result-header">
        <div>
          <div className="hf-section-title">Latest Mock result</div>
          <div className="hf-section-desc">
            Call #{latest.callSequence ?? "?"} · {mockDate}
            {mockCalls.length > 1 && ` · mock #${mockCalls.length} of ${mockCalls.length}`}
          </div>
        </div>
      </div>

      {/* Overall per-skill bands across the mock */}
      <div className="mock-result-skills">
        {Array.from(grouped.entries()).map(([parameterId, entry]) => {
          const overall = mean(entry.overall);
          const prior = prevAvg.get(parameterId);
          const delta = typeof prior === "number" ? overall - prior : null;
          return (
            <div key={parameterId} className="mock-result-skill">
              <div className="mock-result-skill-head">
                <span className="mock-result-skill-name">{skillName(parameterId)}</span>
                {skillSuffix(parameterId) && (
                  <span className="skill-band-tile-suffix" aria-hidden>
                    {skillSuffix(parameterId)}
                  </span>
                )}
              </div>
              <BandChip score={overall} mapping={tierMapping} />
              {delta !== null && (
                <span
                  className={`mock-result-delta${delta > 0.02 ? " mock-result-delta--up" : delta < -0.02 ? " mock-result-delta--down" : ""}`}
                  title={`Previous mock: Band ${scoreToTier(prior ?? 0, tierMapping).band}`}
                >
                  {delta > 0 ? "+" : ""}
                  {(delta * 100).toFixed(0)}pp vs last mock
                </span>
              )}
            </div>
          );
        })}
      </div>

      {/* Per-Part sub-module breakdown — only when fan-out fired */}
      {subModules.length > 0 && (
        <div className="mock-result-breakdown">
          <div className="hf-section-title hf-text-sm">Per-Part breakdown</div>
          <div className="mock-result-grid">
            <div className="mock-result-grid-head">
              <span>Skill</span>
              {subModules.map((m) => (
                <span key={m}>{m}</span>
              ))}
            </div>
            {Array.from(grouped.entries()).map(([parameterId, entry]) => (
              <div key={parameterId} className="mock-result-grid-row">
                <span className="mock-result-grid-skill">
                  {skillName(parameterId)}{" "}
                  {skillSuffix(parameterId) && (
                    <span className="skill-band-tile-suffix">{skillSuffix(parameterId)}</span>
                  )}
                </span>
                {subModules.map((m) => {
                  const row = entry.perModule.find((p) => p.moduleSlug === m);
                  if (!row) {
                    return (
                      <span key={m} className="mock-result-grid-cell mock-result-grid-cell--empty">
                        —
                      </span>
                    );
                  }
                  return (
                    <span key={m} className="mock-result-grid-cell">
                      <BandChip score={row.score} mapping={tierMapping} size="compact" />
                    </span>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
