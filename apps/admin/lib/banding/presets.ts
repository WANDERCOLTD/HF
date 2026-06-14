/**
 * Per-playbook tier-mapping presets (#417 / Story C / #1647 / #1657).
 *
 * The shape matches `SkillTierMapping` from `lib/goals/track-progress.ts`
 * so `scoreToTier()` consumes them directly.
 *
 * Selection mechanism (highest precedence first):
 *   1. `Playbook.config.skillTierMapping` (full mapping override)
 *   2. `SKILL_MEASURE_V1` contract thresholds / tierBands
 *   3. Built-in defaults inside `scoreToTier`
 *
 * Default is **Generic 4-tier** (#1657). IELTS Speaking, CEFR, and 5-Level
 * are framework-specific explicit picks. `source-derived` is the synthetic
 * 5th entry (#1647) that surfaces #1635's auto-derived mapping in the picker.
 */
import type { SkillTierMapping } from "@/lib/goals/track-progress";

export type TierPresetId =
  | "generic"
  | "ielts-speaking"
  | "cefr"
  | "5-level"
  | "source-derived"
  | "custom";

export interface TierPreset {
  id: TierPresetId;
  label: string;
  description: string;
  /**
   * The mapping itself. NOTE: `scoreToTier` uses 4 tiers in fixed slots
   * (`approachingEmerging` / `emerging` / `developing` / `secure`).
   * Custom band labels surface via `tierLabels` (consumer UI override),
   * but the threshold slots stay the same. CEFR / 5-Level / IELTS map
   * their native labels onto these 4 slots.
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
  generic: {
    id: "generic",
    label: "Generic 4-tier (HF default)",
    description:
      "Neutral 4-tier scheme for any course. Tiers map to bands 1 / 2 / 3 / 4. Pick a framework-specific preset (IELTS, CEFR) if your course uses one.",
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
  },
  "ielts-speaking": {
    id: "ielts-speaking",
    label: "IELTS Speaking",
    description:
      "IELTS Speaking criterion banding. Tiers map to IELTS bands 3 / 4 / 5.5 / 7. Pick this for IELTS preparation courses.",
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
    tierLabels: {
      approachingEmerging: "Band 3",
      emerging: "Band 4",
      developing: "Band 5.5",
      secure: "Band 7",
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
  "source-derived": {
    id: "source-derived",
    label: "Source-derived",
    description:
      "Parsed from your uploaded course document by the rubric extractor (#1635). The actual labels + bands below come from your source — this registry entry is a placeholder so the picker can list it alongside the baked presets.",
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
  },
  custom: {
    id: "custom",
    label: "Custom",
    description:
      "Educator-defined thresholds + band numbers + tier labels. Set via `Playbook.config.skillTierMapping`.",
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
  },
};

/** Resolve a preset by id; defaults to Generic 4-tier when no match. */
export function getPreset(id: TierPresetId | string | undefined | null): TierPreset {
  if (!id) return TIER_PRESETS.generic;
  return TIER_PRESETS[id as TierPresetId] ?? TIER_PRESETS.generic;
}
