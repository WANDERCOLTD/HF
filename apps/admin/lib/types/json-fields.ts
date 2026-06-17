/**
 * Typed interfaces for Prisma Json? fields.
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §3
 * @canonical-doc docs/WIZARD-DATA-BAG.md §3
 *
 * Prisma types all `Json?` columns as `Prisma.JsonValue` which loses
 * structure. These types let us cast once at the access site and get
 * autocompletion + safety downstream.
 *
 * Usage:
 *   import type { SpecConfig } from "@/lib/types/json-fields";
 *   const cfg = spec.config as SpecConfig;
 */

// ---------------------------------------------------------------------------
// AnalysisSpec.config — the most common Json? field
// ---------------------------------------------------------------------------

/**
 * Generic spec config — dynamic JSON blob whose shape varies per spec.
 * Using `any` for values because specs have deeply nested, variable structures
 * (tutor_role.roleStatement, sessionStructure.opening.instruction, etc.)
 * that can't be statically typed without per-spec interfaces.
 *
 * The value of this type is replacing naked `as any` casts with a named type
 * that documents intent: "this is a spec config JSON field".
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type SpecConfig = Record<string, any>;

// ---------------------------------------------------------------------------
// Parameter.config Json? fields (#500 — bands-as-thresholds)
// ---------------------------------------------------------------------------

/**
 * Structured config bag on the Parameter row.
 *
 * Lives in `Parameter.config` (Json?). Currently carries `bandThresholds`
 * for SKILL parameters that wrap a graded rubric (IELTS Speaking bands,
 * CEFR levels, NHS AfC bands, professional certification levels, etc.).
 *
 * `bandThresholds` keys the band number (typically 0–9 for IELTS, 1–6 for
 * CEFR, etc.) to the descriptor text the LLM uses at MEASURE time to
 * justify a per-call score. ONE Parameter per skill criterion; the bands
 * are thresholds within that Parameter — never separate parameters.
 *
 * Optional. Skill parameters with no rubric (Secret Garden, Intro Psych
 * style courses) leave it undefined; MEASURE prompt falls back to the
 * tier descriptors inlined in the AnalysisAction.description.
 */
