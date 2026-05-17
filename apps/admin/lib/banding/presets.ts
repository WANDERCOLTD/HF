/**
 * Per-playbook tier-mapping presets (#417 / Story C).
 *
 * Three presets out of the box plus a "custom" escape hatch. The shape
 * matches `SkillTierMapping` from `lib/goals/track-progress.ts` so
 * `scoreToTier()` consumes them directly.
 *
 * Selection mechanism (highest precedence first):
 *   1. `Playbook.config.skillTierMapping` (full mapping override)
 *   2. `SKILL_MEASURE_V1` contract thresholds / tierBands
 *   3. Built-in defaults inside `scoreToTier`
 */
import type { SkillTierMapping } from "@/lib/goals/track-progress";

export type TierPresetId = "ielts-speaking" | "cefr" | "5-level" | "custom";

export interface TierPreset {
  id: TierPresetId;
  label: string;
  description: string;
  /**
   * The mapping itself. NOTE: `scoreToTier` uses 4 tiers in fixed slots
   * (`approachingEmerging` / `emerging` / `developing` / `secure`).
   * Custom band labels surface via `tierLabels` (consumer UI override),
   * but the threshold slots stay the same. CEFR / 5-Level map their
   * native labels onto these 4 slots.
   */
  mapping: SkillTierMapping;
  /**
   * Optional override of the visible tier names so a CEFR course says
   * "B1" not "Developing". Consumers (BandChip etc.) check this before
   * falling back to the default tier names.
   */
  tierLabels?: {
    approachingEmerging: string;
    emerging: string;
    developing: string;
    secure: string;
  };
}

export const TIER_PRESETS: Record<TierPresetId, TierPreset> = {
  "ielts-speaking": {
    id: "ielts-speaking",
    label: "IELTS Speaking",
    description:
      "Default IELTS Speaking criterion banding (Approaching Emerging / Emerging / Developing / Secure mapping to bands 3 / 4 / 5.5 / 7).",
    mapping: {
      thresholds: {
        approachingEmerging: 0.3,
        emerging: 0.55,
        developing: 0.7,
        secure: 1.0,
      },
      tierBands: {
        approachingEmerging: 3,
        emerging: 4,
        developing: 5.5,
        secure: 7,
      },
    },
  },
  cefr: {
    id: "cefr",
    label: "CEFR (A1 → C2)",
    description:
      "Council of Europe language framework, six levels collapsed onto four tier slots. A2 → B1 → B2 → C1 (custom-mapped — adjust to taste).",
    mapping: {
      thresholds: {
        approachingEmerging: 0.25,
        emerging: 0.5,
        developing: 0.75,
        secure: 1.0,
      },
      tierBands: {
        approachingEmerging: 2,
        emerging: 3,
        developing: 4,
        secure: 5,
      },
    },
    tierLabels: {
      approachingEmerging: "A2",
      emerging: "B1",
      developing: "B2",
      secure: "C1",
    },
  },
  "5-level": {
    id: "5-level",
    label: "5-Level (Novice → Expert)",
    description:
      "Generic 5-level scale collapsed onto the 4-tier banding model. Suits coaching / professional-skill courses without external accreditation.",
    mapping: {
      thresholds: {
        approachingEmerging: 0.25,
        emerging: 0.5,
        developing: 0.75,
        secure: 1.0,
      },
      tierBands: {
        approachingEmerging: 1,
        emerging: 2,
        developing: 3,
        secure: 4,
      },
    },
    tierLabels: {
      approachingEmerging: "Novice",
      emerging: "Beginner",
      developing: "Intermediate",
      secure: "Advanced",
    },
  },
  custom: {
    id: "custom",
    label: "Custom",
    description:
      "Educator-defined thresholds + band numbers + tier labels. Set via `Playbook.config.skillTierMapping`.",
    mapping: {
      thresholds: {
        approachingEmerging: 0.3,
        emerging: 0.55,
        developing: 0.7,
        secure: 1.0,
      },
      tierBands: {
        approachingEmerging: 3,
        emerging: 4,
        developing: 5.5,
        secure: 7,
      },
    },
  },
};

/** Resolve a preset by id; defaults to IELTS Speaking if no match. */
export function getPreset(id: TierPresetId | string | undefined | null): TierPreset {
  if (!id) return TIER_PRESETS["ielts-speaking"];
  return TIER_PRESETS[id as TierPresetId] ?? TIER_PRESETS["ielts-speaking"];
}
