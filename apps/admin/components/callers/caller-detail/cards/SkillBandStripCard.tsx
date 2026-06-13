"use client";

// WILL_RETIRE — covered by Attainment (SP4-A/C/D): see docs/retirement-audit/attainment-sp4e.md

/**
 * SkillBandStripCard — Overview hero strip showing per-skill bands.
 *
 * Surfaces the IELTS-style 4-criterion measurement state at a glance:
 *   • One tile per skill_* CallerTarget with currentScore
 *   • BandChip rendering tier + band number via scoreToTier()
 *   • callsUsed count (transparent: "3 / 6" when Goodhart guard dropped some)
 *   • target band hint from CallerTarget.targetValue
 *
 * Click a tile → expands an inline detail panel below the strip showing:
 *   • Current band's descriptor text (from Parameter.config.bandThresholds, #564)
 *   • Next band's descriptor (the gap — what the learner needs to demonstrate)
 *   • Target band descriptor for context
 *   • Mini score history sparkline across recent calls
 *
 * Reuses BandChip (#417 Story A) so per-playbook tier overrides (CEFR /
 * 5-level / custom) are honoured. Hides itself entirely when there are no
 * skill_* CallerTargets — non-skill-tracked playbooks see no empty card.
 *
 * Issue: per-learner UI surfaces follow-up to #564 / #575.
 */

import { useState } from "react";
import { BandChip } from "@/components/shared/BandChip";
import { scoreToTier, type SkillTierMapping } from "@/lib/goals/track-progress";

interface SkillTargetLite {
  parameterId: string;
  currentScore: number | null;
  targetValue: number | null;
  callsUsed: number | null;
  lastScoredAt?: string | Date | null;
  parameter?: {
    parameterId?: string;
    name?: string | null;
    config?: { bandThresholds?: Record<string, string> } | Record<string, unknown> | null;
  } | null;
}

interface SkillBandStripCardProps {
  callerTargets: SkillTargetLite[];
  tierMapping?: SkillTierMapping;
  /**
   * Optional caller-wide CallScore rows. When provided, the detail
   * drawer renders a mini history strip per skill so the educator can
   * see the running trajectory rather than only the EMA endpoint.
   */
  callScores?: Array<{ parameterId: string; score: number; scoredAt?: string | Date; createdAt?: string | Date }>;
}

