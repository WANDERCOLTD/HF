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
   * Sibling module IDs that should be completed before this one is offered.
   * Advisory only — the picker surfaces a "Recommended after X" hint but
   * never gates. Empty array when no prerequisites.
   */
  prerequisites: string[];
  /** Ordinal position in a structured course's lesson plan. Optional in continuous mode. */
  position?: number;
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
