"use client";

/**
 * SkillBandStripCard — Overview hero strip showing per-skill bands.
 *
 * Surfaces the IELTS-style 4-criterion measurement state at a glance:
 *   • One tile per skill_* CallerTarget with currentScore
 *   • BandChip rendering tier + band number via scoreToTier()
 *   • callsUsed count (transparent: "3 / 6" when Goodhart guard dropped some)
 *   • target band hint from CallerTarget.targetValue
 *
 * Reuses BandChip (#417 Story A) so per-playbook tier overrides (CEFR /
 * 5-level / custom) are honoured. Hides itself entirely when there are no
 * skill_* CallerTargets — non-skill-tracked playbooks see no empty card.
 *
 * Data flow:
 *   API /callers/[id] → data.callerTargets → filter parameterId LIKE skill_*
 *     → render BandChip (tier label + band number)
 *     + raw callsUsed badge
 *     + optional rubric-anchored description from Parameter.config.bandThresholds
 *
 * Issue: per-learner UI surfaces follow-up to #564 / #575 (the data is in
 * place but the educator dashboard didn't surface it yet).
 */

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
}

function prettyName(p: SkillTargetLite): string {
  const raw = p.parameter?.name ?? p.parameterId;
  // Skill parameter IDs are `skill_<slug>_<code>` — strip the prefix + code
  // for readable display when the name field is missing.
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

export function SkillBandStripCard({ callerTargets, tierMapping }: SkillBandStripCardProps) {
  const skillTargets = (callerTargets ?? []).filter(
    (t) => (t.parameterId || "").toLowerCase().startsWith("skill_") && typeof t.currentScore === "number",
  );
  if (skillTargets.length === 0) return null;

  const targetBand = (t: SkillTargetLite): number | null => {
    if (typeof t.targetValue !== "number") return null;
    const { band } = scoreToTier(t.targetValue, tierMapping);
    return band;
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
          return (
            <div key={t.parameterId} className="skill-band-tile">
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
            </div>
          );
        })}
      </div>
    </div>
  );
}
