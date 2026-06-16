/**
 * Registry ↔ Schema coverage — the 5th Lattice piece (post-Slice-C audit).
 *
 * **What this test pins:**
 *  Every educator-facing field in `PlaybookConfig` (+ sub-interfaces:
 *  `IntakeConfig`, `NpsConfig`, `OffboardingConfig`, `progressNarrative`,
 *  `offboardingSummary`, `firstCall.*`, `priorCallRecap.*`,
 *  `tolerances.*`, `talkTimeBudgets.*`) MUST be either:
 *    (a) covered by a `JourneySettingContract.storagePath` in
 *        `JOURNEY_SETTINGS` or `VOICE_SETTINGS`, OR
 *    (b) explicitly listed in `REGISTRY_EXEMPT_PATHS` below with a
 *        documented reason (wizard-owned, internal, derived, etc.).
 *
 * **Why this exists:**
 *  Slice C of epic #1675 (#1721 / #1736 / #1753 / #1772) shipped
 *  beautiful structural hardening — bucket reshape, ESLint guard,
 *  ADR, CONTRACTS doc — while the registry itself was ~20 entries
 *  short. The 4 Lattice pillars catch INTEGRITY problems within the
 *  registry; none of them catch COVERAGE against the canonical
 *  schema. This test is the missing 5th piece.
 *
 *  See `docs/decisions/2026-06-16-registry-schema-coverage.md` for
 *  the ADR + the BA-failure post-mortem that drove it.
 *
 * **How to fix a failure:**
 *  When this test fails on "uncovered schema path X":
 *    1. Best: add a `JourneySettingContract` for X with the right
 *       control type + bucket + previewLocators. Then remove X from
 *       any exempt list.
 *    2. Acceptable: add X to `REGISTRY_EXEMPT_PATHS` with a one-line
 *       reason. Use this for fields the registry intentionally
 *       doesn't surface (wizard-owned, internal, derived).
 *    3. Never: skip the test. The failure is the discipline.
 *
 *  When a new `PlaybookConfig` field is added:
 *    1. The author MUST also add the path to `EXPECTED_SCHEMA_PATHS`
 *       below — same PR, no exceptions. This is the discipline that
 *       prevents drift.
 *    2. Choose option 1 or 2 above for the new path.
 *
 *  When a `PlaybookConfig` field is renamed / removed:
 *    1. Remove the old path from `EXPECTED_SCHEMA_PATHS`.
 *    2. Add the new path (option 1 or 2).
 */

import { describe, it, expect } from "vitest";

import { JOURNEY_SETTINGS } from "@/lib/journey/setting-contracts.entries";
import { VOICE_SETTINGS } from "@/lib/settings/voice-setting-contracts";
import type { JourneySettingContract } from "@/lib/journey/setting-contracts";

