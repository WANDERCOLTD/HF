/**
 * Registry options ↔ schema literal coverage — Lane 4 of the post-
 * Slice-C BA-failure recovery.
 *
 * **What this test pins:**
 *  Every `JourneySettingContract` whose `control` is `select` /
 *  `multi-select` carries an `options` array. Each option's `value`
 *  string MUST match a literal in the corresponding schema type union
 *  (in `lib/types/json-fields.ts::PlaybookConfig` or a canonical sibling
 *  like `lib/banding/presets.ts::TIER_PRESETS`).
 *
 *  When a contract's options diverge from the canonical union, the
 *  PATCH handler silently accepts invalid writes (validator types
 *  match) but downstream readers reject them as unknown values. This
 *  is the same drift class the Slice C BA-failure recovery shipped
 *  for at the field level (#1780); this test extends it to the
 *  option-value level.
 *
 * **Why this exists:**
 *  Audit during Lane 3 closeout (#1799) surfaced that I'd written
 *  options arrays verbatim from copy-paste rather than deriving from
 *  the canonical. Specifically `tierPresetId` shipped with labels
 *  `"Generic" / "IELTS Speaking" / "CEFR" / "5-Level" / "Custom"` —
 *  the canonical labels in `TIER_PRESETS` are `"Generic 4-tier
 *  (HF default)" / "IELTS Speaking" / "CEFR (A1 → C2)" / "5-Level
 *  (Novice → Expert)"`. Label drift is silent; this test catches it.
 *
 * **How to fix a failure:**
 *  - "Contract has options but no entry in EXPECTED_OPTION_VALUES":
 *    add a row. If the contract derives from a canonical (preferred —
 *    see `tierPresetId`), mark `DERIVED_FROM_CANONICAL` so the test
 *    verifies against the canonical source.
 *  - "Option values diverge from expected": either the contract is
 *    wrong (most common — fix the contract) or the canonical schema
 *    changed (rare — update EXPECTED_OPTION_VALUES with the new
 *    literal set).
 *
 *  See ADR: `docs/decisions/2026-06-16-registry-schema-coverage.md`
 *  (Lane 1) for the parent pattern.
 */

import { describe, it, expect } from "vitest";

import {
  JOURNEY_SETTINGS,
  JOURNEY_SETTINGS_BY_ID,
} from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import { TIER_PRESETS } from "@/lib/banding/presets";

/** Marker for options that derive from a canonical source. The test
 *  verifies the derived array matches the canonical's current keys. */
const DERIVED = Symbol("derived");

interface OptionPin {
  /** Expected option values in expected ORDER, or DERIVED to verify
   *  against the canonical source. */
  values: readonly string[] | typeof DERIVED;
  /** Where the canonical literal lives. Comment for reviewers. */
  canonical: string;
}

/** EXPECTED_OPTION_VALUES — every contract with `options` MUST have a
 *  row. Authoring a new options-bearing contract requires also adding
 *  a row here in the SAME PR — that's the discipline. */
