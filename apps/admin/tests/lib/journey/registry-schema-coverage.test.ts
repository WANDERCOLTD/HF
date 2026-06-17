/**
 * Registry ↔ schema appliesTo coverage — Phase 0 of the Journey-Design
 * tab refactor.
 *
 * **What this test pins:**
 *  Every entry in `JOURNEY_SETTINGS` either:
 *    (a) declares `appliesTo: readonly CourseShape[]` — meaning it has
 *        been deliberately scoped to a subset of course shapes
 *        (e.g. module-scoped settings → `["structured", "exam"]`,
 *        IELTS-specific settings → `["exam"]`), OR
 *    (b) is listed in `APPLIES_TO_ALL` — meaning the author has
 *        confirmed the setting applies to every course shape
 *        (structured + continuous + exam) by default.
 *
 *  Coverage is exhaustive. A new entry that doesn't appear in either
 *  bucket fails CI immediately — author MUST think about its shape
 *  envelope before merge.
 *
 * **Why this exists:**
 *  Phase 0 of the Journey-Design tab refactor adds the
 *  `appliesTo?: readonly CourseShape[]` field. Default-undefined means
 *  "applies to all shapes" — useful, but silent. Without this test,
 *  adding a new module-scoped setting and forgetting to tag it would
 *  silently render the control on continuous courses (where there
 *  are no AuthoredModules) and silently hide it from exam courses.
 *
 *  Same shape as `tests/lib/journey/registry-schema-coverage.test.ts`
 *  (the referenced 5th-pillar test) applied to the new `appliesTo`
 *  field rather than `storagePath` ↔ `PlaybookConfig` field coverage.
 *
 * **How to fix a failure:**
 *  - "Entry has no appliesTo and is not in APPLIES_TO_ALL":
 *    Either tag the entry with `appliesTo: [...]` in
 *    `setting-contracts.entries.ts`, or add its id to `APPLIES_TO_ALL`
 *    below with a comment indicating you reviewed the shape envelope.
 *    When in doubt, prefer `APPLIES_TO_ALL` (default = all shapes).
 *  - "Entry appears in APPLIES_TO_ALL AND declares appliesTo":
 *    Drift — pick one. Tagging is more expressive; the allow-list is
 *    the explicit-default path.
 *  - "APPLIES_TO_ALL entry no longer exists in JOURNEY_SETTINGS":
 *    A contract was removed. Delete the id from APPLIES_TO_ALL.
 */

import { describe, it, expect } from "vitest";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";

/** Allow-list of journey + voice contract ids that apply to every
 *  course shape (structured + continuous + exam) by default. Adding
 *  an id here is a deliberate "yes, this affects every course shape"
 *  declaration — equivalent to omitting `appliesTo` but tracked here
 *  for discoverability.
 *
 *  Authoring discipline: when adding a new contract, default to this
 *  allow-list unless you have a concrete reason to scope it. Tagging
 *  incorrectly is worse than not tagging — an over-tagged entry
 *  silently disappears from courses it should affect.
 *
 *  Maintenance: when a contract is removed from
 *  `JOURNEY_SETTINGS` / `VOICE_SETTINGS`, delete the id here too.
 *  The "stale allow-list" assertion below catches drift. */
const APPLIES_TO_ALL: readonly string[] = [
  // ── A_intake (5 of 7 — intakeKnowledgeCheck variants apply to every shape)
  "intakeSpecId",
  "intakeKnowledgeCheck",
  "intakeAboutYou",
  "intakeGoals",
  "intakeAiIntroCall",
  "intakeKnowledgeCheckMode",
  "intakeSkipIfReturning",

  // ── B_call1_opening (9 of 10 — firstCallModuleVisibility is structured-only)
  "firstCallMode",
  "welcomeMessage",
  "firstCallCourseIntro",
  "firstCallWaitForAck",
  "firstCallDurationOverride",
  "firstCallIntroducePedagogy",
  "onboardingFlowPhases",
  "firstCallTargets",
  "preTestStop",
  "baselineAssessmentDepth",

  // ── C_teaching_style + module-sequence siblings
  "teachingStyle",
  // moduleSequencePolicy is structured-only — NOT in this list.
  "firstCallCurriculumFocus",
  "openingRecapEnabled",

  // ── D_question_flow + tolerance + skills (G4 — applies broadly)
  "modePolicy",
  "shareMaterials",
  "toleranceAccuracy",
  "toleranceFluency",
  "toleranceConfidence",
  "toleranceEngagement",
  "tierPresetId",
  "voiceProsodyMode",
  "skillMinCallsToFull",
  "skillTierMapping",
  "skillScoringEmaHalfLife",
  "maxMasteryTier",
  "useFreshMastery",
  "scoringMode",
  "progressNarrativeEnabled",
  "progressNarrativeCadence",
  "progressNarrativeThreshold",
  "progressNarrativeSkipFirstCall",
  "priorCallRecapEnabled",
  "priorCallRecapDepth",
  "priorCallRecapDailyCap",
  "recapEnabled",
  "recapSynthesisEnabled",
  "priorCallFeedbackEnabled",
  "agentTunerNlpEnabled",
  "progressSignalLowWater",
  "progressSignalHighWater",
  "interruptSensitivity",

  // ── G5 — mid-journey + NPS (applies to every shape)
  "midJourneyStop",
  "npsEnabled",
  "npsTrigger",
  "npsThreshold",
  "npsStop",

  // ── G6 — offboarding
  "offboardingFlowPhases",
  "offboardingSummaryEnabled",
  "offboardingSummaryCadence",
  "offboardingSummaryIncludeModuleMastery",
  "offboardingSummaryIncludeGoalProgress",
  "offboardingSummaryIncludeSkillScore",
  "offboardingTriggerAfterCalls",
  "offboardingBannerMessage",
  "offboardingCertificate",
  "postTestStop",

  // ── G7 — tolerance + completion + sequencing
  "tolMasteryThreshold",
  "tolRetrievalCadence",
  "tolMemoryDecay",
  "tolCarryForwardBoost",
  // firstCallModuleVisibility is structured-only — NOT in this list.
  "completionMode",
  // strictPrerequisites is structured-only — NOT in this list.
  "loMasteryThreshold",
  "interleaveReviewMinDays",
  "callCountPolicy",
  "maxCallsPerDay",
  "assessmentReadinessThreshold",
  "rewardStrategy",
  "talkTimeBudgets",

  // ── G8 — module-scoped IELTS settings are ALL deliberately tagged
  //   (`appliesTo: ["structured", "exam"]` or `["exam"]`) so none of
  //   them belong on this allow-list. Their absence is intentional.

  // ── N_voice (Settings tab voice subset — 11 entries; all global)
  "voiceProvider",
  "voiceId",
  "backgroundSound",
  // interruptSensitivity duplicates the journey entry above — same id
  // is intentional (cross-registry mirror). The completeness vitest
  // pins this. Listing once is sufficient.
  "voiceSpeed",
  "voicePitch",
  "silenceThreshold",
  "endCallAfterSilence",
  "maxCallDuration",
  "phoneNumber",
  "vapiAssistantId",
];