// ─────────────────────────────────────────────────────────────────────
// EXPECTED_SCHEMA_PATHS — every educator-facing PlaybookConfig field
// path. Add a row whenever a new field lands in
// `lib/types/json-fields.ts::PlaybookConfig` (or any nested interface
// that reaches PlaybookConfig).
//
// Format: `path` → source PR / context (kept for audit trail).
// ─────────────────────────────────────────────────────────────────────
const EXPECTED_SCHEMA_PATHS: Record<string, string> = {
  // ── Base IntakeConfig (sessionFlow.intake) ────────────────────────
  "sessionFlow.intake.goals": "base — pre-call goal capture toggle",
  "sessionFlow.intake.aboutYou": "base — About You block toggle",
  "sessionFlow.intake.knowledgeCheck": "base — knowledge check toggle",
  "sessionFlow.intake.knowledgeCheck.deliveryMode":
    "#222 — mcq vs socratic delivery",
  "sessionFlow.intake.aiIntroCall": "base — AI Intro Call toggle",

  // ── sessionFlow.* siblings ────────────────────────────────────────
  "sessionFlow.welcomeMessage": "base — course-level greeting",
  "sessionFlow.offboarding": "ADR 2026-04-29 — phase list",
  "sessionFlow.stops.preTest": "ADR 2026-04-29 — pre-test stop",
  "sessionFlow.stops.midJourney": "ADR 2026-04-29 — mid-journey stop",
  "sessionFlow.stops.midJourney.trigger": "ADR 2026-04-29 — trigger config",
  "sessionFlow.stops.nps": "ADR 2026-04-29 — NPS stop",
  "sessionFlow.stops.postTest": "ADR 2026-04-29 — post-test stop",

  // ── config.* top-level ────────────────────────────────────────────
  "config.welcomeMessage":
    "base — course-scoped welcome override (canonical covered via sessionFlow.welcomeMessage)",
  "config.firstCallCourseIntro": "#1403 — first-call intro line",
  "config.firstCallWaitForAck": "#1403 — wait-for-ack mode",
  "config.firstCallMode": "#790 — first-call mode override",
  "config.firstCallCurriculumFocus":
    "#494 — which modules can be taught on Call 1",
  "config.firstCall.durationMinsOverride":
    "#598 — Call-1 only duration override",
  "config.firstCall.introducePedagogy":
    "#598 — Call-1 pedagogy intro suppression",
  "config.firstCall.firstCallModuleVisibility":
    "#1405 — module-name visibility gate on Call 1",
  "config.shareMaterials": "#234 — AI may share PDFs / reference docs",
  "config.skillScoringEmaHalfLifeDays":
    "#417 — per-skill EMA half-life override",
  "config.skillMinCallsToFull": "#417 — first-call cap factor",
  "config.skillTierMapping": "#417 Story C — per-playbook tier+band mapping",
  "config.tierPresetId": "#1119 — IELTS mode for PROSODY",
  "config.progressNarrative.enabled":
    "#779 Felt Progress S1 — mid-call mastery section off-switch",
  "config.progressNarrative.cadence":
    "#779 Felt Progress S1 — every_call vs on_threshold_crossing",
  "config.progressNarrative.minScoreDelta":
    "#779 Felt Progress S1 — threshold for on_threshold_crossing",
  "config.progressNarrative.skipFirstCall":
    "#779 Felt Progress S1 — suppress on call 1",
  "config.offboardingSummary.enabled":
    "#780 Felt Progress S2 — offboarding summary off-switch",
  "config.offboardingSummary.cadence":
    "#780 Felt Progress S2 — final_only vs every_session_with_data",
  "config.offboardingSummary.includeModuleMastery": "#780 — module mastery toggle",
  "config.offboardingSummary.includeGoalProgress": "#780 — goal progress toggle",
  "config.offboardingSummary.includeSkillCurrentScore":
    "#780 — skill current score toggle",
  "config.tolerances.masteryThreshold":
    "#598 Slice 1 — mastery threshold override",
  "config.tolerances.retrievalCadenceOverride":
    "#598 Slice 1 — retrieval cadence override",
  "config.tolerances.memoryDecayScale":
    "#598 Slice 1 — memory decay scale override",
  "config.tolerances.carryForwardBoost":
    "#918 — carry-forward TP priority boost",
  "config.talkTimeBudgets":
    "#1747 Theme 7 — talkTime budget object (sub-fields editable in JSON editor)",
  "config.priorCallRecap.enabled": "#599 Slice 1 — recap synthesis off-switch",
  "config.priorCallRecap.depth": "#599 Slice 1 — depth picker",
  "config.priorCallRecap.dailyCap": "#599 Slice 1 — cost-control cap",
  "config.strictPrerequisites":
    "#494 E2 — hard-lock terminal modules with unmet prerequisites",
  "config.interleaveReviewMinDays":
    "#492 E3 — interleave-review freshness threshold",
  "config.completionMode":
    "#494 E2 — when the course counts as 'done'",
  "config.recapEnabled": "base — opening recap toggle",
  "config.openingRecapEnabled": "base — opening recap toggle",
  "config.recapSynthesisEnabled": "base — recap synthesis on/off",
  "config.priorCallFeedbackEnabled": "base — prior call feedback",
  "config.assessmentReadinessThreshold": "base — readiness threshold",
  "config.baselineAssessmentDepth": "base — baseline assessment depth",
  "config.modePolicy": "base — mode policy",
  "config.moduleSequencePolicy": "base — module sequence policy",
  "config.moduleVisibility": "base — module visibility rules",
  "config.callCountPolicy": "base — call count policy",
  "config.maxCallsPerDay": "base — max calls per day",
  "config.loMasteryThreshold": "base — LO mastery threshold",
  "config.maxMasteryTier": "base — max mastery tier",
  "config.useFreshMastery": "base — fresh mastery flag",
  "config.scoringMode": "base — scoring mode",
  "config.teachingStyle": "base — teaching style",
  "config.intakeConsentFlow": "base — consent / disclosure flow",
  "config.skipIntakeIfReturning":
    "base — skip intake for returning learners",
  "config.rewardStrategy": "base — reward strategy (operator-only)",
  "config.completionCriteria": "base — completion criteria",
  "config.agentTunerNlpEnabled":
    "base — agent tuner NLP (operator-only)",
  "config.interruptSensitivity": "base — interrupt sensitivity slider",
  "config.offboardingCertificate":
    "base — certificate on completion toggle",
  "config.progressSignals.highWater": "base — high-water threshold",
  "config.progressSignals.lowWater": "base — low-water threshold",

  // ── NpsConfig (config.nps.*) ──────────────────────────────────────
  "config.nps.enabled": "base — NPS enabled toggle",
  "config.nps.trigger": "base — mastery vs session_count trigger",
  "config.nps.threshold": "base — NPS trigger threshold",

  // ── OffboardingConfig (config.offboarding.*) ──────────────────────
  "config.offboarding.triggerAfterCalls":
    "base — when offboarding fires",
  "config.offboarding.bannerMessage":
    "base — progress page banner message",
  "config.offboarding.phases": "base — offboarding phase list",

  // ── Modules (config.modules[].settings.*) — G8 module-scoped ─────
  "config.modules[].settings.closingLine": "#1701 Theme 1 — closing line",
  "config.modules[].settings.cueCardPool":
    "#1701 Theme 1 — cue card pool",
  "config.modules[].settings.firstTimeOrientationLine":
    "#1701 Theme 1 — first-time orientation line",
  "config.modules[].settings.minSpeakingSec":
    "#1701 Theme 1 — minimum learner speaking seconds",
  "config.modules[].settings.questionTarget":
    "#1701 Theme 1 — question target",
  "config.modules[].settings.scheduledCues":
    "#1701 Theme 1 — scheduled cues",

  // ── Voice (playbook.voiceConfig.* + domain.voiceConfig.*) ─────────
  // Already covered by VOICE_SETTINGS — voice-config cascade.
  "playbook.voiceConfig.voiceProvider": "voice — TTS provider",
  "playbook.voiceConfig.voiceId": "voice — voice ID",
  "playbook.voiceConfig.voiceSpeed": "voice — voice speed",
  "playbook.voiceConfig.voicePitch": "voice — voice pitch",
  "playbook.voiceConfig.backgroundSound": "voice — ambient sound",
  "playbook.voiceConfig.silenceThreshold": "voice — silence threshold",
  "playbook.voiceConfig.silenceTimeoutSeconds":
    "voice — end-call after silence",
  "playbook.voiceConfig.maxDurationSeconds":
    "voice — max call duration",
  "playbook.voiceConfig.phoneNumber":
    "voice — outbound phone number (operator-only)",
  "playbook.voiceConfig.vapiAssistantId":
    "voice — VAPI assistant ID (operator-only)",

  // ── Domain cascade roots ──────────────────────────────────────────
  // These exist as cascadeSources; the registry surfaces them via the
  // course-scoped sibling entry above.
  "domain.welcomeMessage": "cascade root for welcomeMessage",
  "domain.onboardingFlowPhases": "cascade root for onboarding phases",
  "domain.offboardingFlowPhases":
    "cascade root for offboarding phases (#1701)",
  "domain.consentFlowDefault":
    "cascade root for intakeConsentFlow",
  "domain.firstCallTargetsDefault":
    "cascade root for first-call BehaviorTarget defaults",
  "domain.skillTierMappingDefault":
    "cascade root for skillTierMapping",
  "domain.teachingStyleDefault": "cascade root for teachingStyle",
  "domain.onboardingIdentitySpecId": "cascade root for intakeSpecId",
  "domain.voiceConfig.voiceProvider": "voice cascade root",
  "domain.voiceConfig.voiceId": "voice cascade root",
  "domain.voiceConfig.voiceSpeed": "voice cascade root",
  "domain.voiceConfig.voicePitch": "voice cascade root",
  "domain.voiceConfig.backgroundSound": "voice cascade root",
  "domain.voiceConfig.silenceThreshold": "voice cascade root",
  "domain.voiceConfig.silenceTimeoutSeconds": "voice cascade root",
  "domain.voiceConfig.maxDurationSeconds": "voice cascade root",

  // ── BehaviorTargets — own model, not PlaybookConfig.* ────────────
  "behaviorTargets[]": "first-call BehaviorTarget slider repeater",

  // ── Tolerances (top-level config.tolerances.*) for skills ───────
  "tolerances.accuracy": "skills tolerances — accuracy",
  "tolerances.confidence": "skills tolerances — confidence",
  "tolerances.engagement": "skills tolerances — engagement",
  "tolerances.fluency": "skills tolerances — fluency",

  // ── wizard-owned PlaybookConfig fields (in exempt below) ─────────
  "config.physicalMaterials": "wizard-owned: course identity",
  "config.audience": "wizard-owned: course identity",
  "config.constraints": "wizard-owned: pedagogy anti-patterns",
  "config.interactionPattern": "wizard-owned: HOW axis",
  "config.teachingMode": "wizard-owned: WHAT axis",
  "config.subjectDiscipline": "wizard-owned: discipline",
  "config.suggestedSessionCount": "wizard-owned: session-count suggestion",
  "config.sessionCount": "wizard-owned: session count",
  "config.durationMins": "wizard-owned: session duration",
  "config.emphasis": "wizard-owned: breadth vs depth",
  "config.assessments": "wizard-owned: formal / light / none",
  "config.lessonPlanMode": "wizard-owned: structured vs continuous",
  "config.lessonPlanModel": "wizard-owned: pedagogy model",
  "config.courseLearningOutcomes": "wizard-owned: outcomes list",
  "config.courseContext": "wizard-owned: context blob",

  // ── internal / engine-only PlaybookConfig fields ─────────────────
  "config.systemSpecToggles": "internal: spec toggles",
  "config.goals": "internal: goal templates",
  "config.onboardingFlowPhases":
    "internal: deprecated parallel field, covered via sessionFlow",
  "config.welcome": "internal: deprecated WelcomeConfig alias",
  "config.surveys": "internal: legacy surveys (back-compat)",
  "config.assessment": "internal: legacy assessment shape",
  "config.firstSessionTargets":
    "internal: BehaviorTarget overrides — via firstCallTargets primitive",
  "config.modulesAuthored": "internal: module catalogue flag",
  "config.moduleSource": "internal: module source kind",
  "config.moduleSourceRef": "internal: module source ref",
  "config.modules":
    "internal: AuthoredModule array — sub-fields covered separately",
  "config.moduleDefaults": "internal: per-module defaults",
  "config.outcomes": "internal: outcome statements map",
  "config.pickerLayout": "internal: picker layout config",
  "config.validationWarnings": "internal: parse warnings",
  "config.demoScript":
    "internal: never-compose demo annotation (#1493)",
};

