/**
 * Control-type ↔ data-shape coverage — A5 of #2225 / RHS Inspector
 * Robustness.
 *
 * **What this test pins:**
 *  Every `JourneySettingContract` + `VoiceSettingsContract` MUST declare
 *  a (control, dataShape) pairing that is structurally compatible. The
 *  control type drives which JourneyField primitive renders the editor;
 *  the data shape drives what the primitive reads / writes. A mismatch
 *  produces silent UX failure modes:
 *
 *   - `text` control over an `Array<...>` storage → operator types
 *     prose into a textarea that's serialised back as a string into a
 *     field typed as `Array<X>`; the renderer either silently truncates
 *     or refuses to save.
 *   - `json-fallback` over an `Array<{...}>` that COULD have a typed
 *     editor (cue-card pool / topic pool / profile-fields) → operator
 *     hand-writes JSON and a single mistyped key drops the entry on
 *     save.
 *   - `array-editor` over a `string[]` (no row schema) → editor shows
 *     "No row schema registered" and the operator can't add items.
 *
 *  Mode 2 of the original #2225 audit (control-type mismatch) found 6
 *  G8 module-scoped contracts shipping in mismatch. A2 + A2b paired
 *  fixes (PR a792b8af + the in-flight `fix/2225-a2b-modulescaffoldpool-schema`
 *  branch) bring the incumbent count to 0 once landed. This test pins
 *  the post-fix state structurally — future drift is blocked.
 *
 * **How matching works:**
 *  Every contract id has a row in `DECLARED_DATA_SHAPE` declaring its
 *  storage data shape. A fixed `CONTROL_DATA_SHAPE_COMPATIBILITY` table
 *  maps each `ControlType` to the set of `DataShape`s it can render
 *  without a row-schema gap. The test fails if any contract's
 *  `(control, declaredShape)` pair is outside the compatibility set OR
 *  if any contract is missing a declaration.
 *
 *  Single-source-of-truth pattern mirrors `registry-options-coverage.test.ts`
 *  (Lane 4) — author of a new contract MUST add a `DECLARED_DATA_SHAPE`
 *  row in the same PR. The "every contract has a row" assertion catches
 *  the discipline lapse at PR time.
 *
 *  Exempt entries live in `CONTROL_SHAPE_EXEMPT` with a >20-char reason
 *  (e.g. legitimate JSON-fallback choice for a structurally opaque
 *  config blob). The ratchet pins the incumbent exempt count.
 *
 * **How to fix a failure:**
 *  - "Contract has no DECLARED_DATA_SHAPE row" — add a row mapping the
 *    contract id to its DataShape.
 *  - "Control / shape mismatch" — either change the contract's `control`
 *    to a compatible primitive OR fix the storage shape upstream. Fix
 *    direction depends on whether the data is genuinely opaque
 *    (json-fallback) or structurable (array-editor + row schema).
 *  - "DECLARED_DATA_SHAPE row references unknown contract id" — the
 *    contract was renamed/deleted; remove the stale row.
 *  - "Exempt count drifted" — bump consciously OR remove the entry if
 *    the underlying mismatch was fixed.
 *
 *  See `.claude/rules/control-data-shape-coverage.md` for the durable
 *  rule + Story [#2225](https://github.com/WANDERCOLTD/HF/issues/2225)
 *  A5 framing.
 */

import { describe, it, expect } from "vitest";

import {
  JOURNEY_SETTINGS,
} from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type {
  ControlType,
  JourneySettingContract,
} from "@/lib/journey/setting-contracts";

// ────────────────────────────────────────────────────────────
// DataShape enumeration — declarative shape labels.
// ────────────────────────────────────────────────────────────

/**
 * Each value identifies a structural data shape the storage column can
 * hold. The compatibility table below enumerates which controls render
 * each shape without an editor gap. New shapes land alongside new
 * primitives — if the JourneyField dispatcher grows, this enumeration
 * grows with it.
 */
