/**
 * Composition Pipeline Types
 *
 * Shared interfaces for the declarative prompt composition system.
 * COMP-001 spec sections are parsed into these types, and the
 * CompositionExecutor processes them.
 */

// === SPEC SECTION DEFINITION ===
// Read from COMP-001 spec's `sections` array

export interface CompositionSectionDef {
  id: string;
  name: string;
  priority: number;
  /** Named loader(s) to fetch data, or "_assembled" for cross-section references */
  dataSource: string | string[];
  activateWhen: ActivationCondition;
  fallback: FallbackAction;
  /** Named transform(s) from registry. Array = chained pipeline. Null = pass through. */
  transform: string | string[] | null;
  /** Section-specific config (limits, thresholds, etc.) */
  config?: Record<string, any>;
  /** Key in the final llmPrompt output */
  outputKey: string;
  /** IDs of sections that must run before this one */
  dependsOn?: string[];
}

export interface ActivationCondition {
  condition:
    | "always"
    | "dataExists"
    | "curriculumDataExists"
    | "callerHasDomain"
    | "callCount == 0"
    | string;
}

export interface FallbackAction {
  action: "omit" | "null" | "emptyObject" | "skip";
  value?: any;
}

// === RESOLVED SPEC TYPES ===

export interface ResolvedSpec {
  name: string;
  slug?: string;
  config: any;
  description?: string | null;
  /** Base archetype ID (e.g., "TUT-001") — triggers merge at composition time */
  extendsAgent?: string | null;
}

export interface ResolvedSpecs {
  identitySpec: ResolvedSpec | null;
  voiceSpec: ResolvedSpec | null;
}

// === LOADED DATA CONTEXT ===
// Raw data loaded by SectionDataLoader, keyed by loader name

export interface LoadedDataContext {
  caller: CallerData | null;
  memories: MemoryData[];
  personality: PersonalityData | null;
  learnerProfile: LearnerProfileData | null;
  recentCalls: RecentCallData[];
  callCount: number;
  behaviorTargets: BehaviorTargetData[];
  callerTargets: CallerTargetData[];
  callerAttributes: CallerAttributeData[];
  goals: GoalData[];
  /** Stacked playbooks for domain, ordered by sortOrder (first = highest priority) */
  playbooks: PlaybookData[];
  systemSpecs: SystemSpecData[];
  /** INIT-001 onboarding spec for first-call defaults (null if not found) */
  onboardingSpec: OnboardingSpecData | null;
  /** Subject-based content sources for the caller's domain */
  subjectSources?: SubjectSourcesData | null;
  /** Onboarding session for caller's current domain */
  onboardingSession?: any;
  /** Curriculum assertions (approved teaching points) from ContentAssertion table */
  curriculumAssertions?: CurriculumAssertionData[];
  /** Extracted questions from ContentQuestion table */
  curriculumQuestions?: CurriculumQuestionData[];
  /** Extracted vocabulary from ContentVocabulary table */
  curriculumVocabulary?: CurriculumVocabularyData[];
  /** Teaching depth from Subject config (null = use spec default) */
  teachingDepth?: number | null;
  /** Open actions (pending/in-progress) for prompt awareness */
  openActions?: OpenActionData[];
  /** Visual aids (extracted images) linked to the caller's domain subjects */
  visualAids?: VisualAidData[];
  /** Course instructions (tutor rules) from COURSE_REFERENCE document type */
  courseInstructions?: CourseInstructionData[];
}

/** Visual aid data loaded for prompt and content catalog */
export interface VisualAidData {
  mediaId: string;
  fileName: string;
  captionText: string | null;
  figureRef: string | null;
  chapter: string | null;
  mimeType: string;
}

/** Open action data loaded for voice prompt integration */
export interface OpenActionData {
  type: string;
  title: string;
  description: string | null;
  assignee: string;
  priority: string;
  dueAt: Date | null;
  createdAt: Date;
}