export interface ParameterConfig {
  /** Per-band descriptor text. Key = band number; value = descriptor. */
  bandThresholds?: Record<number, string>;
  /** Future-proofing: arbitrary additional keys allowed. */
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// RewardScore Json? fields
// ---------------------------------------------------------------------------

export interface ParameterDiff {
  parameterId: string;
  target: number;
  actual: number;
  diff: number;
  withinTolerance?: boolean;
}

export interface OutcomeSignal {
  resolved?: boolean;
  sentiment_delta?: number;
  duration?: number;
  csat?: number;
  [key: string]: unknown;
}

export interface TargetUpdate {
  parameterId: string;
  oldTarget: number;
  newTarget: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Onboarding flow phases — shared shape used by Domain + Playbook config
// ---------------------------------------------------------------------------

/** A single survey question config — used in onboarding/offboarding survey phases */
export interface SurveyStepConfig {
  id: string;
  type: 'stars' | 'options' | 'nps' | 'text' | 'mcq' | 'true_false';
  prompt: string;
  options?: { value: string; label: string }[];
  placeholder?: string;
  maxLength?: number;
  optional?: boolean;
  /** For 'mcq' and 'true_false' — the value of the correct option (not shown to learner) */
  correctAnswer?: string;
  /** For 'mcq' and 'true_false' — brief explanation of the correct answer */
  explanation?: string;
  /** For 'mcq' and 'true_false' — source chapter for summary grouping */
  chapter?: string;
  /** For 'mcq' — links to ContentQuestion.id for traceability */
  contentQuestionId?: string;
}

export interface OnboardingPhase {
  phase: string;
  duration: string;
  goals: string[];
  content?: Array<{ mediaId: string; instruction?: string }>;
  surveySteps?: SurveyStepConfig[];
}

export interface OnboardingFlowPhases {
  phases: OnboardingPhase[];
  successMetrics?: string[];
}

export interface OffboardingConfig {
  triggerAfterCalls: number; // default 5
  bannerMessage?: string; // shown on student progress page; {n} = session count
  phases: OnboardingPhase[];
}

// ---------------------------------------------------------------------------
// Playbook.config
// ---------------------------------------------------------------------------

export type GoalTypeLiteral = "LEARN" | "ACHIEVE" | "CHANGE" | "CONNECT" | "SUPPORT" | "CREATE";

export const GOAL_TYPE_VALUES: readonly GoalTypeLiteral[] = ["LEARN", "ACHIEVE", "CHANGE", "CONNECT", "SUPPORT", "CREATE"] as const;

export interface GoalTemplate {
  type: GoalTypeLiteral;
  name: string;
  description?: string;
  contentSpecSlug?: string;
  isDefault?: boolean;
  priority?: number;
  isAssessmentTarget?: boolean;
  assessmentConfig?: {
    threshold?: number; // readiness threshold for "passed" (0-1, default 0.8)
    readinessSpecSlug?: string; // CONTENT spec slug for mastery tracking
  };
  // Projection provenance (#338). Tags goal templates written by
  // applyProjection() so re-runs can dedup by sourceContentId + ref.
  // Hand-authored / wizard / legacy templates omit these.
  sourceContentId?: string;
  ref?: string; // "OUT-01" / "SKILL-02" — stable ref back to the source doc
  /**
   * #444 — measurement strategy key. Authored projection writes this;
   * non-authored / hand-seeded templates omit it and instantiate-goals.ts
   * resolves via GOAL-PROGRESS-001 at goal-create time.
   */
  progressStrategy?: string;
}

// ---------------------------------------------------------------------------
// Welcome + NPS config (student experience)
// ---------------------------------------------------------------------------

/** Controls which phases appear in the student welcome flow before their first session. */
export interface WelcomeConfig {
  /** Students set learning goals */
  goals: { enabled: boolean };
  /** Quick confidence + motivation check */
  aboutYou: { enabled: boolean };
  /** Baseline MCQs from curriculum content */
  knowledgeCheck: { enabled: boolean };
  /** AI voice/chat introduction call before teaching starts */
  aiIntroCall: { enabled: boolean };
}

/** NPS / satisfaction feedback trigger configuration. */
export interface NpsConfig {
  enabled: boolean;
  trigger: "mastery" | "session_count";
  /** Mastery %: trigger when >= this value. Session count: trigger after this many calls. */
  threshold: number;
}

export const DEFAULT_WELCOME_CONFIG: WelcomeConfig = {
  goals: { enabled: true },
  aboutYou: { enabled: true },
  knowledgeCheck: { enabled: false },
  aiIntroCall: { enabled: false },
};

export const DEFAULT_NPS_CONFIG: NpsConfig = {
  enabled: true,
  trigger: "mastery",
  threshold: 80,
};

// ---------------------------------------------------------------------------
// Session Flow — canonical model (ADR 2026-04-29)
// Consolidates: welcome, surveys, assessment, nps, onboardingFlowPhases.
// During dual-read window the resolver reads new shape if present, else legacy.
// ---------------------------------------------------------------------------

/**
 * Educator-facing toggles that shape what happens around teaching.
 * Same surface as the deprecated WelcomeConfig — renamed to match the
 * canonical "Session Flow / Course Intake" vocabulary.
 *
 * Knowledge Check supports two delivery modes:
 *   - "mcq": batch of multiple-choice questions (post call 1)
 *   - "socratic": open Socratic probe in first call
 * (Split implemented in #222; field accepted here so resolver is forward-compatible.)
 */
export interface IntakeConfig {
  goals: { enabled: boolean };
  aboutYou: { enabled: boolean };
  knowledgeCheck: {
    enabled: boolean;
    deliveryMode?: "mcq" | "socratic";
  };
  aiIntroCall: { enabled: boolean };
}

/**
 * Trigger condition for a journey stop. Evaluated against pipeline state
 * (call count, mastery, course completion) at journey-position time.
 */
export type JourneyStopTrigger =
  | { type: "first_session" }
  | { type: "before_session"; index: number }
  | { type: "after_session"; index: number }
  | { type: "midpoint" }
  | { type: "mastery_reached"; threshold: number }
  | { type: "session_count"; count: number }
  | { type: "course_complete" };

export type JourneyStopKind = "assessment" | "survey" | "nps" | "reflection";

/**
 * A single gated insertion in the learner journey (pre-test, mid-test,
 * post-test, NPS, etc). Replaces the parallel surfaces:
 * `surveys.pre/post`, `assessment.preTest/postTest`, `nps`.
 */
export interface JourneyStop {
  id: string;
  kind: JourneyStopKind;
  trigger: JourneyStopTrigger;
  delivery: { mode: "voice" | "chat" | "either"; component?: string };
  payload?:
    | SurveyStepConfig[]
    | { source: "mcq-pool"; count: number };
  enabled: boolean;
}

/**
 * Canonical Session Flow shape. Lives at `Playbook.config.sessionFlow`.
 * Replaces five parallel surfaces (welcome / surveys / assessment / nps /
 * onboardingFlowPhases) under a single field.
 *
 * NOTE: Domain has no `offboarding` field — the resolver fallback chain
 * for offboarding is `playbook.sessionFlow.offboarding` →
 * `playbook.config.offboarding` (legacy) → defaults. No domain layer.
 */
export interface SessionFlowConfig {
  intake?: IntakeConfig;
  onboarding?: { phases?: OnboardingPhase[] };
  stops?: JourneyStop[];
  offboarding?: OffboardingConfig;
}

/**
 * The shape returned by `resolveSessionFlow()`. Always fully populated
 * (defaults applied for any missing layer). Transforms read this, not
 * raw `Playbook.config`.
 */
export interface SessionFlowResolved {
  intake: IntakeConfig;
  onboarding: OnboardingFlowPhases;
  stops: JourneyStop[];
  offboarding: OffboardingConfig;
  /** Greeting cascade winner: identity-spec / playbook / domain / generic */
  welcomeMessage: string | null;
  /**
   * #1403 — Course-level intro line spoken on first call after the
   * welcomeMessage + acknowledgement gate. Supports `{courseName}` token,
   * substituted server-side via `substituteGreetingTokens`. Null when
   * unset — phase-derived session plan continues to drive the flow.
   */
  firstCallCourseIntro: string | null;
  /**
   * #1403 — How the AI handles the pause after the welcomeMessage on
   * first call.
   * - `"none"`: no pause; continue speaking immediately
   * - `"any_response"`: wait for any learner response
   * - `"greeting_words"`: wait for "hi/hello/yes/yeah/..." (default)
   */
  firstCallWaitForAck: "none" | "any_response" | "greeting_words";
  /** Provenance — for debug panel + tests */
  source: {
    intake: "new-shape" | "legacy-welcome" | "defaults";
    onboarding: "new-shape" | "playbook-legacy" | "domain" | "init001";
    stops: "new-shape" | "synthesized-from-legacy";
    offboarding: "new-shape" | "playbook-legacy" | "defaults";
    welcomeMessage: "playbook" | "domain" | "generic";
    /** #1403 — was the course-intro set explicitly on the playbook? */
    firstCallCourseIntro: "playbook" | "none";
    /** #1403 — was the wait-for-ack mode set explicitly, or default? */
    firstCallWaitForAck: "playbook" | "default";
  };
}

export const DEFAULT_INTAKE_CONFIG: IntakeConfig = {
  goals: { enabled: true },
  aboutYou: { enabled: true },
  knowledgeCheck: { enabled: false, deliveryMode: "mcq" },
  aiIntroCall: { enabled: false },
};

export const DEFAULT_OFFBOARDING_CONFIG: OffboardingConfig = {
  triggerAfterCalls: 5,
  phases: [],
};

/**
 * @deprecated Use `IntakeConfig` instead. Kept as alias during the dual-read
 * window so existing wizard / quickstart code compiles unchanged. Will be
 * removed in Phase 5 (#220).
 */
export type WelcomeToggles = IntakeConfig;

/**
 * #599 Slice 1 — depth picker for the AI-synthesized prior-call recap.
 *
 * - `minimal` — no AI call; returns the existing templated summary from
 *   `loadPriorCallFeedback` (the #492 Slice 3.5 path). Byte-identical to
 *   today's output.
 * - `standard` — 2–3 sentences: score + likely cause + re-entry suggestion.
 *   No raw numeric scores in the output text.
 * - `rich` — 3–4 sentences + one transcript-grounded observation. Sliced
 *   from `call.transcript[0..6000]` to bound the AI input.
 *
 * See `lib/prompt/composition/loaders/synthesizePriorCallRecap.ts`.
 */
export type PriorCallRecapDepth = "minimal" | "standard" | "rich";

/**
 * Tunable course-level configuration for a Playbook.
 *
 * **Tolerance placement contract:** every new field on this interface MUST be
 * classified under one of the 3 buckets in
 * `docs/decisions/2026-05-22-tolerance-placement.md` (Course parameter / System
 * default / Per-learner adaptation), and the field's JSDoc MUST carry a
 * `@bucket` tag. Reads cascade through `lib/tolerance/resolve-*.ts`; writes go
 * through `applyBehaviorTargets(PLAYBOOK)` or a `PATCH /api/playbooks/[id]`
 * route, audited via `AuditLog.action = PLAYBOOK_CONFIG_WRITE`.
 *
 * Per-learner overrides do NOT live on this interface — they're stored on
 * `BehaviorTarget(scope=CALLER)` or `CallerAttribute(scope=TOLERANCE)`. See the
 * ADR for the cascade order.
 *
 * The `arch-checker` agent surfaces new fields here that lack a `@bucket` tag
 * (soft warning — not a hard CI fail).
 *
 * @see docs/decisions/2026-05-22-tolerance-placement.md
 */
export interface PlaybookConfig {
  systemSpecToggles?: Record<string, { isEnabled: boolean }>;
  goals?: GoalTemplate[];
  onboardingFlowPhases?: OnboardingFlowPhases;
  physicalMaterials?: string;
  audience?: string;
  constraints?: string[]; // teacher-level "NEVER do this" pedagogical anti-patterns
  // Identity axes (stored by course-setup wizard)
  interactionPattern?: string; // HOW: "socratic" | "directive" | "advisory" | "coaching" | ...
  teachingMode?: string; // WHAT: "recall" | "comprehension" | "practice" | "syllabus"
  subjectDiscipline?: string; // e.g. "GCSE Biology", "A-Level Economics"
  // Plan intents (used by lesson plan regeneration fallback)
  suggestedSessionCount?: number; // Educator's initial suggestion — may differ from generated plan
  sessionCount?: number;
  durationMins?: number;
  emphasis?: string; // "breadth" | "balanced" | "depth"
  assessments?: string; // "formal" | "light" | "none"
  lessonPlanMode?: "structured" | "continuous"; // How pacing works: scheduler (continuous) or pre-planned (structured)
  lessonPlanModel?: string; // "direct_instruction" | "socratic" | etc.
  // Course goals — educator's stated learning outcomes (distinct from module LOs)
  courseLearningOutcomes?: string[];
  // Course-scoped welcome (overrides Domain.onboardingWelcome)
  welcomeMessage?: string;
  /**
   * #1403 — First-call course intro spoken AFTER the welcomeMessage +
   * acknowledgement gate. Supports `{courseName}` token.
   *
   * @bucket Course parameter — educator-tunable on the Greeting lens.
   */
  firstCallCourseIntro?: string;
  /**
   * #1403 — Controls how long the AI pauses after the welcomeMessage.
   * - `"none"`: speak + continue without pause
   * - `"any_response"`: speak + wait for any learner input
   * - `"greeting_words"`: speak + wait for hi/hello/yes/yeah (default)
   *
   * @bucket Course parameter — educator-tunable on the Greeting lens.
   */
  firstCallWaitForAck?: "none" | "any_response" | "greeting_words";
  courseContext?: string;
  offboarding?: OffboardingConfig;
  /** Student welcome flow configuration — controls which phases show before first session */
  welcome?: WelcomeConfig;
  /** NPS / satisfaction feedback configuration */
  nps?: NpsConfig;
  /**
   * Canonical Session Flow shape (ADR 2026-04-29).
   * When present, the resolver prefers this over legacy fields below.
   * Phase 1 reads it back-compat; Phase 5 removes the legacy fields.
   */
  sessionFlow?: SessionFlowConfig;
  /** Survey configuration — legacy, kept for backward compat with applyAutoIncludeStops */
  surveys?: {
    pre?: { enabled: boolean; questions?: SurveyStepConfig[] };
    post?: { enabled: boolean; questions?: SurveyStepConfig[] };
  };
  /** Assessment configuration — personality profiling + pre/post knowledge testing */
  assessment?: {
    personality?: { enabled: boolean; questions: SurveyStepConfig[] };
    preTest?: { enabled: boolean; questionCount: number };
    postTest?: { enabled: boolean };
  };
  /**
   * Whether the AI may share course materials (PDFs, reference docs) with
   * students during sessions. Default: true (preserves existing reading-
   * comprehension course behaviour). Set to false for voice-only courses
   * (IELTS Speaking, conversation practice) where document delivery is
   * pedagogically wrong (turns speaking practice into reading exercise) or
   * technically meaningless (voice channel can't render PDFs).
   * @see https://github.com/WANDERCOLTD/HF/issues/234
   */
  shareMaterials?: boolean;
  /**
   * #417 per-playbook overrides for SKILL-AGG-001 scoring behavior.
   * Both fall back to the SKILL_MEASURE_V1 contract when omitted; both
   * take precedence over the contract when set.
   *
   * `skillScoringEmaHalfLifeDays` — time-decay half-life for the
   *   per-skill EMA running score on CallerTarget.currentScore. Default
   *   14 days (IELTS-style gradual progress). Coaching domains may want
   *   shorter (~1-2 days). Testing/dev may want very short (~0.0035 =
   *   5 minutes) so back-to-back same-day calls produce visible movement.
   * `skillMinCallsToFull` — first-call cap factor. With value N, a
   *   single-call score is capped at `min(rawScore, callsUsed/N)` until
   *   `callsUsed >= N` calls have accumulated. Default 4 (matches IELTS
   *   examiner observation budget). Lower for rapid-feedback courses.
   */
  skillScoringEmaHalfLifeDays?: number;
  skillMinCallsToFull?: number;
  /**
   * #417 Story C — per-playbook tier+band mapping for ACHIEVE skill goals.
   * When set, overrides the SKILL_MEASURE_V1 contract thresholds + bands.
   * Use `lib/banding/presets.ts::TIER_PRESETS` to set this from one of
   * the canonical presets (IELTS Speaking / CEFR / 5-Level), or supply a
   * fully custom shape. `tierLabels` is optional — when omitted, the
   * default "Approaching Emerging / Emerging / Developing / Secure"
   * tier names are used (CEFR / custom presets supply their own).
   */
  skillTierMapping?: {
    thresholds: {
      approachingEmerging: number;
      emerging: number;
      developing: number;
      secure: number;
    };
    tierBands: {
      approachingEmerging: number;
      emerging: number;
      developing: number;
      secure: number;
    };
    tierLabels?: {
      approachingEmerging: string;
      emerging: string;
      developing: string;
      secure: string;
    };
  };
  /**
   * #1119 — IELTS mode detection for the PROSODY pipeline stage.
   *
   * When set to `"ielts-speaking"`, PROSODY calls the configured
   * SpeechAssessmentProvider with `mode: "ielts"` and the resulting
   * sub-bands flow into the 4 IELTS skill `CallScore` rows via
   * AGGREGATE. When unset or any other value, PROSODY scores in
   * `general` mode and produces voice-signal envelopes consumed by
   * `CONV_PACE` / `pace_indicators` BehaviorParameter deltas.
   *
   * Distinct from `skillTierMapping` above — that drives band labels
   * shown to operators; this drives the scoring mode requested from
   * the vendor.
   *
   * Source of truth for the allowed values is
   * `lib/banding/presets.ts::TierPresetId`. Type imported lazily there
   * to avoid a circular import via the JSON-shape file.
   */
  tierPresetId?: "generic" | "ielts-speaking" | "cefr" | "5-level" | "custom";
  /**
   * #779 — Felt Progress S1. Controls the `progressNarrative` composer
   * section that gives the AI evidence of LO mastery for mid-call
   * acknowledgement. Sensible defaults mean no required setup; UI surface in
   * S6 (#784); AgentTuner awareness in S7 (#785).
   *
   * - `enabled` (default true) — off-switch for the section.
   * - `cadence` (default 'on_threshold_crossing') — `'every_call'` emits
   *   evidence whenever any LO score > 0; `'on_threshold_crossing'` emits
   *   only when at least one LO score meets `minScoreDelta`.
   * - `minScoreDelta` (default 0.1) — threshold used by 'on_threshold_crossing'.
   * - `skipFirstCall` (default true) — suppress on call 1 where there is no
   *   prior context for "improvement".
   */
  progressNarrative?: {
    enabled?: boolean;
    cadence?: "every_call" | "on_threshold_crossing";
    minScoreDelta?: number;
    skipFirstCall?: boolean;
  };
  /**
   * #780 — Felt Progress S2. Controls the structured progress block emitted
   * by `transforms/offboarding.ts`. When enabled, the offboarding guidance
   * carries concrete module / goal / skill numbers the AI can cite verbatim
   * in its closing turn. Sensible defaults preserve today's final-only
   * behaviour. UI surface in S6 (#784); AgentTuner awareness in S7 (#785).
   *
   * - `enabled` (default true) — off-switch for the entire summary block.
   * - `cadence` (default 'final_only') — `'final_only'` preserves the
   *   existing `isFinalSession`-gated trigger; `'every_session_with_data'`
   *   fires on every post-call-1 session that has at least one mastery /
   *   goal / skill data point.
   * - `includeModuleMastery` / `includeGoalProgress` /
   *   `includeSkillCurrentScore` (default true) — per-section toggles so a
   *   course can surface only the dimensions that match its pedagogy.
   */
  offboardingSummary?: {
    enabled?: boolean;
    cadence?: "final_only" | "every_session_with_data";
    includeModuleMastery?: boolean;
    includeGoalProgress?: boolean;
    includeSkillCurrentScore?: boolean;
  };
  /**
   * #784 (S6) — per-playbook first-call BEHAVIOR target overrides. Read by
   * `transforms/targets.ts::mergeAndGroupTargets` at NEW priority 1, above
   * `Domain.onboardingDefaultTargets`. When unset, the existing cascade
   * (domain → INIT-001 → AUDIENCE_TARGET_DEFAULTS) applies.
   *
   * Keyed by `Parameter.parameterId` (e.g. `BEH-WARMTH`). `value` in [0,1];
   * `confidence` defaults to 0.8 when omitted.
   */
  firstSessionTargets?: Record<string, { value: number; confidence?: number }>;
  /**
   * #790 (S8) — first-call mode override. Today every first call is forced
   * into ONBOARDING MODE in `transforms/pedagogy.ts` regardless of
   * `teachingMode`. This knob lets the educator pick:
   *   - `'onboarding'` (default) — current behaviour, byte-identical output
   *   - `'teach_immediately'` — bypass ONBOARDING MODE; call 1 runs the
   *     `teachingMode`-branched returning-caller flow; preamble injects
   *     `returningCallerByMode[teachingMode]`
   *   - `'baseline_assessment'` — first call captures diagnostic only;
   *     no curriculum teaching; new baseline critical rule injected
   */
  firstCallMode?: "onboarding" | "teach_immediately" | "baseline_assessment";
  /**
   * #598 Slice 1 — Course-level tolerance overrides for the mastery / spacing /
   * decay cascade (ADR 2026-05-22-tolerance-placement.md).
   *
   * - `masteryThreshold` — @bucket 1 + 3. Course parameter with optional
   *   per-learner override via `BehaviorTarget(scope=CALLER, parameterId=
   *   "TOL-MASTERY-THRESHOLD")`. Resolved by `lib/tolerance/resolve-tolerance.ts
   *   ::resolveMasteryThreshold` (7-layer cascade, bucket-2 default `0.7`).
   * - `retrievalCadenceOverride` — @bucket 1 only. Shallow-merges onto the
   *   `SchedulerPolicy.retrievalCadence` from `lib/pipeline/scheduler-presets`.
   *   Per-learner override intentionally NOT in scope (would defeat interleaving).
   * - `memoryDecayScale` — @bucket 1 only. 0.1–1.0 multiplier applied to
   *   `CATEGORY_DECAY_DEFAULTS` in `transforms/memories.ts::applyDecay`.
   *   Per-learner override intentionally NOT in scope (course-wide rhythm).
   * - `carryForwardBoost` — @bucket 1 only. #918. Magnitude of the priority
   *   bump given to TPs that were planned in the prior call but never
   *   covered (learner hangup, time ran out, etc.). 0 disables the feature.
   *   Default `0.5` in `selectWorkingSet`. Per-learner override NOT in scope —
   *   carry-forward is a course-wide pacing decision.
   *
   * @see docs/decisions/2026-05-22-tolerance-placement.md
   */
  tolerances?: {
    masteryThreshold?: number;
    retrievalCadenceOverride?: number;
    memoryDecayScale?: number;
    carryForwardBoost?: number;
  };
  /**
   * #1747 (epic #1700 Theme 7) — operator-configurable tutor-talk-time
   * budgets. Post-call telemetry chip in AttainmentTab flips yellow when
   * a budget is exceeded; AppLog `voice.talk_time.over_budget` fires
   * via the `evaluateTalkTimeBudgets` helper in
   * `lib/voice/talk-time-stats.ts`.
   *
   * Defaults (gap analysis): `maxTutorTurnSec = 30` (≈ 75 words at 150
   * WPM), `maxTutorRatio = 0.2` (tutor ≤ 20% of total session words).
   * Course-only — not cascadable.
   */
  talkTimeBudgets?: {
    maxTutorTurnSec?: number;
    maxTutorRatio?: number;
  };
  /**
   * #598 Slice 1 — Additional first-call overrides. Companion to
   * `firstCallMode` (flat field above, shipped #790) — these are net-new
   * knobs, NOT a rename. Re-introducing `firstCall.allowAssessMode` would
   * create a namespace collision with `firstCallMode`; do not.
   *
   * - `durationMinsOverride` — @bucket 1. Call-1 only; calls 2+ use the
   *   regular `Playbook.config.durationMins`.
   * - `introducePedagogy` — @bucket 1. Absent = current ("here's how this
   *   works" speech). `false` suppresses the pedagogy intro block on call 1.
   *
   * @see docs/decisions/2026-05-22-tolerance-placement.md
   */
  firstCall?: {
    durationMinsOverride?: number;
    introducePedagogy?: boolean;
    /**
     * #1405 — Controls whether module names surface in the AI's call-1
     * framing (this_session, plan.newMaterial.module, flow steps). When
     * absent, behaviour is byte-identical to `mention_from_call_1` (the
     * pre-#1405 default — module names appear normally on every call).
     *
     * - `mention_from_call_1` (default) — module names appear in
     *   `[SESSION PLAN]`, first_line locked-module greeting, and
     *   `this_session` from call 1.
     * - `hide_until_call_2` — suppresses module-name mentions in
     *   orientation/framing sections on call 1 only. Module TEACHING
     *   CONTENT still loads normally. Resets at call 2 regardless of
     *   learner action.
     * - `hide_until_learner_picks` — same as hide_until_call_2 but
     *   persists until `Caller.lastSelectedModuleId` is set (learner
     *   used Module Picker).
     *
     * Override rule: when the learner has explicitly picked a module
     * (`lockedModule` resolves), the gate ALWAYS allows module names
     * — the learner's explicit choice wins.
     *
     * @bucket 1 — Course-level only. Per-learner override would defeat
     * the operator's "don't confuse brand-new learners" intent. The
     * `lastSelectedModuleId` override IS the per-learner escape hatch.
     *
     * @see lib/prompt/composition/transforms/module-visibility-gate.ts
     */
    firstCallModuleVisibility?:
      | "mention_from_call_1"
      | "hide_until_call_2"
      | "hide_until_learner_picks";
  };
  /**
   * #599 Slice 1 — AI-synthesized prior-call recap (`priorCallFeedback` v2).
   *
   * @bucket 1 — Course parameter. No per-learner override (the recap is
   * derived per-(caller,module) but the *depth choice* is course-wide; a
   * per-learner depth would defeat predictable cost behaviour).
   *
   * - `enabled` — required when the field is present. Defaults to `false`
   *   when the whole key is absent. When false, loader returns the
   *   templated minimal path (#492 Slice 3.5 behaviour) — no AI call.
   * - `depth` — picker for synthesis depth. See {@link PriorCallRecapDepth}.
   *   When absent on `enabled: true`, defaults to `"minimal"` (still no
   *   AI call — explicit opt-in to standard/rich required).
   * - `dailyCap` — per-playbook per-UTC-day cap on synthesis calls. Default
   *   50. Server-side clamp at 500 (see `update_playbook_config` handler).
   *   When the cap is hit, the loader falls back to the templated path and
   *   writes an `AuditLog` row `action: "prior-call-recap-cap-exceeded"`.
   *
   * **Allowlist authority lives in `SystemSetting`**, NOT on this config.
   * The allowlist is admin-only (no AI tool writes it) — see
   * `lib/chat/ai-forbidden-fields.ts` for the structural guard.
   *
   * **Kill switch** is `process.env.PRIOR_CALL_RECAP_SYNTHESIS_ENABLED`
   * (strict `=== "true"`). Absent or any other value → templated path.
   *
   * @see docs/decisions/2026-05-22-tolerance-placement.md
   * @see lib/prompt/composition/loaders/synthesizePriorCallRecap.ts
   */
  priorCallRecap?: {
    enabled: boolean;
    depth?: PriorCallRecapDepth;
    dailyCap?: number;
  };
  /**
   * #494 E2 Slice 2.3 — when the picker should hard-lock terminal modules with
   * unmet prerequisites vs. show a soft-warning override modal. Default false
   * (soft warning), per IELTS learner-picks ethos. Set true for assessment
   * courses where premature attempts must be blocked.
   *
   * Wizard-settable via the `strictPrerequisites` graph node (boolean toggle).
   * Read at picker time by `lib/curriculum/recommend-module.ts` (E2 Slice 2.5).
   */
  strictPrerequisites?: boolean;
  /**
   * #492 E3 Slice 3.3 — minimum freshness threshold (in days) for the
   * interleave-review nudge. A mastered module qualifies for review when its
   * last call was at least `interleaveReviewMinDays` days ago. Default 3
   * (matches the typical 2-3 day spacing window). Set higher (~7) for
   * deeper-cycle courses, lower (~1) for daily-drill courses. Read by
   * `lib/prompt/composition/loaders/interleaveReview.ts`.
   */
  interleaveReviewMinDays?: number;
  /**
   * #494 E2 Slice 2.3 — when the course counts as "done":
   *   - "terminal-only" (default): the playbook's terminal module mastered
   *   - "all-modules": every module in the catalogue must be MASTERED
   *   - "any": at least one module MASTERED (open-ended courses)
   *
   * Author-only — NOT wizard-settable. Set in Playbook.config directly via
   * the course-design tab or by the course-ref parser. The wizard validator
   * rejects `update_setup({ completionMode })` (see WIZARD-DATA-BAG.md §4).
   * Read by `isCourseComplete()` (E2 Slice 2.7).
   */
  completionMode?: "all-modules" | "terminal-only" | "any";
  /**
   * Author-declared module catalogue (Issue #236). Populated from a Course
   * Reference document with `**Modules authored:** Yes`. When `moduleSource`
   * is "derived" or unset, today's transform-derived path runs unchanged.
   */
  modulesAuthored?: boolean;
  moduleSource?: ModuleSource;
  moduleSourceRef?: { docId: string; version: string };
  modules?: AuthoredModule[];
  /**
   * Defaults that apply to every Module unless that Module overrides. Stored
   * as Partial because authors may declare only some fields in their Module
   * Defaults block; the runtime fills any remaining fields from template
   * defaults. See per-field-defaults-with-warnings policy in spec #236.
   */
  moduleDefaults?: Partial<ModuleDefaults>;
  /**
   * Outcome statements parsed from `**OUT-NN: <statement>.**` bold headings
   * in the Course Reference. Keyed by outcome ID. Used to render the
   * AuthoredModulesPanel detail view with full text instead of bare IDs.
   * Issue #258.
   */
  outcomes?: Record<string, string>;
  pickerLayout?: PickerLayout;
  validationWarnings?: ValidationWarning[];
  /**
   * NEVER-COMPOSE — operator-only demo script (#1493, Epic #1442 Layer 4).
   *
   * Presenter notes + "wow moment" markers attached to specific Preview
   * lens bubbles. Set exclusively via the Preview annotation editor at
   * `/x/courses/[courseId]?tab=design&design_view=preview` — there is no
   * wizard path, AI tool, or runtime read.
   *
   * **This field MUST NOT be forwarded to prompt assembly.** Verified by a
   * structural grep against `lib/prompt/composition/` in the route test
   * (`tests/api/courses/demo-script.test.ts`). If a future composer wants
   * to surface demo metadata to the learner, add a NEW field; do not
   * teach composition to read `demoScript`.
   *
   * @see app/x/courses/[courseId]/_components/PreviewLens.tsx
   * @see app/api/courses/[courseId]/demo-script/route.ts
   */
  demoScript?: DemoScript;
  [key: string]: any;
}

/**
 * NEVER-COMPOSE — single sticky-note annotation on a Preview bubble (#1493).
 *
 * `bubbleRef` is the deterministic key derived from
 * `lens + caption + side + positional-index` by
 * `derivePreviewBubbleRef()` in `PreviewLens.tsx`. Strategy A from #1493 R1:
 * cheaper than stamping an explicit id; fragile if session-flow config
 * changes reorder bubbles — the Preview lens warns on load when a stored
 * `bubbleRef` does not match any current bubble.
 */
export interface DemoAnnotation {
  /** Deterministic key from `derivePreviewBubbleRef()`. */
  bubbleRef: string;
  /** Free-form note shown next to the bubble while presenting. */
  presenterNote: string;
  /** When true, the sticky note renders with a gold border + star icon. */
  isWowMoment: boolean;
  /** Optional pacing hint — seconds to dwell on this step. */
  durationSecOnStep?: number;
}

/**
 * NEVER-COMPOSE — operator-only demo script container (#1493).
 *
 * Stored on `PlaybookConfig.demoScript`. Persists across reloads via
 * `POST /api/courses/[courseId]/demo-script` (upsert by bubbleRef) and
 * `DELETE /api/courses/[courseId]/demo-script/[bubbleRef]` (remove).
 *
 * **Do not read this in any composer.**
 */
export interface DemoScript {
  annotations: DemoAnnotation[];
}

// ---------------------------------------------------------------------------
// AIConfig — extra fields beyond Prisma-generated type
// ---------------------------------------------------------------------------

export interface AIConfigExtended {
  transcriptLimit?: number;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Curriculum modules — canonical types
// ---------------------------------------------------------------------------

import type {
  CurriculumModule as PrismaCurriculumModule,
  LearningObjective,
} from "@prisma/client";

/** DB model + eager-loaded LOs — the standard shape from API responses */
export type CurriculumModuleWithLOs = PrismaCurriculumModule & {
  learningObjectives: LearningObjective[];
};

/**
 * Legacy JSON shape — used when parsing AI-generated curriculum output
 * and for backward-compat reads from Curriculum.notableInfo.modules[].
 * New code should use Prisma types directly.
 */
export interface LegacyCurriculumModuleJSON {
  id: string; // "MOD-1", "MOD-2" — maps to CurriculumModule.slug
  title: string;
  description?: string;
  learningOutcomes?: string[];
  assessmentCriteria?: string[];
  keyTerms?: string[];
  estimatedDurationMinutes?: number;
  sortOrder: number;
}

// ---------------------------------------------------------------------------
// Authored Modules — declared by course author in the Course Reference markdown
// (template v5.1+, `**Modules authored:** Yes` + `## Modules` section).
//
// Distinct from CurriculumModule: AuthoredModule is playbook-scoped, governs
// per-module tutor behaviour (mode, scoring, frequency, picker visibility),
// and is the source of truth for the learner-facing module picker. Persisted
// as JSON on Playbook.config.modules. Issue #236.
// ---------------------------------------------------------------------------

export type AuthoredModuleMode = "examiner" | "tutor" | "mixed";
export type AuthoredModuleFrequency = "once" | "repeatable" | "cooldown";
export type ModuleSource = "authored" | "derived";
export type PickerLayout = "tiles" | "rail";

/**
 * One author-declared module. Stable `id` is critical: learner progress and
 * dashboard rollups reference it across playbook republishes. Must match
 * /^[a-z][a-z0-9_]*$/ — enforced by the parser and the editor UI.
 */
export interface AuthoredModule {
  id: string;
  label: string;
  /** Whether this module appears in the learner's picker. Defaults to true. */
  learnerSelectable: boolean;
  mode: AuthoredModuleMode;
  /** Free-form duration string from the catalogue, e.g. "20 min fixed", "Student-led". */
  duration: string;
  /** Free-form scoring description from the catalogue, e.g. "All four", "LR + GRA only". */
  scoringFired: string;
  /** True when bands are spoken aloud (Mock Exam pattern). */
  voiceBandReadout: boolean;
  /** True when entering this module ends the current session (Baseline / Mock pattern). */
  sessionTerminal: boolean;
  frequency: AuthoredModuleFrequency;
  /**
   * Free-form reference into ## Content Sources, e.g.
   * "Source 4 — Baseline topic pool". Resolved later by the runtime.
   */
  contentSourceRef?: string;
  /** Outcome IDs this module primarily drills, e.g. ["OUT-01", "OUT-24"]. */
  outcomesPrimary: string[];
  /**
   * Sibling modules that should be completed before this one is offered.
   *
   * Two forms accepted (#1746 — Theme 5 widened shape):
   *
   * - **String** (legacy): just the sibling module id/slug. Treated as
   *   "needs at least one COMPLETED attempt on that module".
   * - **`{moduleId, minCompletions}`** (count-based): require ≥ N
   *   COMPLETED attempts on the sibling. e.g. IELTS Mock needs
   *   `{moduleId: "part1", minCompletions: 2}` ("2× Part 1 done").
   *
   * Reader (`lib/curriculum/check-module-unlock.ts::isModuleUnlocked`)
   * coerces both forms. Existing single-attempt prereqs migrate
   * implicitly — no schema change needed; the JSON shape widens by
   * union.
   *
   * STUDENT-role learners are blocked when prereqs are unmet (LOCKED
   * status). OPERATOR+ bypasses the gate (testers must not be locked
   * out — see role-bypass contract in `isModuleUnlocked`).
   *
   * Empty array when no prerequisites.
   */
  prerequisites: Array<string | { moduleId: string; minCompletions: number }>;
  /** Ordinal position in a structured course's lesson plan. Optional in continuous mode. */
  position?: number;
  /**
   * #495 Slice 4.2 — per-caller progress for the picker badge. Populated
   * only by the read-side picker endpoint
   * (`GET /api/courses/[id]/import-modules`) when a caller scope is
   * resolvable (STUDENT, or OPERATOR+ with `?callerId=`). NEVER stored on
   * `Playbook.config.modules`; the read-side enriches it on the fly.
   * DB `COMPLETED` is mapped to presentational `MASTERED` (mirrors E5
   * #493 Slice 5.2 / SimProgressPanel).
   */
  progress?: {
    status: "MASTERED" | "IN_PROGRESS" | "NOT_STARTED";
    callCount: number;
  };
  /**
   * #494 E2 Slice 2.4 — progression flags mirrored on `CurriculumModule`.
   *
   * `terminal` (default false): course-complete trigger when
   *   `Playbook.config.completionMode === "terminal-only"`. The terminal
   *   module's mastery flips the course done. Distinct from the existing
   *   `sessionTerminal` flag, which is about ending the current session.
   *
   * `coversModules` (default []): slug list of sibling modules whose
   *   evidence this module's calls ALSO count toward — IELTS Mock Exam
   *   produces scores attributed to part1/part2/part3 simultaneously.
   *
   * `masteryThreshold` (default null = use playbook-level 0.7):
   *   per-module override for the score required to mark this module
   *   MASTERED. Mirrors `CurriculumModule.masteryThreshold`.
   *
   * All three are optional on the authored JSON shape because authors
   * may omit them; the defensive reader in
   * `lib/curriculum/course-completion.ts::readModuleFlags()` fills
   * defaults at read time.
   */
  terminal?: boolean;
  coversModules?: string[];
  masteryThreshold?: number;

