/**
 * derive-skill-tier-mapping-from-source.ts — #1630
 *
 * Bridges the per-skill tier-scheme signal parsed from COURSE_REFERENCE
 * docs (`ParsedSkill.tierScheme`, written to `Parameter.config.tierScheme`
 * by the applier) up to the course-level `Playbook.config.skillTierMapping`
 * shape consumed by `BandingPicker.tsx` and `scoreToTier()`.
 *
 * Pure function — no DB, no AI. Caller decides whether to write.
 *
 * Decision contract (set by TL review on #1630):
 *  - Q1 — runs inside `runProjectionForPlaybook` after the main + rubric
 *    passes, on the union of parsed skills across all sources.
 *  - Q2 — advisory-null when skills disagree on tier scheme (a course with
 *    3 CTO skills + 2 CEFR skills produces no derivation; operator decides).
 *  - Q3 — cascade-gated at the call site (this helper doesn't read the
 *    cascade). Caller MUST verify `resolveMasteryPolicyKnob` source is
 *    SYSTEM before writing; Domain-pinned and Playbook-pinned mappings
 *    are respected.
 *  - Q4 — null-only seed at the call site (this helper has no notion of
 *    "current value"; the cascade gate handles it via the Playbook layer
 *    check in (Q3)).
 *
 * Today the function maps two recognised schemes:
 *  - `cto` (foundation / developing / practitioner / distinction) →
 *    new mapping with CTO labels + equal-quartile thresholds + bands 1–4.
 *  - `cefr` (a1 / a2 / b1 / b2 / c1 / c2) → existing CEFR preset
 *    (A2 / B1 / B2 / C1 → bands 2 / 3 / 4 / 5), so the BandingPicker
 *    auto-detects `cefr` via `detectPresetId()`.
 *
 * `three` (emerging / developing / secure) and unrecognised schemes
 * return null — the IELTS default still serves 3-tier courses and an
 * unknown scheme is operator territory.
 */

import { KNOWN_TIER_SCHEMES, type ParsedSkill } from "@/lib/wizard/project-course-reference";
import type { SkillTierMapping } from "@/lib/goals/track-progress";
import { TIER_PRESETS } from "./presets";

export interface DerivedSkillTierMapping {
  mapping: SkillTierMapping;
  tierLabels: {
    approachingEmerging: string;
    emerging: string;
    developing: string;
    secure: string;
  };
  /** Which known scheme produced the mapping. Used in log lines + UI hints. */
  derivedFromScheme: "cto" | "cefr";
}

export function deriveSkillTierMappingFromSkills(
  skills: readonly ParsedSkill[],
): DerivedSkillTierMapping | null {
  if (skills.length === 0) return null;

  const schemes = new Set<string | null>();
  for (const skill of skills) {
    schemes.add(matchKnownScheme(skill.tierScheme));
  }

  if (schemes.size !== 1) return null;
  const [name] = [...schemes];
  if (name === null) return null;

  if (name === "cto") {
    return {
      mapping: TIER_PRESETS["5-level"].mapping,
      tierLabels: {
        approachingEmerging: "Foundation",
        emerging: "Developing",
        developing: "Practitioner",
        secure: "Distinction",
      },
      derivedFromScheme: "cto",
    };
  }

  if (name === "cefr") {
    return {
      mapping: TIER_PRESETS["cefr"].mapping,
      tierLabels: TIER_PRESETS["cefr"].tierLabels!,
      derivedFromScheme: "cefr",
    };
  }

  return null;
}

function matchKnownScheme(scheme: readonly string[]): string | null {
  for (const [name, known] of Object.entries(KNOWN_TIER_SCHEMES)) {
    if (known.length !== scheme.length) continue;
    if (known.every((t, i) => t === scheme[i])) return name;
  }
  return null;
}
