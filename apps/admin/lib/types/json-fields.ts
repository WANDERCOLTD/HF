/**
 * Typed interfaces for Prisma Json? fields.
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
  /** Provenance — for debug panel + tests */
  source: {
    intake: "new-shape" | "legacy-welcome" | "defaults";
    onboarding: "new-shape" | "playbook-legacy" | "domain" | "init001";
    stops: "new-shape" | "synthesized-from-legacy";
    offboarding: "new-shape" | "playbook-legacy" | "defaults";
    welcomeMessage: "playbook" | "domain" | "generic";
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
  [key: string]: any;
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