type DataShape =
  | "boolean"
  | "string"
  | "number"
  | "duration"
  | "enum-string"
  | "enum-multi-string"
  | "array-of-objects"
  | "array-of-strings"
  | "min-target-pair"
  | "phases-list"
  | "targets-list"
  | "tier-mapping"
  | "stop-config"
  | "voice-credential"
  | "opaque-object"
  // #2176 S1 — CourseAssessmentPlan compound shape (upfront/midpoints/end/noAssessmentPlan).
  | "assessment-plan";

// ────────────────────────────────────────────────────────────
// Control ↔ DataShape compatibility matrix.
// ────────────────────────────────────────────────────────────

/**
 * Compatibility rules — which DataShapes each ControlType can render
 * faithfully. Derived from `apps/admin/components/journey-controls/JourneyField.tsx`
 * dispatcher + per-primitive read/write contracts. Asymmetric on purpose:
 *
 *  - `select` accepts both `enum-string` AND bare `string` because some
 *    select-shape contracts gate values at the schema layer rather than
 *    via a closed union (e.g. tierPresetId values come from a runtime
 *    registry).
 *  - `duration` accepts `duration` + `number` — the primitive formats
 *    seconds as a duration but the underlying column is numeric.
 *  - `array-editor` accepts ONLY `array-of-objects` — when the storage
 *    is `string[]`, the JourneyArrayEditor's ROW_SCHEMAS lookup misses
 *    and the editor shows "No row schema registered". This is the A2b
 *    fix-target shape.
 *  - `json-fallback` accepts ANY shape — it's the universal escape
 *    hatch (operators hand-write JSON). The exempt list pins the
 *    legitimate uses (operator-only opaque-object surfaces); other
 *    shapes mapped to json-fallback are mismatches that the test
 *    surfaces.
 */
const CONTROL_DATA_SHAPE_COMPATIBILITY: Record<
  ControlType,
  readonly DataShape[]
> = {
  toggle: ["boolean"],
  select: ["enum-string", "string"],
  "multi-select": ["enum-multi-string"],
  text: ["string"],
  number: ["number"],
  slider: ["number"],
  duration: ["duration", "number"],
  "json-fallback": ["opaque-object"],
  phases: ["phases-list"],
  targets: ["targets-list"],
  banding: ["tier-mapping"],
  "voice-picker": ["voice-credential", "string"],
  stop: ["stop-config"],
  "min-target": ["min-target-pair"],
  "array-editor": ["array-of-objects"],
  // #2176 S1 — the CourseAssessmentPlan compound editor renders ONLY the
  // typed plan shape; never used as a generic escape hatch.
  "assessment-plan-editor": ["assessment-plan"],
};

// ────────────────────────────────────────────────────────────
// DECLARED_DATA_SHAPE — per-contract shape declaration.
// ────────────────────────────────────────────────────────────

/**
 * Single source-of-truth for every contract's storage data shape.
 * Derived from `lib/types/json-fields.ts::PlaybookConfig` +
 * `AuthoredModuleSettings` + sibling type definitions. Author of a new
 * contract MUST add a row here in the SAME PR — that's the discipline.
 *
 * The classifier walks `JOURNEY_SETTINGS + VOICE_SETTINGS`, looks each
 * id up in this table, and asserts the declared shape is in the
 * `CONTROL_DATA_SHAPE_COMPATIBILITY[contract.control]` allowed set.
 */
