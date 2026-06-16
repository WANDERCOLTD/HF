/**
 * Journey setting registry — authoritative entries for all 45 journey-
 * affecting settings. Voice settings live in
 * `lib/settings/voice-setting-contracts.ts`.
 *
 * AUTHORING PROCESS:
 *   1. Each entry is hand-curated. TypeScript can't infer
 *      educatorLabel / group / control / preview locators from the
 *      storage type alone.
 *   2. The completeness vitest (`tests/lib/journey/registry-completeness.test.ts`)
 *      catches typos in section keys, dangling auto-enable targets,
 *      duplicate ids, and group-count mismatches.
 *   3. Order entries by `group` then by their journey-time anchor.
 *   4. composeImpact.requiresReprompt: TRUE only when the setting feeds
 *      a section that recomposes via an AI step (priorCallRecap, etc.).
 *      Live diff in Preview is the default.
 *
 * The 45 entries map 1:1 to the table in issue #1676. See
 * `docs/CONTRACTS-JOURNEY.md` for the chain (setting → composer-section
 * → preview-bubble).
 */

import type {
  JourneySettingContract,
} from "./setting-contracts";
import type { JourneyGroup } from "./setting-groups";

// =============================================================
// G1 — Sign-up & Intake (5)
// =============================================================

const G1_INTAKE_SPEC_ID: JourneySettingContract = {
  id: "intakeSpecId",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Intake form",
  helpText: "Which IntakeSpec the learner fills in before Call 1.",
  storagePath: "domain.onboardingIdentitySpecId",
  control: "select",
  cascadeSources: [
    { level: "domain", storagePath: "domain.onboardingIdentitySpecId" },
  ],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-content"],
    // operator-only with compose impact → must reprompt (AC §6 rule 11)
    requiresReprompt: true,
  },
  previewLocators: [{ section: "intake", hint: "intake spec questions" }],
  writeGate: "operator-only",
};

const G1_INTAKE_KNOWLEDGE_CHECK: JourneySettingContract = {
  id: "intakeKnowledgeCheck",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Knowledge check on sign-up",
  helpText: "Brief MCQ or Socratic probe in the sign-up form.",
  storagePath: "sessionFlow.intake.knowledgeCheck",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "intake", hint: "knowledge check block" }],
};

const G1_INTAKE_ABOUT_YOU: JourneySettingContract = {
  id: "intakeAboutYou",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: '"About you" questions',
  helpText: 'Show the "About you" block in the sign-up form.',
  storagePath: "sessionFlow.intake.aboutYou",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "intake", hint: "about-you block" }],
};

// Lane 3 — A_intake contracts (catch-up follow-on from #1780).
// The "AI Intro Call" bubble was the originally-spotted gap (operator
// clicked it on the Preview canvas; the Inspector had no control for
// it). This entry closes that gap; sibling entries below complete
// A_intake coverage.

const G1_INTAKE_GOALS: JourneySettingContract = {
  id: "intakeGoals",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Pre-call learner goals",
  helpText:
    "Show the learner-goals capture block in the sign-up form so learners declare what they want to work on before Call 1.",
  storagePath: "sessionFlow.intake.goals",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "intake", hint: "learner-goals block" }],
};

const G1_INTAKE_AI_INTRO_CALL: JourneySettingContract = {
  id: "intakeAiIntroCall",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "AI Intro Call after sign-up",
  helpText:
    "Optional 1–2 min AI call right after sign-up to confirm name + level + give the learner a low-stakes taste of the voice surface before Call 1.",
  storagePath: "sessionFlow.intake.aiIntroCall",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "intake", hint: "AI Intro Call card" }],
};

const G1_INTAKE_KNOWLEDGE_CHECK_MODE: JourneySettingContract = {
  id: "intakeKnowledgeCheckMode",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Knowledge check delivery mode",
  helpText:
    "MCQ batch (post Call 1) vs Socratic probe (in Call 1). Implemented in #222; only relevant when the parent Knowledge check toggle is on.",
  storagePath: "sessionFlow.intake.knowledgeCheck.deliveryMode",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "intake", hint: "knowledge check block" }],
  options: [
    { value: "mcq", label: "MCQ batch (post Call 1)" },
    { value: "socratic", label: "Socratic probe (in Call 1)" },
  ],
};

const G1_INTAKE_SKIP_IF_RETURNING: JourneySettingContract = {
  id: "intakeSkipIfReturning",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Skip intake for returning learners",
  helpText: "When true, learners who completed intake before are bypassed.",
  storagePath: "config.skipIntakeIfReturning",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G1_INTAKE_CONSENT_FLOW: JourneySettingContract = {
  id: "intakeConsentFlow",
  menuGroupKey: "A_intake",
  group: "G1",
  educatorLabel: "Consent / disclosure flow",
  helpText: "Which consent gates run before the learner reaches Call 1.",
  storagePath: "config.intakeConsentFlow",
  control: "select",
  cascadeSources: [
    { level: "domain", storagePath: "domain.consentFlowDefault" },
  ],
  composeImpact: {
    sections: ["intake"],
    kinds: ["section-content", "section-enable"],
    requiresReprompt: true, // operator-only + compose impact (AC §6 rule 11)
  },
  previewLocators: [{ section: "intake", hint: "consent gates" }],
  writeGate: "operator-only",
};

// =============================================================
// G2 — Call 1 — opening & assessment (6)
// =============================================================

const G2_FIRST_CALL_MODE: JourneySettingContract = {
  id: "firstCallMode",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Call 1 mode",
  helpText:
    "Onboarding / Teach Immediately / Baseline Assessment — overall shape of Call 1.",
  storagePath: "config.firstCallMode",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["firstCallMode", "welcome", "onboarding"],
    kinds: ["section-content", "section-enable", "persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [
    { section: "firstCallMode" },
    { section: "welcome", hint: "first bubble" },
  ],
  autoEnableLinks: [
    {
      targetId: "preTestStop",
      whenValue: "baseline_assessment",
      enforce: true,
      decoupleAllowed: true,
      reason:
        "Baseline Assessment mode runs the pre-test stop at the top of Call 1.",
    },
  ],
  options: [
    { value: "onboarding", label: "Onboarding (default)" },
    { value: "teach_immediately", label: "Teach Immediately" },
    { value: "baseline_assessment", label: "Baseline Assessment" },
  ],
};

const G2_WELCOME_MESSAGE: JourneySettingContract = {
  id: "welcomeMessage",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Opening line",
  helpText: "First line the learner hears on Call 1.",
  storagePath: "sessionFlow.welcomeMessage",
  control: "text",
  cascadeSources: [
    { level: "domain", storagePath: "domain.welcomeMessage" },
  ],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "welcome", hint: "first paragraph" }],
};