const APPLIES_TO_ALL_SET = new Set(APPLIES_TO_ALL);

/** All contracts spanning both registries. The journey registry holds
 *  85 entries; the voice registry holds 11 entries; they share
 *  `interruptSensitivity` by id so the unified set is smaller than
 *  the raw sum. */
const ALL_CONTRACTS = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];

describe("registry ↔ schema appliesTo coverage", () => {
  it("every contract either declares appliesTo OR is in APPLIES_TO_ALL", () => {
    const missing: string[] = [];
    for (const contract of ALL_CONTRACTS) {
      const hasTag = contract.appliesTo !== undefined;
      const inAllowlist = APPLIES_TO_ALL_SET.has(contract.id);
      if (!hasTag && !inAllowlist) {
        missing.push(contract.id);
      }
    }
    if (missing.length > 0) {
      // De-duplicate (cross-registry mirrors like interruptSensitivity).
      const deduped = Array.from(new Set(missing));
      throw new Error(
        `${deduped.length} contract(s) lack appliesTo AND are not in APPLIES_TO_ALL.\n` +
          `Add to APPLIES_TO_ALL (preferred default) or tag with appliesTo:\n` +
          deduped.map((id) => `  - ${id}`).join("\n"),
      );
    }
    expect(missing).toEqual([]);
  });

  it("no contract is in APPLIES_TO_ALL AND declares appliesTo", () => {
    const drift: string[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (
        contract.appliesTo !== undefined &&
        APPLIES_TO_ALL_SET.has(contract.id)
      ) {
        drift.push(contract.id);
      }
    }
    if (drift.length > 0) {
      const deduped = Array.from(new Set(drift));
      throw new Error(
        `${deduped.length} contract(s) are both tagged AND in APPLIES_TO_ALL — pick one:\n` +
          deduped.map((id) => `  - ${id}`).join("\n"),
      );
    }
    expect(drift).toEqual([]);
  });

  it("APPLIES_TO_ALL entries all exist in the registries (no stale ids)", () => {
    const knownIds = new Set(ALL_CONTRACTS.map((c) => c.id));
    const stale = APPLIES_TO_ALL.filter((id) => !knownIds.has(id));
    if (stale.length > 0) {
      throw new Error(
        `${stale.length} APPLIES_TO_ALL id(s) no longer exist in JOURNEY_SETTINGS / VOICE_SETTINGS:\n` +
          stale.map((id) => `  - ${id}`).join("\n") +
          `\nRemove from APPLIES_TO_ALL.`,
      );
    }
    expect(stale).toEqual([]);
  });

  it("APPLIES_TO_ALL entries have no duplicates", () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of APPLIES_TO_ALL) {
      if (seen.has(id)) dupes.push(id);
      seen.add(id);
    }
    expect(dupes).toEqual([]);
  });

  it("every `appliesTo` value uses only valid CourseShape literals", () => {
    const validShapes = new Set(["structured", "continuous", "exam"]);
    const invalid: { id: string; bad: string[] }[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (contract.appliesTo === undefined) continue;
      const bad = contract.appliesTo.filter((s) => !validShapes.has(s));
      if (bad.length > 0) invalid.push({ id: contract.id, bad });
    }
    if (invalid.length > 0) {
      throw new Error(
        `${invalid.length} contract(s) declare invalid CourseShape values:\n` +
          invalid
            .map((e) => `  - ${e.id}: [${e.bad.join(", ")}]`)
            .join("\n"),
      );
    }
    expect(invalid).toEqual([]);
  });

  it("every `appliesTo` array is non-empty (avoids the never-renders trap)", () => {
    const empty: string[] = [];
    for (const contract of ALL_CONTRACTS) {
      if (contract.appliesTo !== undefined && contract.appliesTo.length === 0) {
        empty.push(contract.id);
      }
    }
    if (empty.length > 0) {
      throw new Error(
        `${empty.length} contract(s) have an EMPTY appliesTo (means "renders for no shape" — almost certainly a bug):\n` +
          empty.map((id) => `  - ${id}`).join("\n") +
          `\nOmit the field for "all shapes", or list the shape(s) it applies to.`,
      );
    }
    expect(empty).toEqual([]);
  });
});