const DECLARED_DATA_SHAPE: Record<string, DataShape> = {
  // ── G1 — Sign-up & Intake ──────────────────────────────────────
  intakeSpecId: "string",
  intakeKnowledgeCheck: "boolean",
  intakeAboutYou: "boolean",
  intakeAboutYouQuestion: "string",
  intakeGoals: "boolean",
  intakeGoalsQuestion: "string",
  intakeAiIntroCall: "boolean",
  intakeKnowledgeCheckMode: "enum-string",
  intakeSkipIfReturning: "boolean",
  onboardingClosingLine: "string",

  // ── G2 — Call 1 opening ────────────────────────────────────────
  firstCallMode: "enum-string",
  welcomeMessage: "string",
  firstCallCourseIntro: "string",
  firstCallWaitForAck: "enum-string",
  firstCallDurationOverride: "number",
  firstCallIntroducePedagogy: "boolean",
  onboardingFlowPhases: "phases-list",
  firstCallTargets: "targets-list",
  preTestStop: "stop-config",
  baselineAssessmentDepth: "enum-string",

  // ── G3 — Teaching style ────────────────────────────────────────
  teachingStyle: "enum-string",
  moduleSequencePolicy: "enum-string",
  firstCallCurriculumFocus: "enum-multi-string",
  openingRecapEnabled: "boolean",

  // ── G4 — Question flow + scoring ───────────────────────────────
  modePolicy: "enum-string",
  shareMaterials: "boolean",
  toleranceAccuracy: "number",
  toleranceFluency: "number",
  toleranceConfidence: "number",
  toleranceEngagement: "number",
  tierPresetId: "enum-string",
  voiceProsodyMode: "enum-string",
  skillMinCallsToFull: "number",
  skillTierMapping: "tier-mapping",
  skillScoringEmaHalfLife: "number",
  maxMasteryTier: "enum-string",
  useFreshMastery: "boolean",
  scoringMode: "enum-string",
  aiMeasurementDisableLlmIeltsScoring: "boolean",
  progressNarrativeEnabled: "boolean",
  progressNarrativeCadence: "enum-string",
  progressNarrativeThreshold: "number",
  progressNarrativeSkipFirstCall: "boolean",
  priorCallRecapEnabled: "boolean",
  priorCallRecapDepth: "enum-string",
  priorCallRecapDailyCap: "number",
  recapEnabled: "boolean",
  recapSynthesisEnabled: "boolean",
  priorCallFeedbackEnabled: "boolean",
  agentTunerNlpEnabled: "boolean",
  progressSignalLowWater: "number",
  progressSignalHighWater: "number",
  interruptSensitivity: "number",

  // ── G5 — Mid-journey ───────────────────────────────────────────
  midJourneyStop: "stop-config",
  npsEnabled: "boolean",
  npsTrigger: "enum-string",
  npsThreshold: "number",
  npsStop: "stop-config",

  // ── G6 — End of course / offboarding ───────────────────────────
  offboardingFlowPhases: "phases-list",
  offboardingSummaryEnabled: "boolean",
  offboardingSummaryCadence: "enum-string",
  offboardingSummaryIncludeModuleMastery: "boolean",
  offboardingSummaryIncludeGoalProgress: "boolean",
  offboardingSummaryIncludeSkillScore: "boolean",
  offboardingTriggerAfterCalls: "number",
  offboardingBannerMessage: "string",
  offboardingCertificate: "boolean",
  postTestStop: "stop-config",

  // ── G7 — Tolerance / progress / completion ─────────────────────
  tolMasteryThreshold: "number",
  tolRetrievalCadence: "number",
  tolMemoryDecay: "number",
  tolCarryForwardBoost: "number",
  firstCallModuleVisibility: "enum-string",
  completionMode: "enum-string",
  strictPrerequisites: "boolean",
  lessonPlanMode: "enum-string",
  loMasteryThreshold: "number",
  interleaveReviewMinDays: "number",
  callCountPolicy: "enum-string",
  maxCallsPerDay: "number",
  assessmentReadinessThreshold: "number",
  rewardStrategy: "enum-string",
  // talkTimeBudgets — `{maxTutorTurnSec, maxTutorRatio}` opaque blob,
  // operator-only telemetry config. Legitimate json-fallback.
  talkTimeBudgets: "opaque-object",

  // ── G8 — Module-scoped (IELTS Theme 1 + Theme 10) ──────────────
  moduleQuestionTarget: "min-target-pair",
  moduleMinSpeakingSec: "number",
  moduleCueCardPool: "array-of-objects",
  // moduleTopicPool — `Array<{topic, questions: string[]}>` per #1932.
  // Pre-A2 ships as json-fallback; post-A2 ships as array-editor with
  // matching ROW_SCHEMAS entry. The shape is array-of-objects either
  // way; the control type catches up.
  moduleTopicPool: "array-of-objects",
  moduleClosingLine: "string",
  moduleFirstTimeOrientationLine: "string",
  moduleScheduledCues: "array-of-objects",
  // moduleScaffoldPool — `string[]`. Pre-A2b uses `control: array-editor`
  // with NO matching ROW_SCHEMAS entry — the editor shows "No row schema
  // registered" because the data isn't object-shaped. A2b resolves
  // either by adding a string-bullet ROW_SCHEMAS path OR by converting
  // the control to a string-bullet editor. Until then, this cell will
  // surface as the incumbent gap (the test pins it).
  moduleScaffoldPool: "array-of-strings",
  moduleGenerateLessonPlan: "boolean",
  moduleSilentMode: "boolean",
  // moduleProfileFieldsToCapture — `ProfileFieldToCapture[]` =
  // `{key, prompt, type}[]`. Pre-A2 ships as json-fallback; A2 migrates
  // to array-editor (ROW_SCHEMAS entry already present from Theme 1b).
  moduleProfileFieldsToCapture: "array-of-objects",
  modulePinFocusArea: "boolean",
  // S8 — module-scoped score readout policy. Storage is the canonical
  // `ScoreReadoutMode` union; control is `select` with options derived
  // from `SCORE_READOUT_MODE_VALUES`. (select × enum-string) is a valid
  // matrix pairing.
  moduleScoreReadoutMode: "enum-string",
  // S7 — per-StallType scaffold map. Storage is
  // `Partial<Record<StallType, string[]>>`; control is `json-fallback`.
  // (json-fallback × opaque-object) is a valid pairing — a future PR
  // may ship a typed primitive once the runtime consumer lands.
  moduleScaffoldsByStallType: "opaque-object",
  // S3 — per-module LearnerShellCapabilities DISABLE-only override.
  // Storage is `Partial<LearnerShellCapabilities>`; control is
  // `json-fallback`. (json-fallback × opaque-object) is a valid pairing
  // — a future PR may ship a typed primitive with toggle-to-disable
  // affordances per capability default.
  moduleLearnerShellOverride: "opaque-object",

  // ── VOICE_SETTINGS (Settings tab) ──────────────────────────────
  voiceProvider: "enum-string",
  voiceId: "voice-credential",
  backgroundSound: "enum-string",
  voiceSpeed: "number",
  voicePitch: "number",
  silenceThreshold: "duration",
  endCallAfterSilence: "duration",
  maxCallDuration: "duration",
  phoneNumber: "string",
  vapiAssistantId: "string",

  // ── I_scoring — #2176 S1 CourseAssessmentPlan editor lens ──────
  assessmentPlan: "assessment-plan",
};