// Lane 3 PR2 — B_call1_opening contracts (catch-up follow-on from #1780).

const G2_FIRST_CALL_COURSE_INTRO: JourneySettingContract = {
  id: "firstCallCourseIntro",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "First-call intro line",
  helpText:
    "Optional intro line spoken AFTER the welcomeMessage + wait-for-ack gate. Supports the `{courseName}` token. Keeps Call 1 framing consistent across cohorts. (#1403)",
  storagePath: "config.firstCallCourseIntro",
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "welcome", hint: "second paragraph" }],
};

const G2_FIRST_CALL_WAIT_FOR_ACK: JourneySettingContract = {
  id: "firstCallWaitForAck",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Wait after opening",
  helpText:
    "How the AI handles the pause after the welcomeMessage on Call 1. None / wait for any response / wait for greeting words. (#1403)",
  storagePath: "config.firstCallWaitForAck",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome"],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "welcome", hint: "ack-gate cue" }],
  options: [
    { value: "none", label: "No pause" },
    { value: "any_response", label: "Wait for any response" },
    { value: "greeting_words", label: "Wait for greeting words (default)" },
  ],
};

const G2_FIRST_CALL_DURATION_OVERRIDE: JourneySettingContract = {
  id: "firstCallDurationOverride",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Call 1 duration override (minutes)",
  helpText:
    "Override Call 1 duration only. Calls 2+ use the standard durationMins. Useful for shorter assessment-only first calls. (#598)",
  storagePath: "config.firstCall.durationMinsOverride",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: ["firstCallMode"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "firstCallMode", hint: "call-1 duration" }],
};