  /**
   * #1701 (epic #1700 Theme 1) — module-scoped settings layer (G8).
   *
   * All keys optional. Each maps to a G8 entry in
   * `lib/journey/setting-contracts.entries.ts`. Downstream readers
   * (endSession, cue scheduler, EXTRACT, composer transforms) gate
   * on `HF_FLAG_IELTS_MODULE_SETTINGS` during the migration window
   * per epic decision 5.
   *
   * Theme 1b will replace `cueCardPool` / `scheduledCues` JSON shapes
   * with dedicated Inspector primitives; the storage shape stays the
   * same.
   */
  settings?: AuthoredModuleSettings;
}

/** Whitelisted type for a declared profile-capture field (#1704 Theme 10). */
export type ProfileFieldType = "text" | "number" | "band";

/**
 * One declared profile field (#1704 Theme 10). EXTRACT walks
 * `profileFieldsToCapture` and writes typed `CallerAttribute` rows under the
 * course-agnostic `profile:*` namespace. Consumed by
 * `lib/pipeline/extract-profile-fields.ts`.
 */
export interface ProfileFieldToCapture {
  /** Namespaced `profile:<slug>` (e.g. "profile:targetBand"). */
  key: string;
  /** Tutor prompt verbatim — what the AI was instructed to ask. */
  prompt: string;
  /** Whitelist enum driving coercion + storage. */
  type: ProfileFieldType;
}

/** #1701 — Phase 1 G8 module-scoped settings (6 IELTS keys) + #1704 profile capture. */
export interface AuthoredModuleSettings {
  /** Min and target number of questions the tutor asks in this module. */
  questionTarget?: { min: number; target: number };
  /**
   * Module-scoped completion gate (sec). endSession marks the call
   * incomplete when `durationSeconds < minSpeakingSec` (Theme 9 /
   * #1703). Falls back to `DEFAULT_MIN_LEARNER_DURATION_SECONDS` (30s)
   * when unset.
   */
  minSpeakingSec?: number;
  /** Pool for Part 2 monologue. Session-start picks one → `Session.metadata.pinnedCard`. */
  cueCardPool?: Array<{ topic: string; bullets: string[] }>;
  /** Verbatim closing line (e.g. Assessment's "That gives me a good picture…"). */
  closingLine?: string;
  /** One-shot per-module orientation, gated by `orientationShown` on `CallerModuleProgress`. */
  firstTimeOrientationLine?: string;
  /**
   * Time-keyed tutor/examiner cues, consumed at runtime by the Theme 2
   * cue scheduler. Optional `phase` tag (#1762 Story C) marks the cue
   * as a phase transition — when the cue fires, the dispatcher writes
   * a phase boundary into `Session.metadata.phaseBoundaries`. Phase
   * naming is course-agnostic (IELTS Mock: `"p1"`, `"p2_prep"`,
   * `"p2_monologue"`, `"p3"`).
   */
  scheduledCues?: Array<{ at: number; text: string; phase?: string }>;
  /**
   * #1743 (epic #1700 Theme 2b — Theme 1 extension) — pool of subtle
   * scaffold strings the client-side stall detector picks from when the
   * learner goes silent. Module slug is the implicit discriminator
   * (Part 2 monologue pool vs Part 3 discussion pool).
   */
  scaffoldPool?: string[];
  /**
   * #1704 Theme 10 — declared conversational profile fields the AI should
   * capture during the session. EXTRACT (`extract-profile-fields.ts`) walks
   * this list, validates, and writes `CallerAttribute` rows under `profile:*`.
   */
  profileFieldsToCapture?: ProfileFieldToCapture[];
}

export interface ModuleDefaults {
  mode: AuthoredModuleMode;
  /** Inline single-issue correction loop is the default for tutor-mode practice. */
  correctionStyle: "single_issue_loop" | "freeform" | "none";
  /** "embedded_only" = no standalone theory turns; theory is interleaved with practice. */
  theoryDelivery: "embedded_only" | "standalone_permitted";
  bandVisibility: "hidden_mid_module" | "indicative_only" | "full";
  intake: "none" | "required" | "skippable";
}

/**
 * Validation finding from parsing a Course Reference. Drafts publish with
 * warnings present; production publish is blocked until warnings resolved.
 * See per-field-defaults-with-warnings policy in the spec.
 */
export interface ValidationWarning {
  /** Stable code for grouping/filtering, e.g. "MODULE_FIELD_DEFAULTED". */
  code: string;
  /** Human-readable message surfaced to authors. */
  message: string;
  /** Optional pointer to the offending entity, e.g. "modules.part2.mode". */
  path?: string;
  severity: "warning" | "error";
}

// ---------------------------------------------------------------------------
// Session.metadata — general-purpose per-session bag (epic #1700 Migration A).
//
// All keys are optional. Writers set only the keys they own; readers default
// missing keys to safe values. Distinct from `Session.voiceConfigSnapshot`
// (voice-specific, set once at session-start).
// ---------------------------------------------------------------------------

/**
 * Pinned card content rendered above SimChat for Part 2 cue card / Part 3
 * topic-focus banner / Mock subPhase cue cards (Theme 3, story TBD).
 */
export interface PinnedCardContent {
  /** Discriminator — drives the renderer variant. */
  kind: "cueCard" | "topicFocus";
  /** Cue card topic line OR Part 3 topic. */
  topic: string;
  /** Cue card bullets (kind="cueCard" only). */
  bullets?: string[];
  /** Optional secondary line beneath bullets (PPF prompt, note-taking instruction). */
  secondaryNote?: string;
  /** Part 3 focus area, e.g. "giving reasons" (kind="topicFocus" only). */
  focusArea?: string;
}

/**
 * Human-readable label for a CallScore.segmentKey value. Course-agnostic —
 * IELTS uses ("p1", "Part 1") / ("p2", "Part 2") / ("p3", "Part 3");
 * other courses define their own (Theme 6, story #1702).
 */
export interface SegmentLabel {
  key: string;
  label: string;
  ordinal: number;
}

/** Per-criterion score delta + Part 3 focus delta (Theme 11). */
export interface SessionScoreDeltas {
  /** Map of parameter slug → previous-session score. Composer renders the diff. */
  priorCriterionScores?: Record<string, number>;
  /** Part 3 focus parameter slug + (current - prior) delta. */
  focusDelta?: { parameterSlug: string; delta: number };
}

/**
 * Phase boundary captured at runtime by the cue-scheduler when a
 * phase-tagged cue fires (#1762 Story C). Closed-form boundary —
 * `endSec` is filled when the NEXT phase transition arrives; while a
 * phase is still in flight `endSec === startSec` (open boundary).
 * Reader: `lib/voice/audio-slice.ts` (Story D) uses these to pick
 * start/end timestamps for an audio slice.
 *
 * Phase name convention is course-agnostic — IELTS Mock uses
 * `"p1" / "p2_prep" / "p2_monologue" / "p3"`; other courses define
 * their own.
 */
export interface PhaseBoundary {
  phase: string;
  startSec: number;
  endSec: number;
}

export interface SessionMetadata {
  pinnedCard?: PinnedCardContent;
  segmentLabels?: SegmentLabel[];
  scoreDeltas?: SessionScoreDeltas;
  /** Overall band estimate for Mock sessions — mean-of-12, half-band rounded (Theme 6). */
  overallBand?: number;
  /**
   * Phase transitions captured at runtime by the cue-scheduler
   * (#1762 Story C). Append-only; readers depend on monotonic
   * `startSec` ordering.
   */
  phaseBoundaries?: PhaseBoundary[];
}