/** ContentAssertion data loaded for teaching content */
export interface CurriculumAssertionData {
  id: string;
  assertion: string;
  category: string;
  chapter: string | null;
  section: string | null;
  pageRef: string | null;
  tags: string[];
  trustLevel: string | null;
  examRelevance: number | null;
  learningOutcomeRef: string | null;
  /** FK to LearningObjective — single source of truth for LO linkage (#142) */
  learningObjectiveId: string | null;
  sourceName: string;
  sourceTrustLevel: string;
  /** Source ID for grouping assertions by document */
  sourceId: string;
  /** Source delivery order (from SubjectSource.sortOrder) — lower = teach first */
  sourceOrder: number;
  /** Document type of the source (TEXTBOOK, READING_PASSAGE, QUESTION_BANK, etc.) */
  sourceDocumentType: string | null;
  // Pyramid hierarchy fields
  depth: number | null;
  parentId: string | null;
  orderIndex: number;
  topicSlug: string | null;
  /** Teach method tag from extraction (recall_quiz, definition_matching, etc.) */
  teachMethod?: string | null;
}

/** Course instruction data from COURSE_REFERENCE documents (tutor rules, not student content) */
export interface CourseInstructionData {
  id: string;
  assertion: string;
  category: string;
  chapter: string | null;
  section: string | null;
  tags: string[];
  sourceName: string;
  depth: number | null;
  parentId: string | null;
  orderIndex: number;
}

export interface CurriculumQuestionData {
  id: string;
  questionText: string;
  questionType: string;
  options: any;
  correctAnswer: string | null;
  chapter: string | null;
  learningOutcomeRef: string | null;
  difficulty: number | null;
  skillRef: string | null;
  metadata: any;
}

export interface CurriculumVocabularyData {
  id: string;
  term: string;
  definition: string;
  partOfSpeech: string | null;
  exampleUsage: string | null;
  topic: string | null;
}

/** INIT-001 onboarding spec shape */
export interface OnboardingSpecData {
  id: string;
  slug: string;
  name: string;
  config: {
    /** Default behavior targets for new callers */
    defaultTargets?: Record<string, {
      value: number;
      confidence: number;
      rationale?: string;
    }>;
    /** First call flow phases */
    firstCallFlow?: {
      phases: Array<{
        phase: string;
        duration: string;
        priority: string;
        goals: string[];
        avoid: string[];
      }>;
      successMetrics?: string[];
    };
    /** Welcome templates by domain type */
    welcomeTemplates?: Record<string, string>;
  } | null;
}

// === ASSEMBLED CONTEXT ===
// Accumulates section outputs as transforms run

export interface AssembledContext {
  loadedData: LoadedDataContext;
  sections: Record<string, any>;
  resolvedSpecs: ResolvedSpecs;
  sharedState: SharedComputedState;
  specConfig: Record<string, any>;
}

// === SHARED COMPUTED STATE ===
// Computed once, shared across transforms (modules, session flow, etc.)

export interface CurriculumMetadata {
  type: 'sequential' | 'branching' | 'open-ended';
  trackingMode: 'module-based' | 'competency-based';
  moduleSelector: string;
  moduleOrder: string;
  progressKey: string;
  masteryThreshold: number;
}

