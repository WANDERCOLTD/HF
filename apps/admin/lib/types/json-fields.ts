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
  /** Goals question. `question` overrides the hardcoded default; absent
   *  → fall through to the canonical "What would you most like to get
   *  out of this course?". @bucket A_intake */
  goals: { enabled: boolean; question?: string };
  /** About-you confidence prompt. `question` overrides the hardcoded
   *  default; absent → "On a scale of 1–5, how confident do you feel
   *  about this topic?". @bucket A_intake */
  aboutYou: { enabled: boolean; question?: string };
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
/**
 * Per–call-point AI override carried on `Playbook.config.aiOverrides` and
 * `Domain.config.aiOverrides`. Keyed by canonical CallPoint id (e.g.
 * `"pipeline.measure"`, `"pipeline.score_agent"`, `"compose.prompt"`).
 *
 * The Lattice resolver walks Playbook → Domain → AIConfig table →
 * SystemSetting `fallback:ai.default_models` → hardcoded `CALL_POINTS`
 * defaults (per `.claude/rules/ai-callpoint-cascade.md`). Each layer may
 * set ZERO or more of the four fields below — partial overrides are
 * merged top-down per field (model on Playbook + temperature on Domain
 * + maxTokens on the AIConfig admin row, etc.).
 *
 * Born of the live-incident chain (#1861 follow-on, 2026-06-17): the
 * stale Anthropic model id `claude-sonnet-4-20250514` in the System
 * fallback broke every Mock pipeline run because pipeline call points
 * had no per-Playbook override surface. This type closes that gap.
 */
export interface AICallPointOverride {
  /** `"claude" | "openai" | "mock"` — must match an `AIEngine`. */
  provider?: string;
  /** Provider-specific model id, e.g. `"claude-sonnet-4-6"`. */
  model?: string;
  /** 0..1; passed through to the call point's prompt. */
  temperature?: number;
  /** Provider max-output-tokens cap; passed through. */
  maxTokens?: number;
  /** Call timeout (ms); cascades into the AI client wrapper. */
  timeoutMs?: number;
}

/** Cascade map carried on `Playbook.config.aiOverrides` + `Domain.config.aiOverrides`. */
export type AIOverridesMap = Record<string, AICallPointOverride>;