// ────────────────────────────────────────────────────────────
// Exempt list — contracts whose (control, shape) mismatch is
// intentional or pending fix.
// ────────────────────────────────────────────────────────────

interface ExemptEntry {
  /** >20-char justification — what's deferred, when it'll be closed. */
  reason: string;
}

/**
 * Exempt entries. Each (id, reason) pair acknowledges a current
 * mismatch the test would otherwise flag. The ratchet
 * (`EXPECTED_EXEMPT_COUNT`) pins the count — entries can be REMOVED as
 * the underlying mismatch is fixed, but adding new ones is a conscious
 * decision (bump the ratchet AND document in the PR body).
 *
 * Today's incumbent (land time of A5, on `main`-as-of-feat/2206-w4-…):
 * 3 module-scoped G8 contracts. Each is paired with the in-flight
 * #2225 A2/A2b/A1b sibling-fix branches. As those PRs merge, the
 * matching exempt entry is removed AND `EXPECTED_EXEMPT_COUNT` drops by
 * 1 in the same commit. End state (all 3 sibling fixes landed) → 0.
 *
 * Each entry reason names the sibling fix branch so a future reader can
 * trace WHICH PR closes the gap.
 */
const CONTROL_SHAPE_EXEMPT: Record<string, ExemptEntry> = {
  // moduleTopicPool + moduleProfileFieldsToCapture — closed by #2225 A2
  // (PR #2234, commit d0a3dc97 on main). Contract.control was flipped
  // from json-fallback → array-editor; the (array-editor, array-of-objects)
  // pairing is now valid. Exempt entries removed during #2176 S1
  // (the AssessmentPlan editor lens PR) as Lattice hygiene — the gate
  // had been red on main since A2 merged.
  moduleScaffoldPool: {
    reason:
      "pending #2225 A2b (fix/2225-a2b-modulescaffoldpool-schema) — scaffoldPool storage is string[]; needs string-bullet ROW_SCHEMAS path OR control rename. A2 commit body flagged this as separately-tracked",
  },
};

