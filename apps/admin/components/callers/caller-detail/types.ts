// Shared types for CallerDetailPage and its sub-components

export type Domain = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  isDefault: boolean;
};

export type CallerRole = "LEARNER" | "TEACHER" | "TUTOR" | "PARENT" | "MENTOR";

export type CallerProfile = {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  externalId: string | null;
  role: CallerRole;
  createdAt: string;
  archivedAt: string | null;
  domainId: string | null;
  domain: Domain | null;
};

export type PersonalityProfile = {
  parameterValues: Record<string, number>; // Dynamic parameter values (Big Five, VARK, etc.)
  lastUpdatedAt: string | null;
};

export type PersonalityObservation = {
  id: string;
  callId: string;
  openness: number | null;
  conscientiousness: number | null;
  extraversion: number | null;
  agreeableness: number | null;
  neuroticism: number | null;
  confidence: number | null;
  observedAt: string;
};

export type Memory = {
  id: string;
  category: string;
  key: string;
  value: string;
  normalizedKey: string | null;
  evidence: string | null;
  confidence: number;
  decayFactor: number | null;
  extractedAt: string;
  expiresAt: string | null;
};

export type MemorySummary = {
  factCount: number;
  preferenceCount: number;
  eventCount: number;
  topicCount: number;
  keyFacts: { key: string; value: string; confidence: number }[];
  preferences: Record<string, string>;
  topTopics: { topic: string; lastMentioned?: string }[];
};

export type Call = {
  id: string;
  source: string;
  externalId: string | null;
  transcript: string;
  createdAt: string;
  callSequence?: number | null;
  // Analysis status (persistent - from database)
  hasScores?: boolean;
  hasMemories?: boolean;
  hasBehaviorMeasurements?: boolean;
  hasRewardScore?: boolean;
  hasPrompt?: boolean;
  // Module context
  curriculumModuleId?: string | null;
  curriculumModule?: { slug: string; title: string } | null;
};

export type CallerIdentity = {
  id: string;
  name: string | null;
  externalId: string | null;
  nextPrompt: string | null;
  nextPromptComposedAt: string | null;
  nextPromptInputs: Record<string, any> | null;
  segmentId: string | null;
  segment: { name: string } | null;
};

export type CallScore = {
  id: string;
  callId: string;
  parameterId: string;
  score: number;
  confidence: number;
  evidence: string[] | null;
  reasoning: string | null;
  scoredBy: string | null;
  scoredAt: string;
  analysisSpecId: string | null;
  createdAt: string;
  parameter: { name: string; definition: string | null };
  analysisSpec: { id: string; slug: string; name: string; outputType: string } | null;
  call: { createdAt: string };
};

/** Progress-oriented view of a module — will be replaced by CallerModuleProgress from DB */
export type CallerModuleProgressView = {
  id: string;
  name: string;
  description: string;
  status: 'not_started' | 'in_progress' | 'completed';
  mastery: number;
  sequence: number;
};

export type CurriculumProgress = {
  name: string | null;
  hasData: boolean;
  modules: CallerModuleProgressView[];
  nextModule: string | null;
  totalModules: number;
  completedCount: number;
  estimatedProgress: number;
};

export type LearnerProfile = {
  learningStyle: string | null;
  pacePreference: string | null;
  interactionStyle: string | null;
  priorKnowledge: Record<string, string>;
  preferredModality: string | null;
  questionFrequency: string | null;
  sessionLength: string | null;
  feedbackStyle: string | null;
  lastUpdated: string | null;
};

export type Goal = {
  id: string;
  type: string;
  name: string;
  description: string | null;
  status: string;
  priority: number;
  progress: number;
  startedAt: string | null;
  completedAt: string | null;
  targetDate: string | null;
  isAssessmentTarget: boolean;
  assessmentConfig: { threshold?: number; [key: string]: any } | null;
  pendingSignal?: { id: string; evidence: string | null; createdAt: string } | null;
  playbook: {
    id: string;
    name: string;
    version: string;
  } | null;
  contentSpec: {
    id: string;
    slug: string;
    name: string;
  } | null;
};

export type CallerData = {
  caller: CallerProfile;
  personality: PersonalityProfile | null;
  observations: PersonalityObservation[];
  memories: Memory[];
  memorySummary: MemorySummary | null;
  calls: Call[];
  identities: CallerIdentity[];
  scores: CallScore[];
  callerTargets?: any[];
  curriculum?: CurriculumProgress | null;
  learnerProfile?: LearnerProfile | null;
  goals?: Goal[];
  publishedPlaybookId?: string | null;
  counts: {
    calls: number;
    memories: number;
    observations: number;
    prompts: number;
    targets: number;
    measurements: number;
    artifacts?: number;
    actions?: number;
    curriculumModules?: number;
    curriculumCompleted?: number;
    goals?: number;
    activeGoals?: number;
    keyFacts?: number;
  };
};

export type SectionId = "overview" | "calls-prompts" | "how" | "what" | "artifacts" | "ai-call";

export type ComposedPrompt = {
  id: string;
  prompt: string;
  llmPrompt: Record<string, any> | null;  // LLM-friendly structured JSON version
  triggerType: string;
  triggerCallId: string | null;
  model: string | null;
  status: string;
  composedAt: string;
  inputs: Record<string, any> | null;
  evalResult: Record<string, any> | null;  // Persisted AI quality evaluation
  evalAt: string | null;
  triggerCall?: { id: string; createdAt: string; source: string } | null;
};

// ---------------------------------------------------------------------------
// Pipeline types (shared between CallsPromptsTab and pipeline UI)
// ---------------------------------------------------------------------------

export type PipelineMode = "prep" | "prompt";
export type PipelineStatus = "ready" | "running" | "success" | "warning" | "error";

export type LogEntry = {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  message: string;
  data?: any;
};

export type OpResult = {
  ok: boolean;
  opId: string;
  logs: LogEntry[];
  duration: number;
  error?: string;
  data?: {
    scoresCreated?: number;
    memoriesCreated?: number;
    agentMeasurements?: number;
    playbookUsed?: string | null;
    stageErrors?: string[];
    composeFailed?: boolean;
    composeError?: string;
  };
};

/** Lazy-loaded call detail from GET /api/calls/:callId */
export type CallDetail = {
  ok: boolean;
  call: any;
  scores: any[];
  memories: any[];
  measurements: any[];
  rewardScore: { id: string; overallScore: number; parameterDiffs: any[]; modelVersion: string; scoredAt: string } | null;
  triggeredPrompts: any[];
  personalityObservation: any | null;
  effectiveTargets: any[];
  callerTargets?: any[];
  counts: Record<string, number>;
};

export type ParamDisplayInfo = {
  parameterId: string;
  label: string;
  description: string;
  color: string;
  section: string;
  interpretationHigh?: string;
  interpretationLow?: string;
};

export type ParamConfig = {
  grouped: Record<string, ParamDisplayInfo[]>;
  params: Record<string, ParamDisplayInfo>;
} | null;
