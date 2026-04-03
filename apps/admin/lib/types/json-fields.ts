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

export interface GoalTemplate {
  type: string; // GoalType: LEARN, ACHIEVE, CHANGE, CONNECT, SUPPORT, CREATE
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
  lessonPlanModel?: string; // "direct_instruction" | "socratic" | etc.
  // Course goals — educator's stated learning outcomes (distinct from module LOs)
  courseLearningOutcomes?: string[];
  // Course-scoped welcome (overrides Domain.onboardingWelcome)
  welcomeMessage?: string;
  courseContext?: string;
  offboarding?: OffboardingConfig;
  /** Survey configuration — replaces buried phases[].surveySteps[] pattern */
  surveys?: {
    pre?: { enabled: boolean; questions: SurveyStepConfig[] };
    mid?: { enabled: boolean; questions: SurveyStepConfig[] };
    post?: { enabled: boolean; questions: SurveyStepConfig[] };
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