/** Ratchet — exempt count can DROP (mismatch fixed, entry removed),
 *  never grow without an explicit bump here. Mirrors the discipline of
 *  every sibling Coverage-pillar test (registry-consumer / route-auth-zod
 *  / tier-visibility / parameter / etc.).
 *
 *  Land value: 3 (the A2 + A2b incumbent surface). Drops to 0 as the
 *  sibling-fix PRs merge — operator drops the ratchet by 1 per fix in
 *  the same commit that removes the matching exempt entry.
 *
 *  Drop log:
 *  - 3 → 1 in #2176 S1 (this PR) when A2 (#2234, d0a3dc97) closed
 *    moduleTopicPool + moduleProfileFieldsToCapture's mismatches.
 *  - 1 → 0 pending A2b for moduleScaffoldPool. */
const EXPECTED_EXEMPT_COUNT = 1;

// ────────────────────────────────────────────────────────────
// Classification
// ────────────────────────────────────────────────────────────

type Classification = "valid" | "exempt" | "mismatch" | "missing-declaration";

interface ClassResult {
  id: string;
  control: ControlType;
  declared?: DataShape;
  classification: Classification;
  reason?: string;
}

function classify(c: JourneySettingContract): ClassResult {
  const declared = DECLARED_DATA_SHAPE[c.id];
  if (declared === undefined) {
    return { id: c.id, control: c.control, classification: "missing-declaration" };
  }
  if (CONTROL_SHAPE_EXEMPT[c.id]) {
    return {
      id: c.id,
      control: c.control,
      declared,
      classification: "exempt",
      reason: CONTROL_SHAPE_EXEMPT[c.id].reason,
    };
  }
  const allowed = CONTROL_DATA_SHAPE_COMPATIBILITY[c.control];
  if (allowed.includes(declared)) {
    return { id: c.id, control: c.control, declared, classification: "valid" };
  }
  return { id: c.id, control: c.control, declared, classification: "mismatch" };
}

// ────────────────────────────────────────────────────────────
// Tests
// ────────────────────────────────────────────────────────────