// ─────────────────────────────────────────────────────────────────────
// REGISTRY_EXEMPT_PATHS — schema paths intentionally NOT in the
// registry. Each entry MUST carry a one-line reason. Three legitimate
// categories:
//   - "wizard-owned": the wizard manages this; educator never edits
//     directly in the journey Inspector.
//   - "internal": engine config, never surfaced to operators.
//   - "derived": value is computed at read time, never written by an
//     editor.
//
// **Catch-up exemption block (the 20 known misses):** until each
// missing contract lands, the schema path lives here. When the
// contract ships, the path moves out of exempt into the
// `EXPECTED_SCHEMA_PATHS` covered set. The whole "catch-up" sub-block
// should be empty by the end of the contract-add follow-on PRs.
// ─────────────────────────────────────────────────────────────────────
const REGISTRY_EXEMPT_PATHS: Record<string, string> = {
  // ── catch-up exemption block ──────────────────────────────────────
  // These will graduate to covered as each contract lands. The exempt
  // entry exists so CI doesn't block the structural test ship while we
  // queue the contract-add PRs.
  // ── A_intake — graduated to contracts (Lane 3 PR1) ───────────────
  // The 3 A_intake catch-up exempts moved into the registry:
  //   - intakeGoals → sessionFlow.intake.goals
  //   - intakeAiIntroCall → sessionFlow.intake.aiIntroCall (user-spotted gap)
  //   - intakeKnowledgeCheckMode → sessionFlow.intake.knowledgeCheck.deliveryMode
  // Coverage is satisfied via getStoragePathString lookup over
  // JOURNEY_SETTINGS.
  // ── B_call1_opening — graduated to contracts (Lane 3 PR2) ────────
  // The 4 B_call1_opening catch-up exempts moved into the registry:
  //   - firstCallCourseIntro → config.firstCallCourseIntro (#1403)
  //   - firstCallWaitForAck → config.firstCallWaitForAck (#1403)
  //   - firstCallDurationOverride → config.firstCall.durationMinsOverride (#598)
  //   - firstCallIntroducePedagogy → config.firstCall.introducePedagogy (#598)
  // ── B_call1_opening firstCallModuleVisibility — graduated (Lane 3 PR9)
  // Disambiguated from the course-wide moduleVisibility: this contract
  // covers only Call-1 framing/orientation, learner's pick still wins.
  // ── C_teaching_style — graduated to contract (Lane 3 PR3) ────────
  //   - shareMaterials → config.shareMaterials (#234)
  // ── I_scoring — graduated to contracts (Lane 3 PR4) ──────────────
  //   - tierPresetId → config.tierPresetId (#1119)
  //   - skillMinCallsToFull → config.skillMinCallsToFull (#417)
  // ── J_feedback — graduated to contracts (Lane 3 PR7) ─────────────
  //   - progressNarrativeEnabled / Cadence / Threshold / SkipFirstCall (#779)
  //   - priorCallRecapEnabled / Depth / DailyCap (#599)
  // ── M_end_of_course — offboardingSummary.* graduated (Lane 3 PR8) ─
  //   - offboardingSummaryEnabled / Cadence / IncludeModuleMastery
  //     / IncludeGoalProgress / IncludeSkillScore (#780)
  // ── config.tolerances.* — graduated to contracts (Lane 3 PR9) ────
  // Buckets assigned by educator concern:
  //   - tolMasteryThreshold → I_scoring
  //   - tolRetrievalCadence → K_between_calls
  //   - tolMemoryDecay → K_between_calls
  //   - tolCarryForwardBoost → D_question_flow
  // ── strictPrerequisites + completionMode — graduated (Lane 3 PR9) ─
  // Disambiguated: completionMode (module-set coverage) is distinct
  // from completionCriteria (module-vs-LO granularity); strictPrerequisites
  // controls picker hard-lock vs soft-warning.
  // ── K_between_calls — graduated to contract (Lane 3 PR5) ─────────
  //   - interleaveReviewMinDays → config.interleaveReviewMinDays (#492)
  // ── L_mid_journey — graduated to contracts (Lane 3 PR6) ──────────
  //   - npsEnabled → config.nps.enabled
  //   - npsTrigger → config.nps.trigger
  //   - npsThreshold → config.nps.threshold
  // M_end_of_course offboarding.triggerAfterCalls + bannerMessage
  // graduated (Lane 3 PR8).
  "config.offboarding.phases":
    "legacy: covered via sessionFlow.offboarding (canonical) — dual-read window",
  "config.welcomeMessage":
    "legacy: covered via sessionFlow.welcomeMessage (canonical) — dual-read window",

  // ── legitimate exempts (stay here permanently) ────────────────────

  // wizard-owned: course identity + audience + pedagogy choices the
  // wizard captures, never surfaced as standalone Journey settings.
  "config.physicalMaterials": "wizard-owned: course identity",
  "config.audience": "wizard-owned: course identity",
  "config.constraints": "wizard-owned: pedagogy anti-patterns",
  "config.interactionPattern": "wizard-owned: HOW axis",
  "config.teachingMode": "wizard-owned: WHAT axis",
  "config.subjectDiscipline": "wizard-owned: discipline",
  "config.suggestedSessionCount": "wizard-owned: session-count suggestion",
  "config.sessionCount": "wizard-owned: session count",
  "config.durationMins": "wizard-owned: session duration",
  "config.emphasis": "wizard-owned: breadth vs depth",
  "config.assessments": "wizard-owned: formal / light / none",
  "config.lessonPlanMode": "wizard-owned: structured vs continuous",
  "config.lessonPlanModel": "wizard-owned: direct_instruction / socratic / …",
  "config.courseLearningOutcomes": "wizard-owned: course outcomes",
  "config.courseContext": "wizard-owned: course context blob",

  // internal: engine + author tooling, never operator-edited.
  "config.systemSpecToggles": "internal: spec toggles",
  "config.goals": "internal: goal templates (managed via Goals editor)",
  "config.onboardingFlowPhases":
    "internal: deprecated parallel field, covered via sessionFlow",
  "config.welcome":
    "internal: deprecated WelcomeConfig alias for IntakeConfig",
  "config.surveys": "internal: legacy surveys (back-compat)",
  "config.assessment":
    "internal: legacy assessment shape, covered via stops",
  "config.firstSessionTargets":
    "internal: BehaviorTarget overrides — surfaced via firstCallTargets compound primitive",
  "config.modulesAuthored":
    "internal: author-declared module catalogue flag",
  "config.moduleSource": "internal: module source kind",
  "config.moduleSourceRef": "internal: module source ref",
  "config.modules": "internal: AuthoredModule array — surfaced via curriculum tab",
  "config.moduleDefaults": "internal: per-module defaults block",
  "config.outcomes": "internal: outcome statements map",
  "config.pickerLayout": "internal: picker layout config",
  "config.validationWarnings": "internal: parse warnings",
  "config.demoScript":
    "internal: never-compose demo annotation (#1493) — explicitly NOT in prompt assembly",
};