function prettyName(p: SkillTargetLite): string {
  const raw = p.parameter?.name ?? p.parameterId;
  const idTail = (p.parameterId || "")
    .replace(/^skill_/i, "")
    .replace(/_(fc|lr|gra|p|a1|a2|b1|b2|c1|c2|band\d+)$/i, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
  return raw && !/^skill_/i.test(raw) ? raw : idTail || raw || p.parameterId;
}

function skillSuffix(parameterId: string): string {
  const m = parameterId.match(/_([a-z0-9]+)$/i);
  return m ? m[1].toUpperCase() : "";
}

function getBandThresholds(t: SkillTargetLite): Record<string, string> | null {
  const cfg = t.parameter?.config;
  if (!cfg || typeof cfg !== "object") return null;
  const bt = (cfg as Record<string, unknown>).bandThresholds;
  if (!bt || typeof bt !== "object") return null;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(bt as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Sorted band keys, descending. Handles decimal band numbers. */
function sortedBandKeys(bands: Record<string, string>): string[] {
  return Object.keys(bands)
    .map((k) => ({ k, n: parseFloat(k) }))
    .filter((e) => !Number.isNaN(e.n))
    .sort((a, b) => b.n - a.n)
    .map((e) => e.k);
}

function findNeighbouringBand(
  bands: Record<string, string>,
  currentBand: number,
  direction: "up" | "down",
): { key: string; band: number; descriptor: string } | null {
  const keys = sortedBandKeys(bands);
  if (keys.length === 0) return null;
  if (direction === "up") {
    // Ascending order — first band greater than current.
    for (let i = keys.length - 1; i >= 0; i--) {
      const n = parseFloat(keys[i]);
      if (n > currentBand) return { key: keys[i], band: n, descriptor: bands[keys[i]] };
    }
  } else {
    // Descending order — first band less than current.
    for (const k of keys) {
      const n = parseFloat(k);
      if (n < currentBand) return { key: k, band: n, descriptor: bands[k] };
    }
  }
  return null;
}

function findExactBand(bands: Record<string, string>, target: number): { key: string; band: number; descriptor: string } | null {
  // Round to nearest whole + look up; fall back to descending search.
  const rounded = Math.round(target).toString();
  if (bands[rounded]) return { key: rounded, band: parseFloat(rounded), descriptor: bands[rounded] };
  let best: { key: string; band: number; descriptor: string } | null = null;
  let bestDist = Infinity;
  for (const k of Object.keys(bands)) {
    const n = parseFloat(k);
    if (Number.isNaN(n)) continue;
    const d = Math.abs(n - target);
    if (d < bestDist) {
      bestDist = d;
      best = { key: k, band: n, descriptor: bands[k] };
    }
  }
  return best;
}

export function SkillBandStripCard({ callerTargets, tierMapping, callScores }: SkillBandStripCardProps) {
  const [expandedParam, setExpandedParam] = useState<string | null>(null);

  const skillTargets = (callerTargets ?? []).filter(
    (t) => (t.parameterId || "").toLowerCase().startsWith("skill_") && typeof t.currentScore === "number",
  );
  if (skillTargets.length === 0) return null;

  const targetBand = (t: SkillTargetLite): number | null => {
    if (typeof t.targetValue !== "number") return null;
    const { band } = scoreToTier(t.targetValue, tierMapping);
    return band;
  };

  const historyFor = (parameterId: string): number[] => {
    if (!callScores) return [];
    return callScores
      .filter((s) => s.parameterId === parameterId)
      .sort((a, b) => {
        const da = new Date(a.scoredAt ?? a.createdAt ?? 0).getTime();
        const db = new Date(b.scoredAt ?? b.createdAt ?? 0).getTime();
        return da - db;
      })
      .map((s) => s.score);
  };

  return (
    <div className="hf-card">
      <div className="hf-section-title">Skill bands</div>
      <div className="hf-section-desc">
        Where this learner sits today on each measured criterion. Click a tile
        to see the band descriptor and recent calls feeding the score.
      </div>
      <div className="skill-band-strip">
        {skillTargets.map((t) => {
          const suffix = skillSuffix(t.parameterId);
          const calls = t.callsUsed ?? 0;
          const tBand = targetBand(t);
          const isExpanded = expandedParam === t.parameterId;
          return (
            <button
              key={t.parameterId}
              type="button"
              className={`skill-band-tile${isExpanded ? " skill-band-tile--expanded" : ""}`}
              onClick={() => setExpandedParam(isExpanded ? null : t.parameterId)}
              aria-expanded={isExpanded}
              aria-label={`${prettyName(t)} band detail`}
            >
              <div className="skill-band-tile-header">
                <span className="skill-band-tile-name">{prettyName(t)}</span>
                {suffix && (
                  <span className="skill-band-tile-suffix" aria-hidden>
                    {suffix}
                  </span>
                )}
              </div>
              <div className="skill-band-tile-chip">
                <BandChip score={t.currentScore ?? 0} mapping={tierMapping} />
              </div>
              <div className="skill-band-tile-meta">
                <span title="Calls feeding the EMA — dropped scores excluded">
                  {calls} {calls === 1 ? "call" : "calls"}
                </span>
                {tBand !== null && (
                  <span className="skill-band-tile-target" title="Target band on this playbook">
                    → Band {tBand}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {expandedParam &&
        (() => {
          const t = skillTargets.find((x) => x.parameterId === expandedParam);
          if (!t) return null;
          const bands = getBandThresholds(t);
          const currentBandNum = scoreToTier(t.currentScore ?? 0, tierMapping).band;
          const tBand = targetBand(t);
          const current = bands ? findExactBand(bands, currentBandNum) : null;
          const next = bands ? findNeighbouringBand(bands, currentBandNum, "up") : null;
          const target = bands && tBand !== null ? findExactBand(bands, tBand) : null;
          const history = historyFor(t.parameterId);
          return (
            <div className="skill-band-detail">
              <div className="skill-band-detail-header">
                <h4 className="skill-band-detail-title">
                  {prettyName(t)}
                  {skillSuffix(t.parameterId) && (
                    <span className="skill-band-tile-suffix"> {skillSuffix(t.parameterId)}</span>
                  )}
                </h4>
                <button
                  type="button"
                  className="hf-btn hf-btn-secondary skill-band-detail-close"
                  onClick={() => setExpandedParam(null)}
                  aria-label="Close detail"
                >
                  ×
                </button>
              </div>
              <div className="skill-band-detail-summary">
                <div>
                  <span className="skill-band-detail-label">Currently</span>
                  <BandChip score={t.currentScore ?? 0} mapping={tierMapping} />
                </div>
                {tBand !== null && (
                  <div>
                    <span className="skill-band-detail-label">Target</span>
                    <span className="skill-band-detail-targetval">Band {tBand}</span>
                  </div>
                )}
                <div>
                  <span className="skill-band-detail-label">Evidence</span>
                  <span className="skill-band-detail-targetval">
                    {t.callsUsed ?? 0} call{(t.callsUsed ?? 0) === 1 ? "" : "s"}
                  </span>
                </div>
              </div>

              {bands ? (
                <div className="skill-band-detail-grid">
                  {current && (
                    <div className="skill-band-detail-row skill-band-detail-row--current">
                      <div className="skill-band-detail-row-head">
                        <span className="skill-band-detail-row-label">Band {current.key} (current)</span>
                      </div>
                      <p className="skill-band-detail-row-text">{current.descriptor}</p>
                    </div>
                  )}
                  {next && (
                    <div className="skill-band-detail-row">
                      <div className="skill-band-detail-row-head">
                        <span className="skill-band-detail-row-label">Band {next.key} (next step)</span>
                      </div>
                      <p className="skill-band-detail-row-text">{next.descriptor}</p>
                    </div>
                  )}
                  {target && target.key !== current?.key && target.key !== next?.key && (
                    <div className="skill-band-detail-row skill-band-detail-row--target">
                      <div className="skill-band-detail-row-head">
                        <span className="skill-band-detail-row-label">Band {target.key} (target)</span>
                      </div>
                      <p className="skill-band-detail-row-text">{target.descriptor}</p>
                    </div>
                  )}
                </div>
              ) : (
                <p className="hf-text-muted hf-text-sm skill-band-detail-empty">
                  No band rubric attached to this skill yet. Upload an{" "}
                  <code>assessor-rubric.md</code> following the{" "}
                  <code>## RUB-{skillSuffix(t.parameterId) || "&lt;CODE&gt;"}:</code> template — see the
                  course-reference template docs.
                </p>
              )}

              {history.length > 1 && (
                <div className="skill-band-detail-history">
                  <span className="skill-band-detail-label">
                    Recent {history.length} call{history.length === 1 ? "" : "s"}
                  </span>
                  <div className="skill-band-detail-history-strip" aria-hidden>
                    {history.map((s, i) => (
                      <span
                        key={i}
                        className="skill-band-detail-history-dot"
                        style={{ height: `${Math.max(8, Math.round(s * 40))}px` }}
                        title={`Call ${i + 1}: ${(s * 100).toFixed(0)}%`}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
    </div>
  );
}