const G2_FIRST_CALL_INTRODUCE_PEDAGOGY: JourneySettingContract = {
  id: "firstCallIntroducePedagogy",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Introduce pedagogy on Call 1",
  helpText:
    "Whether the AI says \"here's how this works\" on Call 1. Off suppresses the pedagogy intro block. (#598)",
  storagePath: "config.firstCall.introducePedagogy",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["firstCallMode", "onboarding"],
    kinds: ["section-enable", "section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "onboarding", hint: "pedagogy intro" }],
};

const G2_ONBOARDING_FLOW_PHASES: JourneySettingContract = {
  id: "onboardingFlowPhases",
  menuGroupKey: "G_session_length",
  group: "G2",
  educatorLabel: "Onboarding flow phases",
  helpText: "Phases the AI walks through after the welcome line on Call 1.",
  storagePath: "domain.onboardingFlowPhases",
  control: "phases",
  cascadeSources: [
    { level: "domain", storagePath: "domain.onboardingFlowPhases" },
  ],
  composeImpact: {
    sections: ["onboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "onboarding", hint: "phase list" }],
};

const G2_FIRST_CALL_TARGETS: JourneySettingContract = {
  id: "firstCallTargets",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Call 1 skill targets",
  helpText: "Per-parameter targets applied only to Call 1.",
  storagePath: {
    path: "behaviorTargets[]",
    arrayKey: "scope",
    selectorValue: "firstCall",
    writeMode: "merge",
  },
  control: "targets",
  cascadeSources: [
    { level: "domain", storagePath: "domain.firstCallTargetsDefault" },
  ],
  composeImpact: {
    sections: ["behaviorTargets"],
    kinds: ["scoring-weight", "cascade-override"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "behaviorTargets", hint: "first-call slider block" }],
};

const G2_PRE_TEST_STOP: JourneySettingContract = {
  id: "preTestStop",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Pre-test stop",
  helpText: "Gate the start of Call 1 with a quick assessment.",
  storagePath: "sessionFlow.stops.preTest",
  control: "stop",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate", "instructions"],
    kinds: ["section-enable", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "pre-test block" }],
};

const G2_BASELINE_ASSESSMENT_DEPTH: JourneySettingContract = {
  id: "baselineAssessmentDepth",
  menuGroupKey: "B_call1_opening",
  group: "G2",
  educatorLabel: "Baseline assessment depth",
  helpText: "How thorough the baseline assessment is (light / standard / deep).",
  storagePath: "config.baselineAssessmentDepth",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["firstCallMode", "instructions"],
    kinds: ["section-content", "scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "firstCallMode", hint: "assessment depth" }],
  options: [
    { value: "light", label: "Light — 3 questions" },
    { value: "standard", label: "Standard — 5 questions" },
    { value: "deep", label: "Deep — 8 questions" },
  ],
};

// =============================================================
// G3 — Call 1 — teaching (4)
// =============================================================

const G3_TEACHING_STYLE: JourneySettingContract = {
  id: "teachingStyle",
  menuGroupKey: "C_teaching_style",
  group: "G3",
  educatorLabel: "Teaching style",
  helpText: "Socratic / Direct / Adaptive — how the AI explains things on Call 1.",
  storagePath: "config.teachingStyle",
  control: "select",
  cascadeSources: [
    { level: "domain", storagePath: "domain.teachingStyleDefault" },
  ],
  composeImpact: {
    sections: ["instructions", "modePolicy"],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modePolicy" }],
  options: [
    { value: "socratic", label: "Socratic — ask, don't tell" },
    { value: "direct", label: "Direct — explain and check" },
    { value: "adaptive", label: "Adaptive — read the room" },
  ],
};

const G3_MODULE_SEQUENCE_POLICY: JourneySettingContract = {
  id: "moduleSequencePolicy",
  menuGroupKey: "D_question_flow",
  group: "G3",
  educatorLabel: "Module sequence policy",
  helpText: "Strict prerequisites / interleaved / learner-led on Call 1.",
  storagePath: "config.moduleSequencePolicy",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "module ordering" }],
  options: [
    { value: "strict", label: "Strict prerequisites" },
    { value: "interleaved", label: "Interleaved review" },
    { value: "learner_led", label: "Learner picks next" },
  ],
};

const G3_FIRST_CALL_CURRICULUM_FOCUS: JourneySettingContract = {
  id: "firstCallCurriculumFocus",
  menuGroupKey: "D_question_flow",
  group: "G3",
  educatorLabel: "Call 1 curriculum focus",
  helpText: "Which modules can be taught on Call 1.",
  storagePath: "config.firstCallCurriculumFocus",
  control: "multi-select",
  cascadeSources: [],
  composeImpact: {
    sections: ["firstCallMode", "modulesGate"],
    kinds: ["section-content", "sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "firstCallMode" }],
};

const G3_OPENING_RECAP_ENABLED: JourneySettingContract = {
  id: "openingRecapEnabled",
  menuGroupKey: "J_feedback",
  group: "G3",
  educatorLabel: "Opening recap (Call 1)",
  helpText: "Brief recap of intake answers at the top of Call 1.",
  storagePath: "config.openingRecapEnabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["welcome", "priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "welcome", hint: "after greeting" }],
};

// =============================================================
// G4 — Every call — teaching style (17)
// =============================================================

const G4_MODE_POLICY: JourneySettingContract = {
  id: "modePolicy",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Mode policy (teach / quiz / mix)",
  helpText: "Default mode for calls 2+ — teach, quiz, or mixed.",
  storagePath: "config.modePolicy",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["modePolicy", "instructions"],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modePolicy" }],
  options: [
    { value: "teach", label: "Teach — explain & ask" },
    { value: "quiz", label: "Quiz — drill & test" },
    { value: "mix", label: "Mix — adaptive ratio" },
  ],
};

// Lane 3 PR3 — C_teaching_style contract (catch-up follow-on from #1780).

const G4_SHARE_MATERIALS: JourneySettingContract = {
  id: "shareMaterials",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "AI may share course materials",
  helpText:
    "When on, the AI may share PDFs / reference docs with learners during sessions. Turn off for voice-only courses (IELTS Speaking, conversation practice) where document delivery is pedagogically wrong or technically meaningless. (#234)",
  storagePath: "config.shareMaterials",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions", hint: "materials policy" }],
};

const G4_TOLERANCE_ACCURACY: JourneySettingContract = {
  id: "toleranceAccuracy",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Accuracy tolerance",
  helpText: "How much slack the AI gives on factual accuracy.",
  storagePath: "tolerances.accuracy",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

const G4_TOLERANCE_FLUENCY: JourneySettingContract = {
  id: "toleranceFluency",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Fluency tolerance",
  helpText: "How much slack the AI gives on phrasing fluency.",
  storagePath: "tolerances.fluency",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

const G4_TOLERANCE_CONFIDENCE: JourneySettingContract = {
  id: "toleranceConfidence",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Confidence tolerance",
  helpText: "How much slack the AI gives on confident-sounding answers.",
  storagePath: "tolerances.confidence",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

const G4_TOLERANCE_ENGAGEMENT: JourneySettingContract = {
  id: "toleranceEngagement",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Engagement tolerance",
  helpText: "How much slack the AI gives on learner engagement signals.",
  storagePath: "tolerances.engagement",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

// Lane 3 PR4 — I_scoring contracts (catch-up follow-on from #1780).

const G4_TIER_PRESET_ID: JourneySettingContract = {
  id: "tierPresetId",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Scoring mode preset",
  helpText:
    "When set to `ielts-speaking`, PROSODY calls the speech-assessment provider in IELTS mode and 4 sub-bands flow into the CallScore rows. Otherwise PROSODY scores in generic mode. (#1119)",
  storagePath: "config.tierPresetId",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
  options: [
    { value: "generic", label: "Generic" },
    { value: "ielts-speaking", label: "IELTS Speaking" },
    { value: "cefr", label: "CEFR" },
    { value: "5-level", label: "5-Level" },
    { value: "custom", label: "Custom" },
  ],
};

const G4_SKILL_MIN_CALLS_TO_FULL: JourneySettingContract = {
  id: "skillMinCallsToFull",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "First-call score cap factor",
  helpText:
    "Single-call score is capped at `min(rawScore, callsUsed/N)` until N calls have accumulated. Default 4 (matches IELTS examiner observation budget). Lower for rapid-feedback courses. (#417)",
  storagePath: "config.skillMinCallsToFull",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G4_SKILL_TIER_MAPPING: JourneySettingContract = {
  id: "skillTierMapping",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Skill tier mapping",
  helpText: "Tier labels + thresholds for skill bands.",
  storagePath: "config.skillTierMapping",
  control: "banding",
  cascadeSources: [
    { level: "domain", storagePath: "domain.skillTierMappingDefault" },
  ],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight", "section-content"],
    requiresReprompt: false,
  },
  previewLocators: [
    { section: "moduleMastery", hint: "tier badge" },
    { section: "loMastery", hint: "tier badge" },
  ],
};

const G4_SKILL_SCORING_EMA_HALF_LIFE: JourneySettingContract = {
  id: "skillScoringEmaHalfLife",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Scoring EMA half-life",
  helpText: "Days for the per-skill EMA to decay to half-weight.",
  storagePath: "config.skillScoringEmaHalfLifeDays",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G4_MAX_MASTERY_TIER: JourneySettingContract = {
  id: "maxMasteryTier",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Max mastery tier",
  helpText: "Highest tier the AI will award without operator override.",
  storagePath: "config.maxMasteryTier",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "moduleMastery" }],
  options: [
    { value: "FOUNDATION", label: "Foundation" },
    { value: "DEVELOPING", label: "Developing" },
    { value: "PRACTITIONER", label: "Practitioner" },
    { value: "DISTINCTION", label: "Distinction" },
  ],
};

const G4_USE_FRESH_MASTERY: JourneySettingContract = {
  id: "useFreshMastery",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Use fresh mastery (per-call)",
  helpText:
    "When true, mastery resets per call (exam mode); otherwise rolling.",
  storagePath: "config.useFreshMastery",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "moduleMastery" }],
};

const G4_SCORING_MODE: JourneySettingContract = {
  id: "scoringMode",
  menuGroupKey: "I_scoring",
  group: "G4",
  educatorLabel: "Scoring mode",
  helpText: "Strict / Lenient / Adaptive — how the AI grades answers.",
  storagePath: "config.scoringMode",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
  options: [
    { value: "strict", label: "Strict" },
    { value: "lenient", label: "Lenient" },
    { value: "adaptive", label: "Adaptive" },
  ],
};

// Lane 3 PR7 — J_feedback contracts (catch-up from #1780).

const G4_PROGRESS_NARRATIVE_ENABLED: JourneySettingContract = {
  id: "progressNarrativeEnabled",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Mid-call mastery acknowledgement",
  helpText:
    "Off-switch for the progressNarrative composer section. When on, the AI cites concrete LO scores in mid-call moments. (#779 Felt Progress S1)",
  storagePath: "config.progressNarrative.enabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_PROGRESS_NARRATIVE_CADENCE: JourneySettingContract = {
  id: "progressNarrativeCadence",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Mid-call cadence",
  helpText:
    "When the AI emits LO-mastery evidence. `every_call` fires whenever any LO score > 0; `on_threshold_crossing` only when a score crosses the threshold. (#779)",
  storagePath: "config.progressNarrative.cadence",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
  options: [
    { value: "every_call", label: "Every call" },
    { value: "on_threshold_crossing", label: "Only on threshold crossing" },
  ],
};

const G4_PROGRESS_NARRATIVE_THRESHOLD: JourneySettingContract = {
  id: "progressNarrativeThreshold",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Mid-call threshold",
  helpText:
    "Minimum LO score delta to trigger the mid-call narrative when cadence is `on_threshold_crossing`. Default 0.1. (#779)",
  storagePath: "config.progressNarrative.minScoreDelta",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_PROGRESS_NARRATIVE_SKIP_FIRST: JourneySettingContract = {
  id: "progressNarrativeSkipFirstCall",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Skip on Call 1",
  helpText:
    "Suppress the mid-call narrative on Call 1 (no prior context to compare against). Default true. (#779)",
  storagePath: "config.progressNarrative.skipFirstCall",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G4_PRIOR_CALL_RECAP_ENABLED: JourneySettingContract = {
  id: "priorCallRecapEnabled",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "AI-synthesized recap",
  helpText:
    "When on, the prior-call recap is AI-synthesized (uses depth picker below); when off, the templated minimal recap is used. (#599 Slice 1)",
  storagePath: "config.priorCallRecap.enabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_PRIOR_CALL_RECAP_DEPTH: JourneySettingContract = {
  id: "priorCallRecapDepth",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Recap synthesis depth",
  helpText:
    "Minimal (templated, no AI), standard (2-3 sentences), or rich (3-4 sentences + transcript observation). Only relevant when AI-synthesized recap is on. (#599)",
  storagePath: "config.priorCallRecap.depth",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
  options: [
    { value: "minimal", label: "Minimal (templated)" },
    { value: "standard", label: "Standard (2–3 sentences)" },
    { value: "rich", label: "Rich (3–4 sentences + observation)" },
  ],
};

const G4_PRIOR_CALL_RECAP_DAILY_CAP: JourneySettingContract = {
  id: "priorCallRecapDailyCap",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Recap synthesis daily cap",
  helpText:
    "Per-playbook per-UTC-day cap on recap synthesis AI calls. Default 50; server clamp 500. When the cap is hit, the loader falls back to the templated path. (#599)",
  storagePath: "config.priorCallRecap.dailyCap",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G4_RECAP_ENABLED: JourneySettingContract = {
  id: "recapEnabled",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Recap at call start",
  helpText: "Brief recap of the prior call at the top of calls 2+.",
  storagePath: "config.recapEnabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_RECAP_SYNTHESIS_ENABLED: JourneySettingContract = {
  id: "recapSynthesisEnabled",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "AI recap synthesis",
  helpText: "When true, the recap is AI-synthesised (cost per call).",
  storagePath: "config.recapSynthesisEnabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-content"],
    requiresReprompt: true, // AI-touching → Save & reprompt CTA
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_PRIOR_CALL_FEEDBACK_ENABLED: JourneySettingContract = {
  id: "priorCallFeedbackEnabled",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Show prior-call feedback",
  helpText: "Show the educator's last-call feedback to the learner.",
  storagePath: "config.priorCallFeedbackEnabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["priorCallFeedback"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "priorCallFeedback" }],
};

const G4_AGENT_TUNER_NLP_ENABLED: JourneySettingContract = {
  id: "agentTunerNlpEnabled",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "NLP agent tuner",
  helpText: "Enable the NLP agent-tuner side panel (operator-only).",
  storagePath: "config.agentTunerNlpEnabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [],
  writeGate: "operator-only",
};

const G4_PROGRESS_SIGNAL_LOW_WATER: JourneySettingContract = {
  id: "progressSignalLowWater",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Progress signal — low-water mark",
  helpText: "Below this mastery, the AI emphasises encouragement.",
  storagePath: "config.progressSignals.lowWater",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions", "moduleMastery"],
    kinds: ["scoring-weight", "persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

const G4_PROGRESS_SIGNAL_HIGH_WATER: JourneySettingContract = {
  id: "progressSignalHighWater",
  menuGroupKey: "J_feedback",
  group: "G4",
  educatorLabel: "Progress signal — high-water mark",
  helpText: "Above this mastery, the AI moves toward review / stretch.",
  storagePath: "config.progressSignals.highWater",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions", "moduleMastery"],
    kinds: ["scoring-weight", "persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions" }],
};

/** Cross-registry: this setting also appears in the Voice registry —
 *  documented in `docs/CONTRACTS-JOURNEY.md` §7. Both registries' entries
 *  share the same `storagePath` (pinned by the completeness vitest). */
const G4_INTERRUPT_SENSITIVITY: JourneySettingContract = {
  id: "interruptSensitivity",
  menuGroupKey: "C_teaching_style",
  group: "G4",
  educatorLabel: "Interrupt sensitivity",
  helpText:
    "How quickly the AI yields when the learner starts speaking. Mirror copy lives in Voice settings.",
  storagePath: "config.interruptSensitivity",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["personality"],
    kinds: ["persona-style"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "personality" }],
};

// =============================================================
// G5 — Mid-journey stops (3)
// =============================================================

const G5_MID_JOURNEY_STOP: JourneySettingContract = {
  id: "midJourneyStop",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "Mid-journey stop",
  helpText: "Mid-test or check-in stop between teaching calls.",
  storagePath: "sessionFlow.stops.midJourney",
  control: "stop",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["section-enable", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "mid-journey block" }],
};

const G5_MID_JOURNEY_STOP_TRIGGER: JourneySettingContract = {
  id: "midJourneyStopTrigger",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "Mid-journey stop trigger",
  helpText: "Mastery threshold / session count that fires the stop.",
  storagePath: "sessionFlow.stops.midJourney.trigger",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate" }],
  options: [
    { value: "mastery_threshold", label: "Mastery threshold reached" },
    { value: "session_count", label: "After N sessions" },
  ],
};

// Lane 3 PR6 — L_mid_journey NPS contracts (catch-up from #1780).

const G5_NPS_ENABLED: JourneySettingContract = {
  id: "npsEnabled",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "NPS survey enabled",
  helpText:
    "Master off-switch for the NPS satisfaction survey. When off, no NPS stop fires regardless of trigger / threshold below.",
  storagePath: "config.nps.enabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G5_NPS_TRIGGER: JourneySettingContract = {
  id: "npsTrigger",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "NPS trigger",
  helpText:
    "When the NPS survey fires: at a mastery percentage or after N calls.",
  storagePath: "config.nps.trigger",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
  options: [
    { value: "mastery", label: "Mastery percentage" },
    { value: "session_count", label: "After N calls" },
  ],
};

const G5_NPS_THRESHOLD: JourneySettingContract = {
  id: "npsThreshold",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "NPS trigger threshold",
  helpText:
    "Mastery % (0–100) or call count, depending on the trigger above. Default 80 (mastery) / 5 (calls).",
  storagePath: "config.nps.threshold",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G5_NPS_STOP: JourneySettingContract = {
  id: "npsStop",
  menuGroupKey: "L_mid_journey",
  group: "G5",
  educatorLabel: "NPS stop",
  helpText: "Net Promoter Score survey at a mid-journey moment.",
  storagePath: "sessionFlow.stops.nps",
  control: "stop",
  cascadeSources: [],
  composeImpact: {
    sections: ["nps"],
    kinds: ["section-enable", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "nps" }],
};

// =============================================================
// G6 — End of course / offboarding (4)
// =============================================================

const G6_OFFBOARDING_FLOW_PHASES: JourneySettingContract = {
  id: "offboardingFlowPhases",
  menuGroupKey: "H_closing",
  group: "G6",
  educatorLabel: "Offboarding flow phases",
  helpText: "Phases the AI walks through on the final call.",
  storagePath: "sessionFlow.offboarding",
  control: "phases",
  cascadeSources: [
    { level: "domain", storagePath: "domain.offboardingFlowPhases" },
  ],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding", hint: "phase list" }],
};

// Lane 3 PR8 — M_end_of_course contracts (catch-up from #1780).

const G6_OFFBOARDING_SUMMARY_ENABLED: JourneySettingContract = {
  id: "offboardingSummaryEnabled",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Structured offboarding summary",
  helpText:
    "Off-switch for the structured progress block at offboarding. When on, the AI's closing turn cites concrete module / goal / skill numbers. (#780 Felt Progress S2)",
  storagePath: "config.offboardingSummary.enabled",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding" }],
};

const G6_OFFBOARDING_SUMMARY_CADENCE: JourneySettingContract = {
  id: "offboardingSummaryCadence",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Summary cadence",
  helpText:
    "When the summary fires. `final_only` preserves the existing final-session gate; `every_session_with_data` fires on every post-Call-1 session with data. (#780)",
  storagePath: "config.offboardingSummary.cadence",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding" }],
  options: [
    { value: "final_only", label: "Final session only" },
    { value: "every_session_with_data", label: "Every session with data" },
  ],
};

const G6_OFFBOARDING_SUMMARY_INCLUDE_MODULE_MASTERY: JourneySettingContract = {
  id: "offboardingSummaryIncludeModuleMastery",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Summary: include module mastery",
  helpText: "Include per-module mastery numbers in the offboarding summary. (#780)",
  storagePath: "config.offboardingSummary.includeModuleMastery",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G6_OFFBOARDING_SUMMARY_INCLUDE_GOAL_PROGRESS: JourneySettingContract = {
  id: "offboardingSummaryIncludeGoalProgress",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Summary: include goal progress",
  helpText: "Include per-goal progress numbers in the offboarding summary. (#780)",
  storagePath: "config.offboardingSummary.includeGoalProgress",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G6_OFFBOARDING_SUMMARY_INCLUDE_SKILL_SCORE: JourneySettingContract = {
  id: "offboardingSummaryIncludeSkillScore",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Summary: include skill scores",
  helpText: "Include per-skill current scores in the offboarding summary. (#780)",
  storagePath: "config.offboardingSummary.includeSkillCurrentScore",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G6_OFFBOARDING_TRIGGER_AFTER_CALLS: JourneySettingContract = {
  id: "offboardingTriggerAfterCalls",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Offboarding fires after N calls",
  helpText:
    "Number of calls after which the offboarding flow begins. Default 5. Increase for longer cohorts.",
  storagePath: "config.offboarding.triggerAfterCalls",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding" }],
};

const G6_OFFBOARDING_BANNER_MESSAGE: JourneySettingContract = {
  id: "offboardingBannerMessage",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Progress page banner",
  helpText:
    "Banner shown on the student progress page when offboarding is approaching. Supports `{n}` for session count.",
  storagePath: "config.offboarding.bannerMessage",
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G6_OFFBOARDING_CERTIFICATE: JourneySettingContract = {
  id: "offboardingCertificate",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Certificate on completion",
  helpText: "Issue a completion certificate at the end.",
  storagePath: "config.offboardingCertificate",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-enable"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding", hint: "certificate mention" }],
};

const G6_POST_TEST_STOP: JourneySettingContract = {
  id: "postTestStop",
  menuGroupKey: "H_closing",
  group: "G6",
  educatorLabel: "Post-test stop",
  helpText: "Final assessment before offboarding.",
  storagePath: "sessionFlow.stops.postTest",
  control: "stop",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate", "offboarding"],
    kinds: ["section-enable", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "post-test block" }],
};

const G6_COMPLETION_CRITERIA: JourneySettingContract = {
  id: "completionCriteria",
  menuGroupKey: "M_end_of_course",
  group: "G6",
  educatorLabel: "Completion criteria",
  helpText:
    "All modules mastered / any module mastered / mastery threshold reached.",
  storagePath: "config.completionCriteria",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding", "modulesGate"],
    kinds: ["section-enable", "sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding" }],
  options: [
    { value: "all_modules", label: "All modules mastered" },
    { value: "any_module", label: "Any module mastered" },
    { value: "mastery_threshold", label: "Overall mastery threshold" },
  ],
};

// =============================================================
// G7 — Scoring & sequencing (6)
// =============================================================

const G7_MODULE_VISIBILITY: JourneySettingContract = {
  id: "moduleVisibility",
  menuGroupKey: "D_question_flow",
  group: "G7",
  educatorLabel: "Module visibility rules",
  helpText: "When the AI starts naming modules in framing.",
  storagePath: "config.moduleVisibility",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy", "section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "module naming" }],
  options: [
    { value: "mention_from_call_1", label: "Mention module names from Call 1" },
    { value: "hide_until_call_2", label: "Hide until Call 2" },
    { value: "hide_until_learner_picks", label: "Hide until learner picks" },
  ],
};

// Lane 3 PR9 — final 7 contracts. Closes the Slice C BA-failure
// recovery (#1780 coverage check). After this PR the catch-up
// ratchet hits 0 — all 35 originally-spotted gaps closed.

// — tolerances bucket assignments (sub-fields of config.tolerances) —
// Master tolerances helper at lib/tolerance/*. Each sub-field maps to
// a distinct educator concern:

const G7_TOL_MASTERY_THRESHOLD: JourneySettingContract = {
  id: "tolMasteryThreshold",
  menuGroupKey: "I_scoring",
  group: "G7",
  educatorLabel: "Mastery threshold override",
  helpText:
    "Course-level override of the mastery threshold (default 0.7). Higher = stricter passing bar. (#598)",
  storagePath: "config.tolerances.masteryThreshold",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["moduleMastery", "loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G7_TOL_RETRIEVAL_CADENCE: JourneySettingContract = {
  id: "tolRetrievalCadence",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Retrieval cadence override",
  helpText:
    "Multiplier on the SchedulerPolicy retrieval cadence. Lower = faster spaced-repetition cycle. Per-learner override intentionally NOT supported (would defeat interleaving). (#598)",
  storagePath: "config.tolerances.retrievalCadenceOverride",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G7_TOL_MEMORY_DECAY: JourneySettingContract = {
  id: "tolMemoryDecay",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Memory decay scale",
  helpText:
    "0.1–1.0 multiplier applied to category decay defaults in the forgetting-curve calculation. Lower = slower decay (good for long-cycle courses). (#598)",
  storagePath: "config.tolerances.memoryDecayScale",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G7_TOL_CARRY_FORWARD: JourneySettingContract = {
  id: "tolCarryForwardBoost",
  menuGroupKey: "D_question_flow",
  group: "G7",
  educatorLabel: "Carry-forward priority boost",
  helpText:
    "Magnitude of the priority bump given to TPs that were planned in the prior call but never covered (learner hangup, time ran out). 0 disables the feature. Default 0.5. (#918)",
  storagePath: "config.tolerances.carryForwardBoost",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

// — disambiguation contracts —

const G7_FIRST_CALL_MODULE_VISIBILITY: JourneySettingContract = {
  id: "firstCallModuleVisibility",
  menuGroupKey: "B_call1_opening",
  group: "G7",
  educatorLabel: "Module visibility on Call 1",
  helpText:
    "Call-1-specific module-visibility override. Distinct from the course-wide `moduleVisibility` above — this one ONLY affects Call 1's orientation/framing sections; learner's explicit module pick still overrides. (#1405)",
  storagePath: "config.firstCall.firstCallModuleVisibility",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy", "section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate", hint: "call-1 framing" }],
  options: [
    { value: "mention_from_call_1", label: "Mention module names from Call 1" },
    { value: "hide_until_call_2", label: "Hide until Call 2" },
    { value: "hide_until_learner_picks", label: "Hide until learner picks" },
  ],
};

const G7_COMPLETION_MODE: JourneySettingContract = {
  id: "completionMode",
  menuGroupKey: "I_scoring",
  group: "G7",
  educatorLabel: "Completion mode",
  helpText:
    "When the course counts as 'done'. terminal-only (default): playbook's terminal module mastered. all-modules: every module mastered. any: at least one module mastered. Distinct from `completionCriteria` — that controls module-vs-LO granularity; this controls module-set coverage. (#494)",
  storagePath: "config.completionMode",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding", "modulesGate"],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding" }],
  options: [
    { value: "terminal-only", label: "Terminal module only (default)" },
    { value: "all-modules", label: "All modules mastered" },
    { value: "any", label: "Any module mastered" },
  ],
};

const G7_STRICT_PREREQUISITES: JourneySettingContract = {
  id: "strictPrerequisites",
  menuGroupKey: "D_question_flow",
  group: "G7",
  educatorLabel: "Strict prerequisites",
  helpText:
    "When on, hard-lock terminal modules with unmet prerequisites in the module picker. Off (default) = soft-warning override modal. On for assessment courses where premature attempts must be blocked. (#494)",
  storagePath: "config.strictPrerequisites",
  control: "toggle",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate" }],
};

const G7_LO_MASTERY_THRESHOLD: JourneySettingContract = {
  id: "loMasteryThreshold",
  menuGroupKey: "I_scoring",
  group: "G7",
  educatorLabel: "LO mastery pass threshold",
  helpText: "Mastery score required to mark a Learning Objective as passed.",
  storagePath: "config.loMasteryThreshold",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["loMastery"],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "loMastery" }],
};

// Lane 3 PR5 — K_between_calls contract (catch-up follow-on from #1780).

const G7_INTERLEAVE_REVIEW_MIN_DAYS: JourneySettingContract = {
  id: "interleaveReviewMinDays",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Interleave-review freshness (days)",
  helpText:
    "Minimum days since last call before a mastered module qualifies for review. Default 3 (typical 2-3 day spacing window). Higher (~7) for deeper-cycle courses; lower (~1) for daily drills. (#492)",
  storagePath: "config.interleaveReviewMinDays",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G7_CALL_COUNT_POLICY: JourneySettingContract = {
  id: "callCountPolicy",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Call count policy",
  helpText: "Hard cap / Soft cap / Unlimited — total call budget per learner.",
  storagePath: "config.callCountPolicy",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
  options: [
    { value: "hard_cap", label: "Hard cap — refuse after limit" },
    { value: "soft_cap", label: "Soft cap — warn but allow" },
    { value: "unlimited", label: "Unlimited" },
  ],
};

const G7_MAX_CALLS_PER_DAY: JourneySettingContract = {
  id: "maxCallsPerDay",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Max calls per day",
  helpText: "Throttle to N calls per day per learner.",
  storagePath: "config.maxCallsPerDay",
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G7_ASSESSMENT_READINESS_THRESHOLD: JourneySettingContract = {
  id: "assessmentReadinessThreshold",
  menuGroupKey: "K_between_calls",
  group: "G7",
  educatorLabel: "Assessment readiness threshold",
  helpText: "Mastery the learner must reach before the post-test fires.",
  storagePath: "config.assessmentReadinessThreshold",
  control: "slider",
  cascadeSources: [],
  composeImpact: {
    sections: ["modulesGate"],
    kinds: ["sequence-policy", "stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "modulesGate" }],
};

const G7_REWARD_STRATEGY: JourneySettingContract = {
  id: "rewardStrategy",
  menuGroupKey: "I_scoring",
  group: "G7",
  educatorLabel: "Reward strategy",
  helpText: "Which reward signal the adaptive loop optimises for.",
  storagePath: "config.rewardStrategy",
  control: "select",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["scoring-weight", "sequence-policy"],
    requiresReprompt: true, // operator-only + compose impact (AC §6 rule 11)
  },
  previewLocators: [{ section: "instructions" }],
  writeGate: "operator-only",
  options: [
    { value: "learner_mastery", label: "Learner mastery growth" },
    { value: "educator_drift", label: "Educator-target drift" },
    { value: "blended", label: "Blended (mastery + drift)" },
  ],
};

const G7_TALK_TIME_BUDGETS: JourneySettingContract = {
  id: "talkTimeBudgets",
  menuGroupKey: "J_feedback",
  group: "G7",
  educatorLabel: "Tutor talk-time budgets",
  helpText:
    "Post-call telemetry budgets. Shape: {maxTutorTurnSec, maxTutorRatio}. Defaults: 30s / 0.2 (tutor ≤ 20% of session words). Yellow chip in AttainmentTab + AppLog voice.talk_time.over_budget when exceeded.",
  storagePath: "config.talkTimeBudgets",
  control: "json-fallback",
  cascadeSources: [],
  composeImpact: {
    // Post-call telemetry only — runtime intervention is explicitly
    // deferred per the gap-analysis risk register. No composer section.
    sections: [],
    kinds: ["scoring-weight"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

// =============================================================
// G8 — Module-scoped settings (6) — #1701 (epic #1700 Theme 1)
// =============================================================
//
// Per-module knobs at `Playbook.config.modules[].settings.*`, addressed
// by `arrayKey: "id"`. Phase 1 scope: 6 IELTS-required keys. Theme 1b
// adds dedicated primitives for min/target + array-of-structs shapes;
// Phase 1 uses `json-fallback` for those (testers are OPERATOR+).
//
// Downstream readers (compose transforms / endSession / cue scheduler /
// EXTRACT) are gated by HF_FLAG_IELTS_MODULE_SETTINGS during the
// migration window per epic #1700 decision 5.

const G8_MODULE_QUESTION_TARGET: JourneySettingContract = {
  id: "moduleQuestionTarget",
  menuGroupKey: "D_question_flow",
  scope: "module",
  group: "G8",
  educatorLabel: "Question target",
  helpText: "Min and target number of questions the tutor asks in this module — e.g. {min: 10, target: 13}.",
  storagePath: {
    path: "config.modules[].settings.questionTarget",
    arrayKey: "id",
  },
  control: "json-fallback",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions", hint: "question count directive" }],
};

const G8_MODULE_MIN_SPEAKING_SEC: JourneySettingContract = {
  id: "moduleMinSpeakingSec",
  menuGroupKey: "G_session_length",
  scope: "module",
  group: "G8",
  educatorLabel: "Min learner speaking time (sec)",
  helpText: "Module-scoped completion gate. endSession marks the call incomplete below this threshold (Theme 9 / #1703).",
  storagePath: {
    path: "config.modules[].settings.minSpeakingSec",
    arrayKey: "id",
  },
  control: "number",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["sequence-policy"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

const G8_MODULE_CUE_CARD_POOL: JourneySettingContract = {
  id: "moduleCueCardPool",
  menuGroupKey: "E_learner_visual",
  scope: "module",
  group: "G8",
  educatorLabel: "Cue card pool",
  helpText: "Array of {topic, bullets} for Part 2 monologue. Session start picks one; pinned into Session.metadata.pinnedCard.",
  storagePath: {
    path: "config.modules[].settings.cueCardPool",
    arrayKey: "id",
  },
  control: "json-fallback",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions", hint: "cue card content" }],
};

const G8_MODULE_CLOSING_LINE: JourneySettingContract = {
  id: "moduleClosingLine",
  menuGroupKey: "H_closing",
  scope: "module",
  group: "G8",
  educatorLabel: "Closing line (verbatim)",
  helpText: 'Module-specific closing line. e.g. Assessment closes with "That gives me a good picture…".',
  storagePath: {
    path: "config.modules[].settings.closingLine",
    arrayKey: "id",
  },
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["offboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "offboarding", hint: "closing line" }],
};

const G8_MODULE_FIRST_TIME_ORIENTATION_LINE: JourneySettingContract = {
  id: "moduleFirstTimeOrientationLine",
  menuGroupKey: "B_call1_opening",
  scope: "module",
  group: "G8",
  educatorLabel: "First-time orientation line",
  helpText: 'One-shot per-module orientation — e.g. Part 2 "In Part 2 you\'ll speak for 2 minutes…". Gated by `orientationShown` on CallerModuleProgress.',
  storagePath: {
    path: "config.modules[].settings.firstTimeOrientationLine",
    arrayKey: "id",
  },
  control: "text",
  cascadeSources: [],
  composeImpact: {
    sections: ["onboarding"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "onboarding", hint: "orientation line" }],
};

const G8_MODULE_SCHEDULED_CUES: JourneySettingContract = {
  id: "moduleScheduledCues",
  menuGroupKey: "F_stall_recovery",
  scope: "module",
  group: "G8",
  educatorLabel: "Scheduled cues",
  helpText: 'Array of {at, text} for time-keyed tutor/examiner speech (e.g. {at: 45, text: "15 seconds left"}). Consumed by the Theme 2 cue scheduler at runtime.',
  storagePath: {
    path: "config.modules[].settings.scheduledCues",
    arrayKey: "id",
  },
  control: "json-fallback",
  cascadeSources: [],
  composeImpact: {
    sections: [],
    kinds: ["stop-timing"],
    requiresReprompt: false,
  },
  previewLocators: [],
};

// #1704 Theme 10 — generic profile capture. EXTRACT walks this list and
// writes typed `CallerAttribute` rows under the course-agnostic `profile:*`
// namespace (scope "PROFILE"). Phase 1 renders via JourneyJsonFallback;
// Theme 1b adds the typed field-list editor.
const G8_MODULE_PROFILE_FIELDS_TO_CAPTURE: JourneySettingContract = {
  id: "moduleProfileFieldsToCapture",
  menuGroupKey: "A_intake",
  scope: "module",
  group: "G8",
  educatorLabel: "Profile fields to capture",
  helpText:
    'Array of {key, prompt, type}. EXTRACT walks this list and writes typed CallerAttribute keys under the `profile:*` namespace (course-agnostic). type is "text" | "number" | "band".',
  storagePath: {
    path: "config.modules[].settings.profileFieldsToCapture",
    arrayKey: "id",
  },
  control: "json-fallback",
  cascadeSources: [],
  composeImpact: {
    sections: ["instructions"],
    kinds: ["section-content"],
    requiresReprompt: false,
  },
  previewLocators: [{ section: "instructions", hint: "profile capture prompts" }],
};

// =============================================================
// Registry
// =============================================================

export const JOURNEY_SETTINGS: readonly JourneySettingContract[] = [
  // G1 (5)
  G1_INTAKE_SPEC_ID,
  G1_INTAKE_KNOWLEDGE_CHECK,
  G1_INTAKE_ABOUT_YOU,
  G1_INTAKE_GOALS,
  G1_INTAKE_AI_INTRO_CALL,
  G1_INTAKE_KNOWLEDGE_CHECK_MODE,
  G1_INTAKE_SKIP_IF_RETURNING,
  G1_INTAKE_CONSENT_FLOW,
  // G2 (6)
  G2_FIRST_CALL_MODE,
  G2_WELCOME_MESSAGE,
  G2_FIRST_CALL_COURSE_INTRO,
  G2_FIRST_CALL_WAIT_FOR_ACK,
  G2_FIRST_CALL_DURATION_OVERRIDE,
  G2_FIRST_CALL_INTRODUCE_PEDAGOGY,
  G2_ONBOARDING_FLOW_PHASES,
  G2_FIRST_CALL_TARGETS,
  G2_PRE_TEST_STOP,
  G2_BASELINE_ASSESSMENT_DEPTH,
  // G3 (4)
  G3_TEACHING_STYLE,
  G3_MODULE_SEQUENCE_POLICY,
  G3_FIRST_CALL_CURRICULUM_FOCUS,
  G3_OPENING_RECAP_ENABLED,
  // G4 (17)
  G4_MODE_POLICY,
  G4_SHARE_MATERIALS,
  G4_TOLERANCE_ACCURACY,
  G4_TOLERANCE_FLUENCY,
  G4_TOLERANCE_CONFIDENCE,
  G4_TOLERANCE_ENGAGEMENT,
  G4_TIER_PRESET_ID,
  G4_SKILL_MIN_CALLS_TO_FULL,
  G4_SKILL_TIER_MAPPING,
  G4_SKILL_SCORING_EMA_HALF_LIFE,
  G4_MAX_MASTERY_TIER,
  G4_USE_FRESH_MASTERY,
  G4_SCORING_MODE,
  G4_PROGRESS_NARRATIVE_ENABLED,
  G4_PROGRESS_NARRATIVE_CADENCE,
  G4_PROGRESS_NARRATIVE_THRESHOLD,
  G4_PROGRESS_NARRATIVE_SKIP_FIRST,
  G4_PRIOR_CALL_RECAP_ENABLED,
  G4_PRIOR_CALL_RECAP_DEPTH,
  G4_PRIOR_CALL_RECAP_DAILY_CAP,
  G4_RECAP_ENABLED,
  G4_RECAP_SYNTHESIS_ENABLED,
  G4_PRIOR_CALL_FEEDBACK_ENABLED,
  G4_AGENT_TUNER_NLP_ENABLED,
  G4_PROGRESS_SIGNAL_LOW_WATER,
  G4_PROGRESS_SIGNAL_HIGH_WATER,
  G4_INTERRUPT_SENSITIVITY,
  // G5 (3)
  G5_MID_JOURNEY_STOP,
  G5_MID_JOURNEY_STOP_TRIGGER,
  G5_NPS_ENABLED,
  G5_NPS_TRIGGER,
  G5_NPS_THRESHOLD,
  G5_NPS_STOP,
  // G6 (4)
  G6_OFFBOARDING_FLOW_PHASES,
  G6_OFFBOARDING_SUMMARY_ENABLED,
  G6_OFFBOARDING_SUMMARY_CADENCE,
  G6_OFFBOARDING_SUMMARY_INCLUDE_MODULE_MASTERY,
  G6_OFFBOARDING_SUMMARY_INCLUDE_GOAL_PROGRESS,
  G6_OFFBOARDING_SUMMARY_INCLUDE_SKILL_SCORE,
  G6_OFFBOARDING_TRIGGER_AFTER_CALLS,
  G6_OFFBOARDING_BANNER_MESSAGE,
  G6_OFFBOARDING_CERTIFICATE,
  G6_POST_TEST_STOP,
  G6_COMPLETION_CRITERIA,
  // G7 (7)
  G7_MODULE_VISIBILITY,
  G7_TOL_MASTERY_THRESHOLD,
  G7_TOL_RETRIEVAL_CADENCE,
  G7_TOL_MEMORY_DECAY,
  G7_TOL_CARRY_FORWARD,
  G7_FIRST_CALL_MODULE_VISIBILITY,
  G7_COMPLETION_MODE,
  G7_STRICT_PREREQUISITES,
  G7_LO_MASTERY_THRESHOLD,
  G7_INTERLEAVE_REVIEW_MIN_DAYS,
  G7_CALL_COUNT_POLICY,
  G7_MAX_CALLS_PER_DAY,
  G7_ASSESSMENT_READINESS_THRESHOLD,
  G7_REWARD_STRATEGY,
  G7_TALK_TIME_BUDGETS,
  // G8 (7) — #1701 module-scoped settings + #1704 profile capture
  G8_MODULE_QUESTION_TARGET,
  G8_MODULE_MIN_SPEAKING_SEC,
  G8_MODULE_CUE_CARD_POOL,
  G8_MODULE_CLOSING_LINE,
  G8_MODULE_FIRST_TIME_ORIENTATION_LINE,
  G8_MODULE_SCHEDULED_CUES,
  G8_MODULE_PROFILE_FIELDS_TO_CAPTURE,
];

export const JOURNEY_SETTINGS_BY_ID: Readonly<
  Record<string, JourneySettingContract>
> = Object.fromEntries(JOURNEY_SETTINGS.map((s) => [s.id, s]));

export const JOURNEY_SETTINGS_BY_GROUP: Readonly<
  Record<JourneyGroup, readonly JourneySettingContract[]>
> = (() => {
  const groups = ["G1", "G2", "G3", "G4", "G5", "G6", "G7", "G8"] as const;
  const out: Record<JourneyGroup, JourneySettingContract[]> = {
    G1: [], G2: [], G3: [], G4: [], G5: [], G6: [], G7: [], G8: [],
  };
  for (const s of JOURNEY_SETTINGS) {
    // Settings-group entries should not appear in JOURNEY_SETTINGS — the
    // completeness vitest enforces this. Narrow defensively here.
    if (s.group in out) {
      out[s.group as JourneyGroup].push(s);
    }
  }
  return Object.fromEntries(groups.map((g) => [g, out[g]])) as unknown as Record<
    JourneyGroup,
    readonly JourneySettingContract[]
  >;
})();