// ─────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────

function getStoragePathString(c: JourneySettingContract): string {
  if (typeof c.storagePath === "string") return c.storagePath;
  return c.storagePath.path;
}

function buildCoveredPaths(): Set<string> {
  const out = new Set<string>();
  for (const c of [...JOURNEY_SETTINGS, ...VOICE_SETTINGS]) {
    out.add(getStoragePathString(c));
    // Cascade sources are also "covered" — they're the layer roots the
    // contract reads from. Coverage is satisfied when a contract names
    // a path either as its storage target OR as a cascade source.
    for (const src of c.cascadeSources) {
      out.add(src.storagePath);
    }
  }
  return out;
}

describe("Registry ↔ Schema coverage — 5th Lattice piece", () => {
  const covered = buildCoveredPaths();
  const expected = Object.keys(EXPECTED_SCHEMA_PATHS);
  const exempt = new Set(Object.keys(REGISTRY_EXEMPT_PATHS));

  it("every EXPECTED_SCHEMA_PATH is either covered by registry OR in REGISTRY_EXEMPT_PATHS", () => {
    const uncovered: string[] = [];
    for (const path of expected) {
      if (covered.has(path)) continue;
      if (exempt.has(path)) continue;
      uncovered.push(path);
    }
    expect(
      uncovered,
      `Schema paths with no registry contract and no exempt entry — add a JourneySettingContract or document in REGISTRY_EXEMPT_PATHS:\n  ${uncovered.join("\n  ")}`,
    ).toEqual([]);
  });

  it("REGISTRY_EXEMPT_PATHS only contains paths actually in EXPECTED_SCHEMA_PATHS", () => {
    const expectedSet = new Set(expected);
    const stale: string[] = [];
    for (const path of exempt) {
      if (!expectedSet.has(path)) stale.push(path);
    }
    expect(
      stale,
      `Exempt paths no longer in EXPECTED_SCHEMA_PATHS — remove from REGISTRY_EXEMPT_PATHS:\n  ${stale.join("\n  ")}`,
    ).toEqual([]);
  });

  it("no path is BOTH covered and exempt (drift signal)", () => {
    const both: string[] = [];
    for (const path of exempt) {
      if (covered.has(path)) both.push(path);
    }
    expect(
      both,
      `Paths covered by registry AND in REGISTRY_EXEMPT_PATHS — remove the exempt entry:\n  ${both.join("\n  ")}`,
    ).toEqual([]);
  });

  it("every REGISTRY_EXEMPT_PATHS entry has a non-empty reason", () => {
    const noReason: string[] = [];
    for (const [path, reason] of Object.entries(REGISTRY_EXEMPT_PATHS)) {
      if (!reason || !reason.trim()) noReason.push(path);
    }
    expect(noReason, "exempt entries with empty reason").toEqual([]);
  });

  it("expected schema-path count is non-trivial (regression sentinel)", () => {
    // Sentinel: if this number drops sharply, someone deleted the
    // catalogue. Adjust deliberately, never silently.
    expect(expected.length).toBeGreaterThanOrEqual(80);
  });

  it("catch-up exempt count only goes DOWN — ratchet (Lane 3 follow-on)", () => {
    // Lane 1 of the registry-schema-coverage ship locked in the
    // baseline catch-up exemption count. Each Lane 3 follow-on PR
    // adds a contract + deletes the exempt entry → this count drops.
    // The number above the assertion is the **ceiling**, not the
    // floor. If it ever goes UP, someone added a schema field
    // without a contract and exempted it instead — that's the drift
    // class this test exists to catch.
    const catchUpCount = Array.from(exempt).filter((path) =>
      REGISTRY_EXEMPT_PATHS[path]?.startsWith("catch-up:"),
    ).length;
    // Lane 3 PR1 (A_intake) — ratchet dropped 36 → 33 as the 3 A_intake
    // exempts graduated to contracts.
    // Lane 3 PR2 (B_call1_opening) — ratchet dropped 33 → 29 as the 4
    // B_call1_opening exempts graduated to contracts.
    // Lane 3 PR3 (C_teaching_style) — ratchet dropped 29 → 28.
    // Lane 3 PR4 (I_scoring) — ratchet dropped 28 → 26.
    // Lane 3 PR5 (K_between_calls) — ratchet dropped 26 → 25.
    // Lane 3 PR6 (L_mid_journey) — ratchet dropped 25 → 22.
    // Lane 3 PR7 (J_feedback) — ratchet dropped 22 → 15 (4 progress + 3 recap).
    // Lane 3 PR9 (final) — ratchet hits 0. All 35 originally-spotted
    // gaps from the Slice C BA-failure recovery have shipped contracts.
    // Future drift is structurally caught by the coverage check.
    const BASELINE_CATCH_UP_CEILING = 0;
    expect(
      catchUpCount,
      `catch-up exempts: ${catchUpCount} (ceiling ${BASELINE_CATCH_UP_CEILING}). If this went UP, you exempted a new field — add the contract instead.`,
    ).toBeLessThanOrEqual(BASELINE_CATCH_UP_CEILING);
  });
});