const EXPECTED_OPTION_VALUES: Record<string, OptionPin> = {
  // ── A_intake ────────────────────────────────────────────────────
  intakeKnowledgeCheckMode: {
    values: ["mcq", "socratic"],
    canonical:
      "lib/types/json-fields.ts::IntakeConfig.knowledgeCheck.deliveryMode",
  },
  // NOTE: intakeConsentFlow ships with control:"select" but NO options
  // array — pre-existing bug surfaced during this audit. Lane 2 already
  // added the "No options available — use ⋯ → Edit as JSON" fallback
  // for the runtime UX. Follow-on needed: product to define the
  // canonical consent-flow value set, then add options here.

  // ── B_call1_opening ─────────────────────────────────────────────
  firstCallMode: {
    values: ["onboarding", "teach_immediately", "baseline_assessment"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.firstCallMode",
  },
  firstCallWaitForAck: {
    values: ["none", "any_response", "greeting_words"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.firstCallWaitForAck",
  },
  firstCallModuleVisibility: {
    values: [
      "mention_from_call_1",
      "hide_until_call_2",
      "hide_until_learner_picks",
    ],
    canonical:
      "lib/types/json-fields.ts::PlaybookConfig.firstCall.firstCallModuleVisibility (#1405)",
  },
  baselineAssessmentDepth: {
    values: ["light", "standard", "deep"],
    canonical:
      "lib/types/json-fields.ts::PlaybookConfig.baselineAssessmentDepth",
  },

  // ── C_teaching_style ────────────────────────────────────────────
  teachingStyle: {
    values: ["socratic", "direct", "adaptive"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.teachingStyle",
  },
  modePolicy: {
    values: ["teach", "quiz", "mix"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.modePolicy",
  },

  // ── D_question_flow ─────────────────────────────────────────────
  moduleVisibility: {
    values: [
      "mention_from_call_1",
      "hide_until_call_2",
      "hide_until_learner_picks",
    ],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.moduleVisibility",
  },
  moduleSequencePolicy: {
    values: ["strict", "interleaved", "learner_led"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.moduleSequencePolicy",
  },

  // ── I_scoring ───────────────────────────────────────────────────
  tierPresetId: {
    values: DERIVED,
    canonical:
      "lib/banding/presets.ts::TIER_PRESETS (Object.keys); contract derives both values and labels",
  },
  maxMasteryTier: {
    values: ["FOUNDATION", "DEVELOPING", "PRACTITIONER", "DISTINCTION"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.maxMasteryTier",
  },
  scoringMode: {
    values: ["strict", "lenient", "adaptive"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.scoringMode",
  },
  completionMode: {
    values: ["terminal-only", "all-modules", "any"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.completionMode (#494)",
  },
  completionCriteria: {
    values: ["all_modules", "any_module", "mastery_threshold"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.completionCriteria",
  },

  // ── J_feedback ──────────────────────────────────────────────────
  progressNarrativeCadence: {
    values: ["every_call", "on_threshold_crossing"],
    canonical:
      "lib/types/json-fields.ts::PlaybookConfig.progressNarrative.cadence (#779)",
  },
  priorCallRecapDepth: {
    values: ["minimal", "standard", "rich"],
    canonical:
      "lib/types/json-fields.ts::PriorCallRecapDepth (#599)",
  },

  // ── K_between_calls ─────────────────────────────────────────────
  callCountPolicy: {
    values: ["hard_cap", "soft_cap", "unlimited"],
    canonical: "lib/types/json-fields.ts::PlaybookConfig.callCountPolicy",
  },
  rewardStrategy: {
    values: ["learner_mastery", "educator_drift", "blended"],
    canonical:
      "lib/types/json-fields.ts::PlaybookConfig.rewardStrategy (operator-only)",
  },

  // ── L_mid_journey ───────────────────────────────────────────────
  midJourneyStopTrigger: {
    values: ["mastery_threshold", "session_count"],
    canonical:
      "lib/types/json-fields.ts::JourneyStopTrigger discriminated union",
  },
  npsTrigger: {
    values: ["mastery", "session_count"],
    canonical: "lib/types/json-fields.ts::NpsConfig.trigger",
  },

  // ── M_end_of_course ─────────────────────────────────────────────
  offboardingSummaryCadence: {
    values: ["final_only", "every_session_with_data"],
    canonical:
      "lib/types/json-fields.ts::PlaybookConfig.offboardingSummary.cadence (#780)",
  },
};

function resolveExpected(id: string): readonly string[] | null {
  const pin = EXPECTED_OPTION_VALUES[id];
  if (!pin) return null;
  if (pin.values === DERIVED) {
    // Derive from canonical sources by id.
    if (id === "tierPresetId") {
      return Object.keys(TIER_PRESETS);
    }
    return null;
  }
  return pin.values;
}

describe("Registry options ↔ schema literal coverage (Lane 4)", () => {
  const allWithOptions = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS].filter(
    (c) => Array.isArray(c.options) && c.options.length > 0,
  );

  it("every contract with options has an EXPECTED_OPTION_VALUES entry", () => {
    const missing: string[] = [];
    for (const c of allWithOptions) {
      if (!(c.id in EXPECTED_OPTION_VALUES)) missing.push(c.id);
    }
    expect(
      missing,
      `Contracts with options but no EXPECTED_OPTION_VALUES row — add the row in the SAME PR:\n  ${missing.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every EXPECTED_OPTION_VALUES row matches a contract with options", () => {
    const stale: string[] = [];
    const haveOptionsIds = new Set(allWithOptions.map((c) => c.id));
    for (const id of Object.keys(EXPECTED_OPTION_VALUES)) {
      if (!haveOptionsIds.has(id)) stale.push(id);
    }
    expect(
      stale,
      `EXPECTED_OPTION_VALUES rows with no matching contract (rename / deletion?):\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every contract's options.value array matches the expected literal set", () => {
    const drifts: string[] = [];
    for (const c of allWithOptions) {
      const expected = resolveExpected(c.id);
      if (!expected) continue; // covered by first test
      const actual = (c.options ?? []).map((o) => o.value);
      if (actual.length !== expected.length) {
        drifts.push(
          `${c.id}: actual ${JSON.stringify(actual)} ≠ expected ${JSON.stringify(expected)}`,
        );
        continue;
      }
      const expectedSet = new Set(expected);
      for (const v of actual) {
        if (!expectedSet.has(v)) {
          drifts.push(
            `${c.id}: actual value "${v}" not in expected ${JSON.stringify(expected)}`,
          );
        }
      }
    }
    expect(
      drifts,
      `Contract options drift from canonical literal sets — see EXPECTED_OPTION_VALUES rows for where the canonical lives:\n  ${drifts.join("\n  ")}`,
    ).toEqual([]);
  });

  it("tierPresetId derives from TIER_PRESETS (canonical lives in lib/banding/presets.ts)", () => {
    const c = JOURNEY_SETTINGS_BY_ID.tierPresetId;
    expect(c).toBeDefined();
    const values = (c.options ?? []).map((o) => o.value);
    expect(values).toEqual(Object.keys(TIER_PRESETS));
    // Labels must match canonical too — the drift class the original
    // audit caught ("Generic" vs "Generic 4-tier (HF default)").
    const labels = (c.options ?? []).map((o) => o.label);
    const canonicalLabels = Object.values(TIER_PRESETS).map((p) => p.label);
    expect(labels).toEqual(canonicalLabels);
  });
});