export interface SharedComputedState {
  /** Delivery channel — 'text' for sim chat, 'voice' for VAPI/phone */
  channel: 'text' | 'voice';
  modules: ModuleData[];
  isFirstCall: boolean;
  daysSinceLastCall: number;
  completedModules: Set<string>;
  estimatedProgress: number;
  lastCompletedIndex: number;
  moduleToReview: ModuleData | null;
  nextModule: ModuleData | null;
  reviewType: string;
  reviewReason: string;
  thresholds: { high: number; low: number };
  /** Curriculum metadata (from CurriculumModule records or legacy spec) */
  curriculumMetadata?: CurriculumMetadata | null;
  /** Curriculum display name (from Curriculum model) */
  curriculumName?: string | null;
  /** Spec slug or curriculum slug used as progress storage key prefix */
  curriculumSpecSlug?: string;
  /** Whether first call in current domain (for domain-switch re-onboarding) */
  isFirstCallInDomain?: boolean;
  /** Whether this is the learner's final teaching session (by budget, scheduler mastery, or module completion) */
  isFinalSession: boolean;
  /**
   * Per-module learner progress, keyed by `CurriculumModule.id`. Populated only
   * when the playbook has `modulesAuthored === true`. First place
   * `CallerModuleProgress` reads land in the COMPOSE stage — the per-learner
   * dimension entering a section that has been per-module-only until now.
   * Used by the tutor opening narrative ("you've done Baseline twice") and
   * future in-chat module selection (Slice 2 of #266).
   */
  moduleAttemptCounts?: Record<string, {
    callCount: number;
    status: "NOT_STARTED" | "IN_PROGRESS" | "COMPLETED";
    completedAt: Date | null;
  }>;
  /** True when at least one module has callCount > 0. Gates the tutor's module-aware opening line. */
  hasAttemptData?: boolean;
  /**
   * #274 Slice A: the authored module the learner explicitly picked via the
   * Module Picker. When set, the scheduler is BYPASSED — `nextModule` is
   * forced to the locked choice. _quickStart.this_session and first_line
   * narrate the locked focus, and discovery_guidance suppresses
   * "what to work on" prompts.
   *
   * Resolution: matched by id from `Playbook.config.modules`. If
   * `specConfig.requestedModuleId` doesn't resolve, this stays null and
   * the scheduler runs as today (silent fallback, warn log).
   */
  lockedModule?: ModuleData | null;
  /** Call number (1-based) — this is the Nth call for this learner */
  callNumber: number;
  /** Synthetic lesson plan entry built from scheduler working set (for downstream transform compat) */
  lessonPlanEntry?: {
    session: number;
    type: string;
    moduleId: string | null;
    moduleLabel: string;
    label: string;
    phases?: null;
    learningOutcomeRefs?: string[] | null;
    assertionIds?: string[] | null;
    vocabularyIds?: null;
    questionIds?: null;
    media?: null;
  } | null;
  /** Working set selected by scheduler (null if scheduler didn't run or no modules) */
  workingSet?: {
    assertionIds: string[];
    reviewIds: string[];
    newIds: string[];
    selectedLOs?: Array<{ id: string; ref: string; moduleId: string; status: string }>;
  } | null;
  /** Map of LO ref → LO id for FK-based filtering (#142) */
  loRefToIdMap?: Map<string, string>;

  // ── Scheduler v1 (#155) + retrieval practice (#164) ──

  /**
   * The scheduler's decision for the current call. Populated in continuous
   * mode by modules.ts after calling selectNextExchange. Undefined in
   * structured mode (transforms should check for presence before reading).
   *
   * `mode` drives retrieval question count (teach=light, assess=full,
   * review=consolidation). `outcomeId` targets which LO to assess.
   */
  schedulerDecision?: {
    mode: "teach" | "review" | "assess" | "practice";
    outcomeId: string | null;
  } | null;

  /**
   * The scheduler policy in effect for this call. Used by the retrieval
   * transform to read preset defaults when no archetype-level override
   * exists in the COMP-001 spec config. Populated alongside
   * schedulerDecision in continuous mode.
   */
  schedulerPolicy?: {
    name: string;
    retrievalQuestions: { teach: number; assess: number; review: number };
    retrievalBloomFloor: string;
    retrievalCadence: number;
  } | null;
}