describe("Control-type ↔ data-shape coverage (A5 of #2225)", () => {
  const all = [...JOURNEY_SETTINGS, ...VOICE_SETTINGS];
  const results = all.map(classify);

  it("every contract has a DECLARED_DATA_SHAPE row", () => {
    const missing = results
      .filter((r) => r.classification === "missing-declaration")
      .map((r) => r.id);
    expect(
      missing,
      `Contracts with no DECLARED_DATA_SHAPE row — add a row in the SAME PR:\n  ${missing.join("\n  ")}\n\nThe shape is the storage data shape under the contract's storagePath ` +
        `(read lib/types/json-fields.ts::PlaybookConfig + AuthoredModuleSettings). ` +
        `Pick from: boolean | string | number | duration | enum-string | enum-multi-string | ` +
        `array-of-objects | array-of-strings | min-target-pair | phases-list | targets-list | ` +
        `tier-mapping | stop-config | voice-credential | opaque-object.`,
    ).toEqual([]);
  });

  it("every (control, declaredShape) pair is structurally compatible", () => {
    const mismatches = results
      .filter((r) => r.classification === "mismatch")
      .map(
        (r) =>
          `${r.id}: control="${r.control}" but declaredShape="${r.declared}" — allowed for "${r.control}": [${CONTROL_DATA_SHAPE_COMPATIBILITY[r.control].join(", ")}]`,
      );
    expect(
      mismatches,
      `Control-type ↔ data-shape mismatches:\n  ${mismatches.join("\n  ")}\n\n` +
        `Fix either side:\n` +
        `  - Change contract.control to a primitive that handles the declared shape, OR\n` +
        `  - Fix the storage shape upstream (lib/types/json-fields.ts).\n` +
        `If the mismatch is intentional/deferred, add the contract id to CONTROL_SHAPE_EXEMPT ` +
        `with a >20-char reason AND bump EXPECTED_EXEMPT_COUNT.`,
    ).toEqual([]);
  });

  it("exempt list ratchet — count matches EXPECTED_EXEMPT_COUNT", () => {
    const exemptIds = Object.keys(CONTROL_SHAPE_EXEMPT);
    expect(
      exemptIds.length,
      `Exempt-list size drifted from ${EXPECTED_EXEMPT_COUNT}. ` +
        `If you wired a fix + removed an entry, drop EXPECTED_EXEMPT_COUNT down. ` +
        `If you added an entry, pause: was that intentional? Fix the mismatch first. ` +
        `Current entries: ${exemptIds.join(", ")}`,
    ).toBe(EXPECTED_EXEMPT_COUNT);
  });

  it("every exempt entry has a non-empty reason (>20 chars)", () => {
    for (const [id, entry] of Object.entries(CONTROL_SHAPE_EXEMPT)) {
      expect(entry.reason.trim().length, `${id}: short reason`).toBeGreaterThan(
        20,
      );
    }
  });

  it("no exempt entry is stale (each id still appears in JOURNEY_SETTINGS / VOICE_SETTINGS)", () => {
    const knownIds = new Set(all.map((c) => c.id));
    const stale = Object.keys(CONTROL_SHAPE_EXEMPT).filter(
      (id) => !knownIds.has(id),
    );
    expect(
      stale,
      `Exempt entries with no matching registry contract — registry deleted the setting; remove the exempt row: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no DECLARED_DATA_SHAPE row is stale (each id still appears in the registry)", () => {
    const knownIds = new Set(all.map((c) => c.id));
    const stale = Object.keys(DECLARED_DATA_SHAPE).filter(
      (id) => !knownIds.has(id),
    );
    expect(
      stale,
      `DECLARED_DATA_SHAPE rows with no matching registry contract — contract was renamed/deleted; remove the row: ${stale.join(", ")}`,
    ).toEqual([]);
  });

  it("no exempt entry is contradicted by an actual valid pairing", () => {
    // If a contract is in the exempt list but its (control, declared)
    // pair IS compatible per the matrix, the exempt entry is stale —
    // the mismatch was fixed and the entry should be removed.
    const contradicted: string[] = [];
    for (const id of Object.keys(CONTROL_SHAPE_EXEMPT)) {
      const c = all.find((x) => x.id === id);
      if (!c) continue;
      const declared = DECLARED_DATA_SHAPE[c.id];
      if (declared === undefined) continue;
      const allowed = CONTROL_DATA_SHAPE_COMPATIBILITY[c.control];
      if (allowed.includes(declared)) {
        contradicted.push(
          `${id} (control "${c.control}" + shape "${declared}" is now valid; remove from CONTROL_SHAPE_EXEMPT)`,
        );
      }
    }
    expect(
      contradicted,
      `Exempt entries that are no longer mismatches — remove from CONTROL_SHAPE_EXEMPT:\n  ${contradicted.join("\n  ")}`,
    ).toEqual([]);
  });

  it("classification distribution sanity (operator-facing log)", () => {
    const counts: Record<Classification, number> = {
      valid: 0,
      exempt: 0,
      mismatch: 0,
      "missing-declaration": 0,
    };
    for (const r of results) counts[r.classification]++;
    const sum = Object.values(counts).reduce((s, n) => s + n, 0);
    expect(sum, "classifier sum equals input size").toBe(all.length);
  });
});