export interface PlaybookConfig {
  systemSpecToggles?: Record<string, { isEnabled: boolean }>;
  goals?: GoalTemplate[];
  /**
   * Per-call-point AI overrides for this Playbook (#1868 — Lattice gap
   * closeout). Keys are CallPoint ids (`"pipeline.measure"` etc.). When
   * present, the resolver picks these BEFORE walking to the Domain layer
   * or the flat AIConfig / SystemSetting fallback.
   *
   * @bucket Course parameter — operator-tunable on the AI Config lens
   * (Phase 2, follow-on).
   */
  aiOverrides?: AIOverridesMap;
  /**
   * Story #2158 (epic #2135 follow-on) — per-course AI measurement
   * overrides. Today carries a single kill-switch:
   *
   *   - `disableLlmIeltsScoring` (default false): when true, the
   *     IELTS-MEASURE-001 AnalysisSpec is filtered OUT for this course
   *     even when `filterByBehaviorTargetParams` would otherwise run it
   *     (i.e. operator has IELTS skill BehaviorTargets on the playbook).
   *     Use to disable LLM-judged IELTS scoring on a course-by-course
   *     basis without re-engineering the BehaviorTargets.
   *
   * Read by `lib/pipeline/specs-loader.ts::filterByBehaviorTargetParams`
   * after the BehaviorTarget-presence check passes. Surfaced in the
   * Course Skills tab → Rubric Calibration lens → "AI Measurement
   * Method" card and a page-header pill on IELTS-shaped courses.
   * Protected by the `JourneySettingContract`
   * `aiMeasurementDisableLlmIeltsScoring` (G4 / I_scoring bucket).
   *
   * @bucket Course parameter — operator-tunable on the Skills tab.
   */
  aiMeasurement?: {
    /**
     * When true, the IELTS LLM-judged MEASURE spec (IELTS-MEASURE-001)
     * is filtered OUT for this course. Default false.
     */
    disableLlmIeltsScoring?: boolean;
  };
  onboardingFlowPhases?: OnboardingFlowPhases;
  physicalMaterials?: string;
  audience?: string;
  constraints?: string[]; // teacher-level "NEVER do this" pedagogical anti-patterns
  // Identity axes (stored by course-setup wizard)
  // #1995 — narrow to the union types instead of `string` so a future
  // `as string` cast at a chat-tool write site fails at compile time.
  // The runtime guards in `lib/content-trust/resolve-config.ts` defend
  // the DB-read side (where the JSON column may still carry a stale
  // wrong-union value seeded before #1995 landed).
  interactionPattern?: import("@/lib/content-trust/resolve-config").InteractionPattern;
  teachingMode?: import("@/lib/content-trust/resolve-config").TeachingMode;
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
  /**
   * #2050 — When true, learners who completed the intake on a prior enrolment
   * (any playbook) are bypassed: the WelcomeSurveyFlow short-circuits and
   * the learner lands on `/x/student` rather than re-answering PERSONALITY
   * + PRE_SURVEY questions. Detected via CallerAttribute(scope='PERSONALITY' | 'PRE_SURVEY')
   * submitted_at OR scope='INTAKE_CHAT' attrs (the intake projection from
   * EnrollmentIntake — `intake.*` keys). Default false — preserves the
   * existing every-enrollment intake behaviour.
   *
   * @bucket Course parameter — educator-tunable on the Intake lens (G1).
   */
  skipIntakeIfReturning?: boolean;
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
   * #2176 S1 — per-course assessable upfront → midpoint → end plan.
   *
   * Declarative; the runtime sampling engine at
   * `lib/assessment/sample-questions.ts` reads this to materialise
   * assessment moments. The Coverage gate at
   * `tests/lib/assessment/course-assessment-plan-coverage.test.ts`
   * cross-checks each declared `AssessmentMoment` against the
   * `Playbook.config.modules[]` list, the `firstCallMode` flag, and
   * the AnalysisSpec corpus.
   *
   * Operator framing: a course either declares a plan OR sets
   * `noAssessmentPlan: true` to opt out explicitly. Leaving the field
   * absent is a Coverage `gap` — the ratchet surfaces it for the
   * operator to decide.
   *
   * @bucket Course parameter — operator-tunable on the Assessment lens
   * (S7 follow-on; field shipped declaratively first per epic #2176).
   */
  assessmentPlan?: CourseAssessmentPlan;
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
   * #2052 sub-epic C — scoring consumer fields wired from the producer-only
   * registry into runtime. These fields are read by
   * `lib/prompt/composition/scoring-config.ts::resolveScoringConfig` (a
   * single chokepoint used by `transforms/modules.ts` for LO mastery,
   * `transforms/instructions.ts` for progress-signal directives, and
   * `lib/ops/compute-reward.ts` for REWARD strategy selection).
   *
   * Each setting is OPTIONAL — when absent, the consumer falls back to its
   * previous behaviour (tier preset / hardcoded thresholds / default strategy).
   *
   * Producer-only debt closed: see `lib/journey/producer-only-registry.ts`
   * (these 5 ids are no longer listed) + sub-epic C of epic #2049.
   *
   * @bucket Course parameter — operator-tunable via the Inspector.
   * @see lib/prompt/composition/scoring-config.ts
   * @see docs/CHAIN-CONTRACTS.md §3 (REWARD invariant — rewardStrategy is
   *      on the boundary between AGGREGATE outputs and REWARD reads)
   */
  /**
   * Mastery score required to mark a Learning Objective as passed. When set,
   * overrides the per-tier-preset default in `lib/prompt/composition/modules`
   * loMastery cut so the LLM treats LOs at-or-above this number as passed.
   * Range [0,1]. When unset the existing tierPresetId-derived cut applies
   * (byte-identical previous behaviour).
   */
  loMasteryThreshold?: number;
  /**
   * Mastery the learner must reach before a post-test / assessment stop
   * fires. Read by the instructions transform to gate
   * `assessment_readiness_directive` against the learner's aggregated
   * `behavior_profile:learning:*` rollup (or per-LO mastery when the
   * rollup is unavailable). Range [0,1]. Unset = no gating directive
   * (byte-identical previous behaviour — stop fires per existing rules).
   */
  assessmentReadinessThreshold?: number;
  /**
   * Progress-signal water marks. The instructions transform emits a
   * `progress_signal_directive` when the learner's aggregated engagement
   * mastery falls outside the band [lowWater, highWater]. Below lowWater
   * → "emphasise encouragement"; above highWater → "emphasise stretch".
   * Either side may be unset to disable that half of the band.
   *
   * Read from `behavior_profile:engagement:*` CallerAttributes produced
   * by BEH-AGG-001 (PR 75906d9d / commit a8234bf3 in lattice). When
   * the rollup is absent the consumer uses the average of per-LO
   * mastery as a fallback signal.
   */
  progressSignals?: {
    lowWater?: number;
    highWater?: number;
  };
  /**
   * Which reward signal the adaptive loop optimises for. Read by
   * `lib/ops/compute-reward.ts` to choose between three modes:
   *   - `"learner_mastery"` — weight behaviour-target diffs by mastery
   *     improvement (uses `behavior_profile:learning:*` aggregates when
   *     available; falls back to standard behavior+outcome blend).
   *   - `"educator_drift"` — weight behaviour-target diffs only; ignore
   *     outcome signals (operator's tuning is the truth).
   *   - `"blended"` — current default (behaviorWeight * behavior +
   *     outcomeWeight * outcome).
   * Unset = `"blended"` (byte-identical previous behaviour).
   */
  rewardStrategy?: "learner_mastery" | "educator_drift" | "blended";
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
   * #2055 (sub-epic F of #2049) — Call 1 framing variant of the recap.
   *
   * Distinct from `priorCallRecap` (Call 2+ history). When true on Call 1,
   * the quickstart transform emits a brief `opening_recap` field that
   * surfaces the learner's intake answers (goal / concern / confidence)
   * at the top of the prompt so the AI tutor opens with continuity rather
   * than a cold ask.
   *
   * Default false (absent → no recap section emitted). Calls 2+ ignore
   * this flag — `priorCallFeedback` handles continuity then.
   *
   * @bucket Course parameter. Educator-tunable on the Journey lens.
   * @see lib/prompt/composition/transforms/quickstart.ts (opening_recap field)
   */
  openingRecapEnabled?: boolean;
  /**
   * #2055 (sub-epic F of #2049) — cost gate for the AI-synthesised recap.
   *
   * When `false`, the loader short-circuits to the templated path WITHOUT
   * the AI call (saves the per-call billing). When `true` or undefined,
   * the existing gate sequence runs — env kill switch, `priorCallRecap`
   * config, allowlist, daily cap, depth dispatch, cache, synthesize.
   *
   * Distinct from `priorCallRecap.enabled`: that flag is the FEATURE
   * toggle (do we have a synthesised recap at all?); this one is the
   * COST toggle (when the feature is on, do we actually pay for AI?).
   * Operators flip this off when budget tightens without losing the
   * templated fallback path.
   *
   * Default: undefined → behaves as if true (preserves existing gate
   * sequence). Explicit false → short-circuit.
   *
   * @bucket Course parameter. Educator-tunable on the Journey lens.
   * @see lib/prompt/composition/loaders/priorCallFeedback.ts::maybeSynthesizeRecap
   */
  recapSynthesisEnabled?: boolean;
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
   * #2051 (epic #2049 sub-epic B) — Baseline assessment depth picker. Only
   * read when `firstCallMode === "baseline_assessment"` and the call is the
   * learner's first session. Drives a per-depth directive appended after the
   * `BASELINE_ASSESSMENT_RULE` critical rule:
   *   - `"light"` — 3 diagnostic questions, ~3 minutes
   *   - `"standard"` (default when absent) — 5 diagnostic questions, ~5 min
   *   - `"deep"` — 8 diagnostic questions + 2 confidence follow-up probes,
   *     ~8 minutes
   * When the field is ABSENT and the playbook is in baseline mode, the
   * runtime falls back to `"standard"` (preserves the 5-question pre-existing
   * implicit shape). When `firstCallMode !== "baseline_assessment"`, the
   * field is ignored — no directive emits.
   *
   * @bucket 1 — Course-level only. No cascade; not applicable to per-learner
   * overrides (depth choice is operator pedagogy).
   *
   * @see lib/prompt/composition/transforms/instructions.ts ::
   *      `resolveBaselineAssessmentDepth`
   * @see docs/groomed/2051-call1-shape-consumers.md §Contract 1
   */
  baselineAssessmentDepth?: "light" | "standard" | "deep";
  /**
   * #2051 (epic #2049 sub-epic B) — Call 1 module allow-list. When present
   * and non-empty, the scheduler's module candidate pool is filtered to
   * ONLY modules whose `id` or `slug` appears in this array on the
   * learner's first call. Modules outside the array are INELIGIBLE on
   * Call 1 (exclusive, not priority).
   *
   * Safety fallback: when every listed module is already mastered by the
   * learner, the filter is bypassed (full pool restored) and a
   * `[modules] firstCallCurriculumFocus: all listed modules already mastered`
   * log line fires — prevents Call 1 from stalling on a brand-new learner
   * who somehow completed every gated module out-of-band.
   *
   * When `lockedModule` is set (learner picked via the Module Picker), the
   * filter is BYPASSED — the learner's explicit choice wins.
   *
   * Absent or empty array → no filtering (existing behaviour). Does NOT
   * affect `completedModules`, `tpProgress`, or `loMasteryMap` — only the
   * scheduler's candidate pool input is narrowed.
   *
   * @bucket 1 — Course-level only. No cascade.
   *
   * @see lib/prompt/composition/transforms/modules.ts (filter applied just
   *      before `selectNextExchange`)
   * @see docs/groomed/2051-call1-shape-consumers.md §Contract 2
   */
  firstCallCurriculumFocus?: string[];
  /**
   * #2051 (epic #2049 sub-epic B) — Module sequencing policy. Tunes how the
   * scheduler resolves the next module to teach within a structured course
   * (`lessonPlanMode === "structured"`).
   *
   * - `"strict"` — module candidate pool is filtered to exclude any module
   *   whose `prerequisites` array contains a module slug NOT in
   *   `completedModules`. Hard gate at the scheduler pool layer; the AI
   *   cannot skip a prerequisite. Safety fallback: if all modules end up
   *   filtered (misconfigured course), the full pool is restored and a
   *   warning logs.
   * - `"interleaved"` — every 4th call (callNumber where
   *   `(callNumber - 1) % 4 === 3`) is forced to `mode: "review"` so the
   *   scheduler picks a mastered module for review. Aligns with the
   *   existing `interleaveReviewMinDays` review-freshness threshold (which
   *   is unaffected — it controls staleness, not cadence).
   * - `"learner_led"` (default-equivalent) — no scheduler change.
   *   Byte-identical to field absent. Safe low-friction default.
   *
   * `appliesTo: ["structured"]` on the contract — continuous courses
   * short-circuit with a console.warn + no-op (defensive; Inspector gate
   * prevents in practice).
   *
   * `strictPrerequisites` (sibling field) gates the UI picker. The two
   * are COMPLEMENTARY: `moduleSequencePolicy: "strict"` controls the
   * scheduler pool; `strictPrerequisites: true` hard-locks the picker
   * UI. An educator may set both.
   *
   * `lockedModule` (learner-picked) ALWAYS bypasses this filter — the
   * learner's explicit choice wins.
   *
   * @bucket 1 — Course-level only. No cascade.
   *
   * @see lib/prompt/composition/transforms/modules.ts (filter applied just
   *      before `selectNextExchange`)
   * @see docs/groomed/2051-call1-shape-consumers.md §Contract 3
   */
  moduleSequencePolicy?: "strict" | "interleaved" | "learner_led";
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
  /**
   * #2056 (G of #2049) — runtime gate flags previously producer-only.
   *
   * `agentTunerNlpEnabled` — when true, the operator-facing AgentTuner UI
   * (NLP behaviour-pill editor) is mounted on the Course Detail surface.
   * Default treats `undefined` as `false` — the panel is opt-in per course.
   * Read by `lib/journey/runtime-gates.ts::isAgentTunerNlpEnabled` and the
   * `<AgentTunerNlpGate>` wrapper. Operator-only writeGate enforced by the
   * `journey-setting` PATCH route.
   *
   * @bucket Course parameter — operator-only toggle on the Inspector.
   */
  agentTunerNlpEnabled?: boolean;
  /**
   * #2056 (G of #2049) — call-counter policy selector.
   *
   * - `"hard_cap"`: when the per-day session count reaches `maxCallsPerDay`,
   *   `createSession` REFUSES with a `CallRateLimitError`.
   * - `"soft_cap"`: when the per-day session count reaches `maxCallsPerDay`,
   *   `createSession` LOGS a warning to AppLog (`call.rate_limit.soft_cap_hit`)
   *   and allows the session.
   * - `"unlimited"`: cap is not consulted; `maxCallsPerDay` is ignored.
   *
   * Default treats `undefined` as `"unlimited"` so existing playbooks behave
   * exactly as they did pre-#2056. Read by
   * `lib/journey/runtime-gates.ts::resolveCallCountPolicy`.
   */
  callCountPolicy?: "hard_cap" | "soft_cap" | "unlimited";
  /**
   * #2056 (G of #2049) — per-day session-count cap.
   *
   * Consumed by `createSession` together with `callCountPolicy`. When unset
   * (or 0 / negative) the cap is treated as absent regardless of policy.
   * On hit:
   *   - `hard_cap` → throws `CallRateLimitError`; route emits
   *     `call.rate_limit.over_cap` AppLog + 429 response.
   *   - `soft_cap` → logs `call.rate_limit.soft_cap_hit` and proceeds.
   */
  maxCallsPerDay?: number;
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

export type AuthoredModuleMode = "examiner" | "tutor" | "mixed" | "quiz" | "mock-exam";
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
   * #2104 (epic #2102 S2) — per-module override of the course-level
   * `PlaybookConfig.strictPrerequisites` flag.
   *
   * Resolution at picker time:
   *   `mod.prerequisiteStrict ?? PlaybookConfig.strictPrerequisites ?? false`
   *
   * Use case: IELTS Speaking Practice keeps the course-level flag at
   * `false` (soft-warn for Parts 1/2/3 — free-pick ethos) while
   * setting `prerequisiteStrict: true` on the Mock Exam module to
   * hard-lock it until the practice prereqs are mastered. Without
   * this per-module knob the course-level flag forces all-or-nothing.
   *
   * Read by `LearnerModulePicker.tsx` (`lockedModuleIds` useMemo +
   * `handlePick`). The Soft-Warn / Hard-Lock modal pair is unchanged
   * — the override just selects which one fires for this module.
   *
   * Absent (default) → falls back to course-level flag = zero
   * regression for every existing course-ref.
   */
  prerequisiteStrict?: boolean;

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
   * #1932 (epic #1931 Template Authority) — module-scoped pool of topic
   * frames + questions, used by student-led practice modules (IELTS
   * Part 1 "Familiar Topics", IELTS Part 3 "Abstract Discussion", any
   * conversational drill where the tutor picks a topic and asks
   * pre-authored questions on it).
   *
   * Parallel to `cueCardPool` (Part 2 monologue) but the unit-of-content
   * is QUESTIONS not BULLETS — the tutor asks the questions one at a
   * time rather than treating the bullets as a single cue-card framing.
   *
   * Source-of-truth lives in a separate `## Frame N — Topic` (Part 1)
   * or `## Theme: X / ### Set N — Title` (Part 3) markdown file
   * referenced from the course-ref doc via
   * `topicPool: source:<id>` and resolved by
   * `lib/wizard/resolve-module-source-refs.ts` at projection time.
   *
   * Read by `lib/prompt/composition/transforms/instructions.ts::
   * resolveModuleTopicPool` — picks one topic deterministically by
   * `sharedState.callNumber % pool.length` and emits a directive
   * naming the topic + listing the questions. Gated by
   * `HF_FLAG_IELTS_MODULE_SETTINGS` during the migration window per
   * epic #1700 decision 5.
   */
  topicPool?: Array<{ topic: string; questions: string[] }>;
  /**
   * #1704 Theme 10 — declared conversational profile fields the AI should
   * capture during the session. EXTRACT (`extract-profile-fields.ts`) walks
   * this list, validates, and writes `CallerAttribute` rows under `profile:*`.
   */
  profileFieldsToCapture?: ProfileFieldToCapture[];
  /**
   * #1955 / epic #2145 S4 — G8 toggle gating the Part-3 focus-area pin.
   * When true (default ON for Part-3-shaped modules) and the
   * session-focus-policy runner (IELTS-P3-FOCUS-001) has written a
   * `CallerAttribute(key=session_focus:next_{moduleSlug})` row for the
   * learner, the composer emits a `[SESSION FOCUS]` directive AND
   * `select-pinned-card.ts::selectTopicFocusCard` writes
   * `Session.metadata.pinnedCard = {kind: "topicFocus", focusArea}` so
   * the learner sees a banner naming the technique they're working on.
   * When false, neither side fires.
   *
   * Has no effect on non-Part-3 modules — the consumer transform
   * (`transforms/session-focus.ts`) is course-agnostic but only fires
   * when a row for the locked module exists, and the
   * `IELTS-P3-FOCUS-001.spec.json` writer's `moduleScope.slugPattern`
   * restricts that to Part-3-shaped modules.
   */
  pinFocusArea?: boolean;
  /**
   * #1956 (Boaz/Eldar gap analysis Unit 1.3) — when true on an
   * exam / assessment module, the BASELINE_ASSESSMENT critical-rule
   * preamble is replaced by a silent variant that preserves the
   * diagnostic-only behavioural envelope (no teaching / no review /
   * no remediation / no corrections) but drops the test-announcement
   * framing and explicitly tells the tutor not to signal phase
   * breaks. Session runs as a natural conversation. Default false
   * (opt-in per module). Module-scoped — does NOT affect non-locked
   * sessions or non-exam modules.
   *
   * Reads in `lib/prompt/composition/transforms/preamble.ts::
   * computePreamble` when `firstCallMode === "baseline_assessment"`
   * AND the locked module's settings declare `silentMode: true`.
   * The Playbook-level `firstCallMode` and this module-level
   * `silentMode` are deliberately orthogonal: `firstCallMode`
   * controls structure (diagnostic-only flow); `silentMode`
   * controls announcement wording.
   *
   * @bucket exam
   */
  silentMode?: boolean;
  /**
   * #1954 (Boaz/Eldar gap analysis Unit 1.1) — when true on an
   * exam / assessment module, the AGGREGATE stage emits a personalised
   * `SessionLessonPlan` to `Session.metadata.lessonPlan` after the
   * four-criteria completion gate (#1953) fires "complete". The plan
   * identifies the weakest IELTS criterion in this session and
   * recommends a next module focus. Default: educators opt in per
   * module; the IELTS baseline fixture sets this to `true`.
   *
   * Reads in `app/api/calls/[callId]/pipeline/route.ts::
   * stageExecutors.AGGREGATE` inside the same try-block that runs the
   * four-criteria gate. Fire-and-forget — failures log but never
   * block the AGGREGATE stage.
   *
   * @bucket exam
   */
  generateLessonPlan?: boolean;
  /**
   * #2162 — per-module score readout policy. Drives when and how scores
   * reach the learner at the end of a module session. Per IELTS course-ref
   * v2.3 + HF-IELTS-Pre-Voice-Testing-Checklist Unit 5.
   *
   * Closes the v2.3-fixture exempt entry on `fixture-type-coverage` — the
   * key existed in the YAML but had no TypeScript type, so the wizard
   * parser silently dropped it. Typing it ends the silent-drop class for
   * this key.
   *
   * Consumer wiring follows in a follow-on PR (Results screen +
   * end-of-module readout). For now this types the data shape so the
   * wizard parser carries it through into `Playbook.config.modules[i].settings`.
   *
   * @bucket exam
   */
  scoreReadoutMode?: ScoreReadoutMode;
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
 * #2145 Phase A — first instance of the SessionFocus 4th-layer substrate.
 *
 * SessionFocus is a generic, per-course typed-union pattern that names the
 * LEARNER-FACING label set for a session's adaptive emphasis. The session
 * selection policy (a `session-focus-policy` AnalysisSpec) reads internal
 * weakness signals (CallerTarget.currentScore on Skill parameters, LO
 * mastery rollups, etc.) and writes ONE of these values to
 * `CallerAttribute(key = "session_focus:next_{moduleSlug}")`.
 *
 * **Architectural notes:**
 * - **Per-course union pattern**: every course that wants this surface
 *   declares its own typed union — e.g. `Part3TechniqueFocus` (IELTS
 *   Speaking Part 3), `CioCtoEmphasis` (TBD), `Ks2RevisionTechnique` (TBD).
 *   Branded types are optional; literal unions are sufficient for v1.
 * - **Values are LEARNER-FACING**: every value in the union is a string
 *   the learner can read on a "Today's focus" pin AND the tutor can
 *   reference verbatim in the prompt. Criterion names (e.g. "Lexical
 *   Resource"), parameter slugs (e.g. `skill_lexical_resource_lr`), and
 *   internal scoring axes are NEVER members of these unions — they live
 *   in INTERNAL_LABEL_REGISTRY (apps/admin/tests/lib/sim-chat/learner-ui-leak-coverage.test.ts)
 *   and are blocked from learner-UI dirs by that Coverage gate. The
 *   sibling `LEARNER_SAFE_REGISTRY` in the same test file whitelists
 *   these values so the leak gate doesn't trip on them.
 * - **BDD-anchored**: the 4 Part 3 technique values come from the IELTS
 *   BDD spec (`HF IELTS — BDD Stories US-P3-01` +
 *   `HF-IELTS-Pre-Voice-Testing-Checklist.md` Unit 4) — they are not
 *   pedagogy invented in code.
 *
 * Replaces the criterion-label shape PR #2134 / #1955 shipped. See epic
 * #2145 (Generic SessionFocus substrate) for the full architecture and
 * #2135 for the upstream MEASURE-spec chain that populates the input
 * scores.
 */
export type Part3TechniqueFocus =
  | "giving reasons"
  | "structuring an argument"
  | "handling a challenge"
  | "expanding an answer";

// ════════════════════════════════════════════════════════════════════
// CourseAssessmentPlan — 4th-layer primitive
// (epic #2176)
//
// Operator framing: "an assessment is extremely similar to cross-
// curriculum N questions". Assessment IS a typed sampling pattern over
// typed teaching content, NOT a separate SessionKind.
//
// Today's fragmentation: 4 enums (`SessionKindString.ASSESSMENT` —
// type-only ghost / `JourneyStopKind.assessment` — intake-time stop /
// `FirstCallMode.baseline_assessment` — first-call flag /
// `AuthoredModuleMode = "examiner" | "quiz" | "mock-exam"` — per-
// module behaviour) each do a different thing. None cross-check each
// other. This primitive composes them: at PR time the Coverage gate
// at `tests/lib/assessment/course-assessment-plan-coverage.test.ts`
// asserts each declared `AssessmentMoment` resolves to a real module
// with the right mode, real content sources, and a runnable scoring
// spec.
//
// Sibling 4th-layer primitives:
//   - `SessionFocus` / `Part3TechniqueFocus` (above) — per-session
//     emphasis label
//   - `LearnerShell` / `LearnerShellKind` (#2163, PR #2173) — per-
//     session capability frame
//   - `CourseAssessmentPlan` (this primitive) — per-course assessable
//     upfront → midpoint → end plan
//
// See epic #2176 for the full architecture, locked decisions, and
// slice plan. S1 (this PR) ships the types + Playbook config field.
// S2 ships the sampling engine. S3 ships the Coverage gate. S4
// resolves the SessionKind ghost decision. S5-S6 author per-course
// plans. S7 wires the rule file + lattice inventory.
// ════════════════════════════════════════════════════════════════════

/**
 * `LearnerShellKind` + `LEARNER_SHELL_KIND_VALUES` are declared as
 * the canonical PR #2173 substrate below (search for "epic #2163
 * S1 substrate"). The #2176 S1 primitives below this comment
 * reference both — they resolve to the canonical declarations via
 * normal TypeScript symbol lookup since both live in this same
 * module.
 */

/**
 * #2176 S1 — the FIVE assessable moments a course may declare.
 *
 * Each value names a typed sampling pattern over the curriculum's
 * teaching content:
 *
 * - `"upfront-baseline"` — diagnostic at first contact. Cross-LO
 *   sampling, lighter scoring. IELTS Baseline Assessment module is the
 *   canonical instance.
 * - `"midpoint-check"` — periodic per-Unit checks during the course.
 *   Per-unit scope. Used by CIO/CTO Pop Quiz (every Unit fires this).
 * - `"end-mock"` — terminal full-length simulation. Cross-Part sampling
 *   under examiner conditions. IELTS Mock Exam is the canonical
 *   instance.
 * - `"popquiz"` — short sampling burst (e.g. 5 MCQs) that can fire
 *   mid-module or at module-end. CIO/CTO Pop Quiz variant.
 * - `"rubric-board-chair"` — rubric-driven board-chair frame for the
 *   CIO/CTO Exam Assessment variant (per #2009 + #2015 follow-on).
 *
 * The value is **course-agnostic**. A course declares which moments
 * apply via `Playbook.config.assessmentPlan` (see `CourseAssessmentPlan`
 * below). Per-course extensions follow the same per-course typed-union
 * pattern PR #2173 established for `LearnerShellKind`.
 *
 * Locked decision 1 (epic #2176): new primitive lives here in
 * `lib/types/json-fields.ts` alongside the other 4th-layer primitives.
 */
export type AssessmentKind =
  | "upfront-baseline"
  | "midpoint-check"
  | "end-mock"
  | "popquiz"
  | "rubric-board-chair";

/**
 * Sibling const array for runtime enumeration of `AssessmentKind`.
 * Mirrors `AUTHORED_MODULE_MODE_VALUES` + `LEARNER_SHELL_KIND_VALUES`.
 * The Coverage gate at
 * `tests/lib/assessment/course-assessment-plan-coverage.test.ts` walks
 * this array; new union values land in the matrix automatically.
 */
export const ASSESSMENT_KIND_VALUES = [
  "upfront-baseline",
  "midpoint-check",
  "end-mock",
  "popquiz",
  "rubric-board-chair",
] as const satisfies readonly AssessmentKind[];

/**
 * #2176 S1 — Sampling scope across the curriculum.
 *
 * - `"per-unit"` — sample questions only from a single module (per-
 *   Unit Pop Quiz instance).
 * - `"cross-curriculum"` — sample across all modules in the
 *   curriculum (Mock Exam, Baseline diagnostic).
 * - `"weakest-skill-anchored"` — sample with preference for
 *   questions tagged with the caller's weakest skill (read from
 *   `CallerTarget.currentScore`).
 * - `"weakest-lo-anchored"` — sample with preference for the
 *   caller's weakest LO (read from `CallerAttribute(key =
 *   "lo_mastery:*")`).
 */
export type AssessmentSamplingScope =
  | "per-unit"
  | "cross-curriculum"
  | "weakest-skill-anchored"
  | "weakest-lo-anchored";

/**
 * Sibling const array for runtime enumeration of
 * `AssessmentSamplingScope`. Consumed by the AssessmentPlanEditor UI
 * (#2176 S1 build slice 5) and any sibling Coverage gate that needs
 * to walk every scope value.
 */
export const ASSESSMENT_SAMPLING_SCOPE_VALUES = [
  "per-unit",
  "cross-curriculum",
  "weakest-skill-anchored",
  "weakest-lo-anchored",
] as const satisfies readonly AssessmentSamplingScope[];

/**
 * #2176 S1 — Which content surface the sampler reads.
 *
 * - `"mcq"` — `ContentQuestion` rows (MCQ pool, per #2167 + #2009)
 * - `"cue-card"` — cue-card pool per `lib/wizard/resolve-module-source-refs.ts`
 * - `"topic-prompt"` — topic-pool per same
 * - `"scenario-probe"` — scenario-probe pool (CIO/CTO board-chair
 *   variant, per #2009 + #2015)
 */
export type AssessmentContentKind =
  | "mcq"
  | "cue-card"
  | "topic-prompt"
  | "scenario-probe";

/**
 * Sibling const array for runtime enumeration of
 * `AssessmentContentKind`. Consumed by the AssessmentMomentEditor UI
 * (#2176 S1 build slice 4) and the sampling engine.
 */
export const ASSESSMENT_CONTENT_KIND_VALUES = [
  "mcq",
  "cue-card",
  "topic-prompt",
  "scenario-probe",
] as const satisfies readonly AssessmentContentKind[];

/**
 * #2176 S1 — declarative sampling policy applied at assessment time.
 *
 * Carries WHAT to sample (`scope` + `contentKind`), HOW MANY items
 * (`count.{min, target, max}`), and OPTIONAL stratification rules
 * (e.g. "≥1 question per IELTS criterion"). Read by the sampling
 * engine at `lib/assessment/sample-questions.ts` (S2).
 *
 * Locked decision 2 (epic #2176): policy is data, not code. A new
 * sampling scope (e.g. "weakest-lo-anchored") is added to the union
 * here AND a branch in the engine consumes it. Course-specific
 * preferences live in `Playbook.config.assessmentPlan`, never in
 * imperative per-course code.
 */
export interface AssessmentSamplingPolicy {
  /** Sampling scope across the curriculum. See `AssessmentSamplingScope`. */
  scope: AssessmentSamplingScope;

  /**
   * Count band: engine MUST return between `min` and `max` items
   * inclusive, targeting `target`. When the pool can't satisfy `min`,
   * the engine returns `{ok: false, reason: "empty-pool"}` and the
   * caller (session creator) decides whether to block or substitute
   * with a smaller sample. Operator-visible AppLog subject fires on
   * empty-pool — never silent null (per `.claude/rules/verify-before-fix.md`).
   */
  count: { min: number; target: number; max: number };

  /** Which content surface the sampler reads. See `AssessmentContentKind`. */
  contentKind: AssessmentContentKind;

  /**
   * Optional stratification rules ensuring sampling distribution.
   * - `perCriterion` — minimum N items per scoring criterion (e.g.
   *   IELTS Mock declares `perCriterion: 1` so every criterion gets
   *   at least one observation).
   * - `perLO` — minimum N items per learning outcome.
   * - `minSkillCoverage` — fractional skill-axis coverage (0-1).
   *
   * Absent stratification = pure random sampling within the scope's
   * pool.
   */
  stratification?: { perCriterion?: number; perLO?: number; minSkillCoverage?: number };
}

/**
 * #2176 S1 — a single assessable moment in a course.
 *
 * Composes the four primitives:
 * - `kind` — WHICH assessment shape (upfront / midpoint / end / etc.)
 * - `moduleSlug` — WHICH module hosts the assessment (the wizard's
 *   `Playbook.config.modules[].slug` value). The Coverage gate cross-
 *   checks this slug exists in the playbook's modules list AND its
 *   `AuthoredModuleMode` matches the assessment kind.
 * - `samplingPolicy` — HOW the questions are selected (above).
 * - `shellKind` — WHICH learner shell wraps the session at runtime.
 *   The Coverage gate cross-checks this is a valid `LearnerShellKind`
 *   value. Typical mapping:
 *     - upfront-baseline / end-mock → `"exam"`
 *     - popquiz / midpoint-check → `"mcq-rounds"`
 *     - rubric-board-chair → `"exam"` (decision deferred per #2009)
 * - `scoringSpec` — slug of the `AnalysisSpec` that grades the
 *   session post-MEASURE. Coverage gate verifies the spec exists in
 *   the corpus at `docs-archive/bdd-specs/*.spec.json`.
 *
 * Locked decision 3 (epic #2176): one row per moment; courses with
 * multiple midpoints declare them as `midpoints: AssessmentMoment[]`.
 */
export interface AssessmentMoment {
  kind: AssessmentKind;
  /** Slug of the module that delivers this moment. Must exist in `Playbook.config.modules[]`. */
  moduleSlug: string;
  /** Declarative sampling policy (above). */
  samplingPolicy: AssessmentSamplingPolicy;
  /** Learner shell frame the session runs inside (see PR #2173). */
  shellKind: LearnerShellKind;
  /** Slug of the AnalysisSpec that scores the session (must exist in spec corpus). */
  scoringSpec: string;
}

/**
 * #2176 S1 — the per-course assessment plan.
 *
 * Lives at `Playbook.config.assessmentPlan` (JSON column extension —
 * no migration; declarative). Locked decision 4 (epic #2176): plan is
 * declarative, no imperative code per course.
 *
 * **Shape:**
 * - `upfront` — optional single moment fired at first-call (often a
 *   "Baseline Assessment" module). The Coverage gate cross-checks
 *   `FirstCallMode === "baseline_assessment"` ↔ `upfront.kind ===
 *   "upfront-baseline"` consistency.
 * - `midpoints` — ordered list of mid-course assessable moments.
 *   Empty / absent = no formal midpoint checks (continuous courses,
 *   coaching-led variants).
 * - `end` — optional terminal moment (Mock Exam / Exam Assessment).
 * - `noAssessmentPlan: true` — explicit operator declaration that
 *   this course has NO formal assessment plan by design (e.g. CIO/CTO
 *   Revision Aid, Big Five — coaching-led, no scoring axis). Coverage
 *   gate classifies this as `exempt-no-plan` rather than `gap`,
 *   forcing the operator to make the per-course decision once instead
 *   of leaving the plan field undefined.
 *
 * When both `noAssessmentPlan: true` AND any moment are present, the
 * runtime + Coverage gate prefer the moments and surface a warning
 * (`assessment.plan.contradiction` AppLog subject) — the explicit
 * exemption is treated as stale.
 */
export interface CourseAssessmentPlan {
  /** Optional first-call diagnostic moment. */
  upfront?: AssessmentMoment;
  /** Optional ordered list of mid-course assessable moments. */
  midpoints?: AssessmentMoment[];
  /** Optional terminal moment (Mock Exam / Exam Assessment). */
  end?: AssessmentMoment;
  /**
   * Explicit operator declaration: this course has NO formal
   * assessment plan by design. Coverage gate accepts as `exempt-no-
   * plan` (no `gap`). Do not combine with declared moments — see
   * interface JSDoc.
   */
  noAssessmentPlan?: true;
}

/**
 * #2163 Slice 1 — declare LearnerShell as a typed Lattice primitive.
 *
 * **What a shell is.** A `LearnerShell` is the capability FRAME a learner
 * experiences during a session. Today's only concrete shell is
 * `ExamModeShell` (Mock exam dark stripped UI with dual waveform instead
 * of chat feed); the implicit chat-feed default is the other one in
 * production. Both encode their rules — what to render, what to block,
 * what mode pill to show — as procedural JSX. This union types the
 * primitive so a shell becomes a DECLARATIVE capability map instead.
 *
 * **5th-layer companion to SessionFocus** (`Part3TechniqueFocus` above).
 * Both are session-scoped course-agnostic projections of internal state
 * into learner-facing structure. SessionFocus carries the emphasis
 * LABEL ("giving reasons"); LearnerShell carries the capability FRAME
 * (allowModuleSwitch / showTimer / chatFeedVisibility / colourTheme /
 * dismissOnEnd / etc.). They compose: a Mock exam session can have
 * `LearnerShell = "exam"` (frame) + `SessionFocus = "expanding an answer"`
 * (emphasis), and the learner sees both.
 *
 * **Internal-only.** The shell kind name (`"exam"` / `"chat-feed"` etc.)
 * is INTERNAL to the engine. The learner never sees the kind string in
 * their UI — they see the capability EFFECTS (timer visible / mode pill
 * copy / colour theme). Protected by extension to PR #2144's
 * `learner-ui-leak-coverage.test.ts` registry (S1, this slice).
 *
 * **Declarative selection (S2, separate PR).** A pure
 * `resolveLearnerShell(session, module) → { shellKind, capabilities }`
 * picks the shell from session+module context. No
 * `if (module.mode === "X")` branches scattered across UI files.
 *
 * **Initial values** (epic #2163 locked decision 1):
 * - `chat-feed` — default for tutor / mixed modes. Free-flow chat,
 *   visible scrollback, module-switch allowed, no timer.
 * - `exam` — examiner / mock-exam modes. Dual waveform replaces chat,
 *   module-switch blocked, timer hidden-internal (server enforces),
 *   dark theme, dismiss to results-screen.
 * - `mcq-rounds` — quiz mode. Cue card replaces chat feed, rounds
 *   counter replaces fill-bar, module-switch blocked mid-round.
 * - `results-readout` — post-exam Mock Results screen. Brand-theme,
 *   no chat, no timer, dismiss to next-module.
 * - `intake-wizard` — pre-call onboarding wizard. Full chat,
 *   module-switch blocked (intake is its own flow), no timer.
 *
 * **Per-course extensions** (epic #2163 locked decision 1, follow-on)
 * use the same per-course typed-union pattern that #2145 established
 * for SessionFocus.
 *
 * See epic #2163 for the full architecture, locked decisions, and S2-S7
 * slice plan. See `LearnerShellCapabilities` below for the capability
 * frame each shell kind populates via `SHELL_DEFAULTS`.
 */
export type LearnerShellKind =
  | "chat-feed"
  | "exam"
  | "mcq-rounds"
  | "results-readout"
  | "intake-wizard";

/**
 * Sibling const array for runtime enumeration of `LearnerShellKind`.
 * Mirrors the `AUTHORED_MODULE_MODE_VALUES` pattern used by
 * `tests/lib/sim-chat/mode-ui-coverage.test.ts`. Use this when you need
 * to iterate every shell kind (e.g. Coverage tests, exhaustiveness
 * checks, admin badge rendering). The paired vitest at
 * `tests/lib/types/learner-shell-types.test.ts` asserts this array
 * matches the union source-of-truth.
 */
export const LEARNER_SHELL_KIND_VALUES = [
  "chat-feed",
  "exam",
  "mcq-rounds",
  "results-readout",
  "intake-wizard",
] as const satisfies readonly LearnerShellKind[];

/**
 * #2163 Slice 1 — capability frame consumed by a learner shell.
 *
 * Every field declares ONE affordance the shell turns on / off / tunes.
 * Shell components consume the capability map at render time instead of
 * branching on the shell kind directly:
 *
 * ```tsx
 * // GOOD — declarative
 * {capabilities.showTimer === "visible" ? <Timer /> : null}
 *
 * // BAD — procedural, shell-kind-bound
 * {shellKind === "exam" ? null : <Timer />}
 * ```
 *
 * The declarative path is what makes the Coverage gate (S2) tractable:
 * Coverage walks each capability field and asserts at least one shell
 * consumer reads it. Procedural shell-kind branches defeat that walk.
 *
 * **Capability defaults are HF-canonical** (epic #2163 locked decision
 * 8). Per-course customisation lives in `PlaybookConfig.learnerShell`
 * (S5/S7) and is `disabled`-only — a course can disable a default
 * capability but cannot enable an arbitrary new one. Prevents drift
 * across courses.
 */
export interface LearnerShellCapabilities {
  /**
   * Whether the learner can switch to a different module mid-session.
   * `false` for exam / mcq-rounds (in-flight assessment must finish
   * before module switch is allowed) / results-readout / intake-wizard
   * (intake is its own flow). `true` for the default chat-feed shell.
   */
  allowModuleSwitch: boolean;
  /**
   * Timer affordance.
   * - `"visible"` — render an on-screen countdown / elapsed clock
   *   (no current shell uses this; reserved for future timed-but-
   *   visible scenarios e.g. lesson-pace pacing).
   * - `"hidden-internal"` — server enforces a time bound but the
   *   learner sees no clock (Mock exam, MCQ rounds — pacing is the
   *   examiner's job, not the learner's stress).
   * - `"none"` — no time bound applies.
   */
  showTimer: "visible" | "hidden-internal" | "none";
  /**
   * Progress affordance.
   * - `"fill-bar"` — continuous progress bar (chat-feed default —
   *   reflects module mastery / coverage).
   * - `"monologue-bar"` — Part 2 monologue countdown bar style
   *   (used by exam shells when the examiner is in monologue phase).
   * - `"mcq-counter"` — "Round 3 of 8" style counter for MCQ rounds.
   * - `"none"` — no progress affordance (intake-wizard / results-
   *   readout).
   */
  showProgressBar: "fill-bar" | "monologue-bar" | "mcq-counter" | "none";
  /**
   * Chat scrollback visibility.
   * - `"full"` — full chat feed with scrollback (chat-feed default,
   *   intake-wizard).
   * - `"cue-card-only"` — pinned cue card with no scrollback
   *   (mcq-rounds — the cue card IS the question; chat history is
   *   distracting).
   * - `"none"` — chat feed hidden entirely (exam / results-readout
   *   — dual waveform / results panel replaces it).
   */
  chatFeedVisibility: "full" | "cue-card-only" | "none";
  /**
   * Whether a "back to home" affordance is available mid-session.
   * `false` for exam / mcq-rounds / results-readout — these have
   * structured exits (dismiss to results-screen / next-module).
   * `true` for chat-feed / intake-wizard — these are interruptable.
   */
  allowBackToHome: boolean;
  /**
   * Visual identity theme.
   * - `"default"` — standard HF light theme (chat-feed / mcq-rounds
   *   / intake-wizard).
   * - `"dark"` — exam shell stripped dark UI (per `ExamModeShell`
   *   today).
   * - `"neutral"` — toned-down neutral palette (reserved).
   * - `"brand"` — course-brand accent palette (results-readout —
   *   the post-exam celebration screen).
   */
  colourTheme: "default" | "dark" | "neutral" | "brand";
  /**
   * Resource key for the mode pill label + icon. `null` when the shell
   * doesn't render a mode pill (intake-wizard, results-readout). The
   * key is resolved by the pill-renderer (`AuthoredModulesPanel` /
   * `LearnerModulePicker`) against the existing mode-pill resource
   * map. Authored shells declare their canonical pill key here so
   * pill copy + colour stay in one source.
   */
  modePillKey: string | null;
  /**
   * Where the learner lands when the session ends.
   * - `"home"` — back to module picker / FOH home (chat-feed,
   *   mcq-rounds, intake-wizard).
   * - `"results-screen"` — Mock results panel (exam shell).
   * - `"next-module"` — auto-advance to the next module in the
   *   curriculum (results-readout — operator continues the flow).
   */
  dismissOnEnd: "home" | "results-screen" | "next-module";
  /**
   * Stall-chip visual nudge behaviour (#1955-style).
   * - `"subtle-fade"` — fade in a small "still listening…" chip when
   *   the learner stalls (chat-feed default).
   * - `"none"` — no stall affordance (exam — the examiner sets the
   *   pace; mcq-rounds — the question itself drives; results-readout
   *   — no learner input; intake-wizard — wizard own stall UX).
   */
  stallChipBehaviour: "subtle-fade" | "none";
}

/**
 * HF-canonical default capability map per `LearnerShellKind` (epic
 * #2163 locked decision 8 — capabilities not customer-tunable for v1).
 *
 * Each entry is a complete `LearnerShellCapabilities` — no field is
 * optional, no shell falls back to "default behaviour" implicitly.
 * The paired vitest at
 * `tests/lib/types/learner-shell-types.test.ts` enforces Cartesian
 * completeness: every shell kind has every capability field defined.
 *
 * Source of truth for the per-shell rows: epic #2163 §"Default
 * capability map per shell" + `ExamModeShell.tsx` for the exam-shell
 * row.
 */
export const SHELL_DEFAULTS: Record<
  LearnerShellKind,
  LearnerShellCapabilities
> = {
  "chat-feed": {
    allowModuleSwitch: true,
    showTimer: "none",
    showProgressBar: "fill-bar",
    chatFeedVisibility: "full",
    allowBackToHome: true,
    colourTheme: "default",
    modePillKey: "tutor",
    dismissOnEnd: "home",
    stallChipBehaviour: "subtle-fade",
  },
  exam: {
    allowModuleSwitch: false,
    showTimer: "hidden-internal",
    showProgressBar: "monologue-bar",
    chatFeedVisibility: "none",
    allowBackToHome: false,
    colourTheme: "dark",
    modePillKey: "mock-exam",
    dismissOnEnd: "results-screen",
    stallChipBehaviour: "none",
  },
  "mcq-rounds": {
    allowModuleSwitch: false,
    showTimer: "hidden-internal",
    showProgressBar: "mcq-counter",
    chatFeedVisibility: "cue-card-only",
    allowBackToHome: false,
    colourTheme: "default",
    modePillKey: "quiz",
    dismissOnEnd: "home",
    stallChipBehaviour: "none",
  },
  "results-readout": {
    allowModuleSwitch: false,
    showTimer: "none",
    showProgressBar: "none",
    chatFeedVisibility: "none",
    allowBackToHome: false,
    colourTheme: "brand",
    modePillKey: null,
    dismissOnEnd: "next-module",
    stallChipBehaviour: "none",
  },
  "intake-wizard": {
    allowModuleSwitch: false,
    showTimer: "none",
    showProgressBar: "none",
    chatFeedVisibility: "full",
    allowBackToHome: true,
    colourTheme: "default",
    modePillKey: null,
    dismissOnEnd: "home",
    stallChipBehaviour: "none",
  },
};

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
  /**
   * #1954 (Boaz/Eldar gap analysis Unit 1.1) — personalised next-step
   * plan emitted post-AGGREGATE when this session's locked module
   * declared `generateLessonPlan: true` AND the four IELTS criteria
   * scored non-zero (the #1953 completion gate fired "complete").
   * Read by the Results screen "Your next steps" panel. Optional —
   * absent when the gate didn't fire OR the toggle was off.
   */
  lessonPlan?: SessionLessonPlan;
}

/**
 * #1954 — minimal next-step plan shape. Deterministic from per-criterion
 * IELTS CallScore rows: identifies the WEAKEST criterion (lowest score)
 * and emits a one-line focus rationale + recommended next module slug.
 * Not AI-generated. Cheap, stable, fire-and-forget at AGGREGATE end.
 */
export interface SessionLessonPlan {
  /** Canonical IELTS criterion id — one of `skill_fluency_and_coherence_fc`,
   *  `skill_lexical_resource_lr`, `skill_grammatical_range_and_accuracy_gra`,
   *  `skill_pronunciation_p`. The weakest of the four scored on this session. */
  focusCriterion: string;
  /** Human-readable label for the focus criterion (educator + learner facing). */
  focusLabel: string;
  /** The numeric score (0..1) the focus criterion achieved on this session. */
  focusScore: number;
  /** One-line rationale rendered under the panel headline. */
  reason: string;
  /** Slug of the next module the rollup recommends (when computable). */
  nextRecommendedModuleSlug?: string;
  /** UTC ISO timestamp the plan was emitted. */
  emittedAt: string;
}

// ---------------------------------------------------------------------------
// #2162 — BDD-defined typed unions (CueCardType / StallType / ScoreReadoutMode).
//
// Three learner-experienced enums declared by the IELTS BDD spec + course-ref
// v2.3 that previously existed only as freeform strings or YAML keys without
// TypeScript typing. Each is a 4th-layer Lattice primitive — sibling to
// `Part3TechniqueFocus` (#2145 Phase A), `LearnerShellKind` (#2163 S1),
// `AssessmentKind` (#2176 S1). Big-matrix audit (PR #2144 conversation,
// 2026-06-21) catalogued these as the remaining gap; this section closes it.
//
// Each union carries a `*_VALUES` const tuple so runtime callers can
// enumerate canonical values (mirrors AUTHORED_MODULE_MODE_VALUES and
// LEARNER_SHELL_KIND_VALUES patterns consumed by Coverage gates).
// ---------------------------------------------------------------------------

/**
 * #2162 — cue card type.
 *
 * Drives the Part 2 (and Mock Part 2) prep-phase topic prompt. The cue card
 * either anchors on a personal topic ("Describe a person who has influenced
 * you...") or an abstract topic ("Describe an invention that changed the
 * world..."). Per BDD US-P2-01 (HF IELTS — BDD Stories) + IELTS course-ref
 * v2.3 Source 5 (cue card pool).
 *
 * Learner-visible: the cue card text itself is learner-facing; the type
 * label ("personal" / "abstract") is internal — used by the prep-phase
 * transform to vary the prompt scaffold, not surfaced to the learner.
 */
export type CueCardType = "personal" | "abstract";

/** Canonical enumeration. Sibling to AUTHORED_MODULE_MODE_VALUES. */
export const CUE_CARD_TYPE_VALUES = ["personal", "abstract"] as const;

/**
 * #2162 — stall type.
 *
 * Drives the Part 3 scaffold trigger — which scaffold pool entry the tutor
 * picks when the learner stalls. Per BDD US-P3-02b (HF IELTS — BDD Stories)
 * + IELTS course-ref v2.3 Source 7 (Part 3 stall scaffolds discussion,
 * scaffold-tag taxonomy).
 *
 * Each value names a distinct stall SHAPE the tutor recognises:
 * - `i-dont-know` — explicit "I don't know" without a follow-on attempt
 * - `opinion-gap` — learner has no opinion on the asked topic
 * - `abstraction-freeze` — learner stalls on the abstract framing
 * - `vocabulary-search` — learner searching for a word, partial speech
 * - `blank-out` — long silence with no signal
 *
 * Internal-only label per Lattice learner-UI leak Coverage; the tutor's
 * prompt is what reaches the learner, never the tag name.
 */
export type StallType =
  | "i-dont-know"
  | "opinion-gap"
  | "abstraction-freeze"
  | "vocabulary-search"
  | "blank-out";

/** Canonical enumeration. Sibling to AUTHORED_MODULE_MODE_VALUES. */
export const STALL_TYPE_VALUES = [
  "i-dont-know",
  "opinion-gap",
  "abstraction-freeze",
  "vocabulary-search",
  "blank-out",
] as const;

/**
 * #2162 — score readout mode.
 *
 * Drives when and how per-criterion / overall scores reach the learner at
 * the end of a module session. Per IELTS course-ref v2.3 (per-module
 * `scoreReadoutMode` field on Baseline / Part 2 / Part 3 / Mock modules)
 * + HF-IELTS-Pre-Voice-Testing-Checklist.md Unit 5 (Mock Results screen).
 *
 * - `on-screen` — bands shown in the on-screen Results panel but NOT
 *   stated aloud by the tutor (e.g. Baseline — warmer-than-Mock close)
 * - `end-of-module-on-screen` — bands shown only at the end-of-module
 *   readout, not during the session (Part 2 / Part 3 default)
 * - `aloud-with-indicative-qualifier` — tutor states bands aloud with
 *   an "indicative" qualifier (Mock Exam — the only mode that says
 *   bands aloud)
 *
 * Learner-visible: yes. The READOUT MODE is internal but the consequence
 * (whether bands are spoken vs displayed) is learner-experienced.
 */
export type ScoreReadoutMode =
  | "on-screen"
  | "end-of-module-on-screen"
  | "aloud-with-indicative-qualifier";

/** Canonical enumeration. Sibling to AUTHORED_MODULE_MODE_VALUES. */
export const SCORE_READOUT_MODE_VALUES = [
  "on-screen",
  "end-of-module-on-screen",
  "aloud-with-indicative-qualifier",
] as const;