export interface ModuleData {
  id?: string;
  slug: string;
  name: string;
  description?: string | null;
  sortOrder?: number;
  sequence?: number;
  masteryThreshold?: number | null;
  prerequisites?: string[];
  concepts?: string[];
  /**
   * Learner-facing outcomes — the LO descriptions safe to surface in the
   * student conversation. After #317 these are sourced from
   * `performanceStatement ?? description` for `learnerVisible=true` rows
   * only. System-only LOs (rubric / score-explainer / item-gen-spec)
   * are excluded — they live on `assessorOutcomes` instead.
   */
  learningOutcomes?: string[];
  /**
   * #317 — system-only LOs grouped by role for the assessor / scoring /
   * item-generator / tutor-instruction prompts. NEVER surfaced in the
   * learner conversation.
   *
   *   - ASSESSOR_RUBRIC: rubric criteria the assessor uses to grade.
   *   - ITEM_GENERATOR_SPEC: boundary specs the item generator consumes.
   *   - SCORE_EXPLAINER: meta-knowledge for the score-reveal disclosure.
   *   - TEACHING_INSTRUCTION: tutor-strategic moves / diagnostics — joins
   *     the courseInstructions channel rather than the rubric.
   */
  assessorOutcomes?: {
    rubric: string[];              // ASSESSOR_RUBRIC
    itemGenSpec: string[];         // ITEM_GENERATOR_SPEC
    scoreExplainer: string[];      // SCORE_EXPLAINER
    teachingInstruction: string[]; // TEACHING_INSTRUCTION
  };
  /** Module content from spec config - the actual curriculum material */
  content?: Record<string, any>;
  [key: string]: any;
}

// === INDIVIDUAL DATA TYPES ===
// Mirror Prisma select shapes from route.ts queries

export interface CallerData {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  domain: {
    id: string;
    slug: string;
    name: string;
    description: string | null;
    onboardingWelcome?: string | null;
    onboardingFlowPhases?: unknown;
    onboardingDefaultTargets?: unknown;
    onboardingIdentitySpecId?: string | null;
    onboardingIdentitySpec?: { id: string; slug: string; name: string } | null;
  } | null;
  domainId?: string | null;
  /** @deprecated Use cohortMemberships instead. Legacy single-cohort FK during migration. */
  cohortGroup?: {
    id: string;
    name: string;
    owner: { id: string; name: string | null };
  } | null;
  /** Multi-cohort memberships (preferred over legacy cohortGroup) */
  cohortMemberships?: Array<{
    cohortGroup: {
      id: string;
      name: string;
      owner: { id: string; name: string | null };
    };
  }>;
}

export interface MemoryData {
  category: string;
  key: string;
  value: string;
  confidence: number;
  evidence: string | null;
  extractedAt: Date | null;
  decayFactor: number;
}

export interface PersonalityData {
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
  preferredTone: string | null;
  preferredLength: string | null;
  technicalLevel: string | null;
  confidenceScore: number | null;
}

export interface LearnerProfileData {
  learningStyle: string | null;
  pacePreference: string | null;
  interactionStyle: string | null;
  priorKnowledge: Record<string, string>;
  preferredModality: string | null;
  questionFrequency: string | null;
  sessionLength: string | null;
  feedbackStyle: string | null;
  lastUpdated: string | null;
}

export interface RecentCallData {
  id: string;
  transcript: string | null;
  createdAt: Date;
  scores: Array<{
    parameterId: string;
    score: number;
    parameter: { name: string } | null;
  }>;
}

export interface BehaviorTargetData {
  parameterId: string;
  targetValue: number;
  confidence: number;
  scope: string;
  playbookId?: string | null;
  parameter: {
    name: string | null;
    interpretationLow: string | null;
    interpretationHigh: string | null;
    domainGroup: string | null;
  } | null;
}

export interface CallerTargetData {
  parameterId: string;
  targetValue: number;
  confidence: number;
  parameter: {
    name: string | null;
    interpretationLow: string | null;
    interpretationHigh: string | null;
    domainGroup: string | null;
  } | null;
}

export interface CallerAttributeData {
  key: string;
  scope: string;
  domain: string | null;
  valueType: string;
  stringValue: string | null;
  numberValue: number | null;
  booleanValue: boolean | null;
  jsonValue: any;
  confidence: number | null;
  sourceSpecSlug: string | null;
}

export interface GoalData {
  id: string;
  type: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  progress: number;
  playbookId: string | null;
  isAssessmentTarget: boolean;
  assessmentConfig: { threshold?: number; readinessSpecSlug?: string } | null;
  contentSpec: {
    id: string;
    name: string;
    slug: string;
  } | null;
  playbook: {
    id: string;
    name: string;
  } | null;
  startedAt: Date | null;
}

export interface PlaybookData {
  id: string;
  name: string;
  status: string;
  config?: any;
  domain: { id: string; name: string; description: string | null } | null;
  group?: { id: string; name: string; identityOverride: any } | null;
  items: Array<{
    spec: SystemSpecData | null;
  }>;
}

export interface SubjectSourcesData {
  subjects: Array<{
    id: string;
    slug: string;
    name: string;
    defaultTrustLevel: string;
    qualificationRef: string | null;
    teachingProfile?: string | null;
    teachingOverrides?: Record<string, unknown> | null;
    sources: Array<{
      slug: string;
      name: string;
      /** ContentSource.documentType — drives tutorOnly. May be null for legacy rows. */
      documentType?: string | null;
      /**
       * True for COURSE_REFERENCE / LESSON_PLAN / QUESTION_BANK / POLICY_DOCUMENT
       * (i.e. anything not in STUDENT_VISIBLE_DOC_TYPES). Consumers that build a
       * "share with learner" media palette MUST exclude these. CONTENT-PIPELINE.md
       * §8 landmine L1.
       */
      tutorOnly?: boolean;
      trustLevel: string;
      tags: string[];
      publisherOrg: string | null;
      accreditingBody: string | null;
      qualificationRef: string | null;
      validUntil: Date | null;
      isActive: boolean;
    }>;
    curriculum: {
      id: string;
      slug: string;
      name: string;
      description: string | null;
      notableInfo: any;
      deliveryConfig: any;
      trustLevel: string;
      qualificationBody: string | null;
      qualificationNumber: string | null;
      qualificationLevel: string | null;
    } | null;
  }>;
}

export interface SystemSpecData {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  specRole: string | null;
  outputType: string;
  config: any;
  domain: string | null;
  promptTemplate?: string | null;
  /** Base archetype ID (e.g., "TUT-001") — for overlay specs */
  extendsAgent?: string | null;
}

// === TRANSFORM FUNCTION SIGNATURE ===

export type TransformFn = (
  rawData: any,
  context: AssembledContext,
  sectionDef: CompositionSectionDef,
) => any | Promise<any>;

// === COMPOSITION RESULT ===

export interface CompositionResult {
  llmPrompt: Record<string, any>;
  callerContext: string;
  /** Section outputs keyed by outputKey — for downstream consumers (template rendering, etc.) */
  sections: Record<string, any>;
  /** Raw loaded data — for downstream consumers that need Prisma-shaped data */
  loadedData: LoadedDataContext;
  /** Resolved identity/content/voice specs */
  resolvedSpecs: ResolvedSpecs;
  metadata: {
    sectionsActivated: string[];
    sectionsSkipped: string[];
    /** Human-readable reason for each section's activation or skip decision */
    activationReasons: Record<string, string>;
    loadTimeMs: number;
    transformTimeMs: number;
    /** Merged behavior targets (for backward compat with template rendering) */
    mergedTargetCount: number;
  };
}

// === UTILITY ===

/** Extract value from a CallerAttribute regardless of type */
export function getAttributeValue(attr: CallerAttributeData): any {
  switch (attr.valueType) {
    case "STRING": return attr.stringValue;
    case "NUMBER": return attr.numberValue;
    case "BOOLEAN": return attr.booleanValue;
    case "JSON": return attr.jsonValue;
    default: return attr.stringValue || attr.numberValue || attr.booleanValue || attr.jsonValue;
  }
}

/** Classify a 0-1 value as HIGH/MODERATE/LOW using thresholds */
export function classifyValue(
  value: number | null,
  thresholds: { high: number; low: number },
): string | null {
  if (value === null) return null;
  if (value >= thresholds.high) return "HIGH";
  if (value <= thresholds.low) return "LOW";
  return "MODERATE";
}

/** Classify a 0-1 value as high/moderate/low (lowercase) */
export function scoreToLevel(
  value: number,
  thresholds: { high: number; low: number },
): string {
  if (value >= thresholds.high) return "high";
  if (value <= thresholds.low) return "low";
  return "moderate";
}
