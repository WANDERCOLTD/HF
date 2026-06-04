/**
 * Vitest Test Setup
 *
 * Sets up mocks and test utilities for ops testing
 */

import { vi } from 'vitest';

// Mock Prisma Client
vi.mock('@prisma/client', () => {
  const mockPrismaClient = {
    constructor: function() {},
    call: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    caller: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    analysisSpec: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    callerPersonality: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    callerPersonalityProfile: {
      upsert: vi.fn(),
    },
    personalityObservation: {
      create: vi.fn(),
    },
    parameter: {
      findMany: vi.fn(),
    },
    callerMemory: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    callerMemorySummary: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    callerIdentity: {
      findMany: vi.fn(),
    },
    callScore: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    compiledAnalysisSet: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    behaviorTarget: {
      count: vi.fn(),
    },
    processedFile: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
    },
    failedCall: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    knowledgeDoc: {
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    knowledgeChunk: {
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
    conversationArtifact: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    callAction: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    cohortGroup: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    inboundMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
    },
    contentAssertion: {
      findMany: vi.fn(),
    },
    institution: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    mediaAsset: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    subjectMedia: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
    },
    channelConfig: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    callerPlaybook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    cohortPlaybook: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    callMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
    playbook: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    aiModel: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    taskGuidance: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    domain: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    invite: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    contentQuestion: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    contentVocabulary: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    contentSource: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    curriculum: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    // Added 2026-06-04 — peer #1034 introduced runtime calls to
    // prisma.playbookCurriculum (the join table between Playbook and
    // Curriculum) from lib/curriculum/resolve-module.ts and
    // lib/curriculum/resolve-playbook-for-curriculum.ts. Without this
    // mock, every test that exercises module-slug resolution throws
    // "Cannot read properties of undefined (reading 'findFirst')".
    // Confirmed empirically — 3 test files (callers-calls-module-
    // resolver, import-modules-fallback, import-modules-recommendation,
    // import-modules-status-badges) failed in CI on the post-#1065
    // main run; same failure on a fresh checkout of main without any
    // AnyVoice code.
    playbookCurriculum: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    userTask: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $disconnect: vi.fn(),
    // $transaction assigned after proxiedClient is constructed so the
    // transaction's tx argument is the proxied (auto-stub) client too.
    $transaction: undefined as unknown as ReturnType<typeof vi.fn>,
  };

  // Self-healing Proxy fallback — return an auto-stub for any model
  // access that wasn't explicitly defined above. This stops the
  // recurring "Cannot read properties of undefined (reading 'findX')"
  // failures every time the runtime adds a new model query (peer's
  // #1034 hit 4 test files this way; #1031's VoiceProvider model
  // would have hit similar paths without the explicit mock added in
  // that PR's tests).
  //
  // The auto-stub exposes every method the Prisma client surface uses
  // (findMany / findUnique / findFirst / create / createMany /
  // update / updateMany / delete / deleteMany / upsert / count /
  // aggregate / groupBy). Each is a fresh vi.fn() per access — tests
  // that need specific behaviour for a model continue to either set
  // up the explicit mock above OR call `prisma.<model>.<fn>.mockResolvedValue(...)`
  // inside the test (the auto-stub is a real vi.fn()).
  //
  // Cached per-property so two reads of the same model return the
  // same stub (so test setup via `prisma.foo.findMany.mockResolvedValue(x)`
  // is visible at the call site).
  const autoStubCache = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
  const PRISMA_MODEL_METHODS = [
    "findMany", "findUnique", "findFirst", "findUniqueOrThrow", "findFirstOrThrow",
    "create", "createMany", "update", "updateMany", "delete", "deleteMany",
    "upsert", "count", "aggregate", "groupBy",
  ];
  const makeAutoStub = () => {
    const stub: Record<string, ReturnType<typeof vi.fn>> = {};
    for (const m of PRISMA_MODEL_METHODS) stub[m] = vi.fn();
    return stub;
  };
  const proxiedClient = new Proxy(mockPrismaClient, {
    get(target, prop: string | symbol) {
      if (prop in target) return (target as Record<string | symbol, unknown>)[prop];
      if (typeof prop !== "string") return undefined;
      // Skip vitest-internal probes + Symbol-shaped probes
      if (prop.startsWith("$") || prop.startsWith("_") || prop === "then") return undefined;
      if (!autoStubCache.has(prop)) autoStubCache.set(prop, makeAutoStub());
      return autoStubCache.get(prop);
    },
  });

  // Wire $transaction to pass the proxied client so callbacks see
  // the same auto-stub fallback for any unmocked models.
  mockPrismaClient.$transaction = vi.fn().mockImplementation((fn: any) => {
    if (typeof fn === 'function') return fn(proxiedClient);
    return Promise.all(fn);
  });

  // Create a mock class — instances are themselves Proxies over the
  // shared mockPrismaClient (so explicit + auto-stub mocks behave
  // identically across `new PrismaClient()` and the singleton import).
  const MockPrismaClient = function(this: any) {
    return proxiedClient;
  } as unknown as { new (): typeof proxiedClient };

  return {
    PrismaClient: MockPrismaClient,
    AnalysisOutputType: {
      MEASURE: 'MEASURE',
      LEARN: 'LEARN',
      CLASSIFY: 'CLASSIFY',
    },
    MemoryCategory: {
      FACT: 'FACT',
      PREFERENCE: 'PREFERENCE',
      EVENT: 'EVENT',
      TOPIC: 'TOPIC',
      RELATIONSHIP: 'RELATIONSHIP',
      CONTEXT: 'CONTEXT',
    },
    MemorySource: {
      EXTRACTED: 'EXTRACTED',
      INFERRED: 'INFERRED',
      EXPLICIT: 'EXPLICIT',
    },
    FileType: {
      SINGLE_CALL: 'SINGLE_CALL',
      BATCH_EXPORT: 'BATCH_EXPORT',
    },
    ProcessingStatus: {
      PENDING: 'PENDING',
      PROCESSING: 'PROCESSING',
      COMPLETED: 'COMPLETED',
      PARTIAL: 'PARTIAL',
      FAILED: 'FAILED',
    },
    FailedCallErrorType: {
      NO_TRANSCRIPT: 'NO_TRANSCRIPT',
      INVALID_FORMAT: 'INVALID_FORMAT',
      DUPLICATE: 'DUPLICATE',
      NO_CUSTOMER: 'NO_CUSTOMER',
      DB_ERROR: 'DB_ERROR',
      UNKNOWN: 'UNKNOWN',
    },
    ConversationArtifactType: {
      SUMMARY: 'SUMMARY',
      KEY_FACT: 'KEY_FACT',
      FORMULA: 'FORMULA',
      EXERCISE: 'EXERCISE',
      RESOURCE_LINK: 'RESOURCE_LINK',
      STUDY_NOTE: 'STUDY_NOTE',
      REMINDER: 'REMINDER',
      MEDIA: 'MEDIA',
    },
    ArtifactTrustLevel: {
      VERIFIED: 'VERIFIED',
      INFERRED: 'INFERRED',
      UNVERIFIED: 'UNVERIFIED',
    },
    ArtifactStatus: {
      PENDING: 'PENDING',
      SENT: 'SENT',
      DELIVERED: 'DELIVERED',
      READ: 'READ',
      FAILED: 'FAILED',
    },
    InboundMessageType: {
      TEXT: 'TEXT',
      IMAGE: 'IMAGE',
      AUDIO: 'AUDIO',
      DOCUMENT: 'DOCUMENT',
    },
    CallerPlaybookStatus: {
      ACTIVE: 'ACTIVE',
      COMPLETED: 'COMPLETED',
      PAUSED: 'PAUSED',
      DROPPED: 'DROPPED',
    },
    CallerRole: {
      LEARNER: 'LEARNER',
      TEACHER: 'TEACHER',
      TUTOR: 'TUTOR',
      PARENT: 'PARENT',
      MENTOR: 'MENTOR',
    },
    CallActionType: {
      SEND_MEDIA: 'SEND_MEDIA',
      HOMEWORK: 'HOMEWORK',
      TASK: 'TASK',
      FOLLOWUP: 'FOLLOWUP',
      REMINDER: 'REMINDER',
    },
    CallActionAssignee: {
      CALLER: 'CALLER',
      OPERATOR: 'OPERATOR',
      AGENT: 'AGENT',
    },
    CallActionStatus: {
      PENDING: 'PENDING',
      IN_PROGRESS: 'IN_PROGRESS',
      COMPLETED: 'COMPLETED',
      CANCELLED: 'CANCELLED',
    },
    CallActionPriority: {
      LOW: 'LOW',
      MEDIUM: 'MEDIUM',
      HIGH: 'HIGH',
      URGENT: 'URGENT',
    },
    CallActionSource: {
      EXTRACTED: 'EXTRACTED',
      MANUAL: 'MANUAL',
    },
    ContentTrustLevel: {
      UNVERIFIED: 'UNVERIFIED',
      AI_ASSISTED: 'AI_ASSISTED',
      EXPERT_CURATED: 'EXPERT_CURATED',
      PUBLISHED_REFERENCE: 'PUBLISHED_REFERENCE',
      ACCREDITED_MATERIAL: 'ACCREDITED_MATERIAL',
      REGULATORY_STANDARD: 'REGULATORY_STANDARD',
    },
  };
});

// Mock fs for transcript tests
vi.mock('node:fs/promises', () => ({
  default: {
    readFile: vi.fn(),
    readdir: vi.fn(),
    stat: vi.fn(),
    access: vi.fn(),
  },
}));

// Setup for React Testing Library
import '@testing-library/jest-dom';

// Mock next/navigation for page tests
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
  usePathname: () => '/',
}));

// Mock auth (next-auth integration) — prevents ESM resolution issues
vi.mock('@/lib/auth', () => ({
  auth: vi.fn().mockResolvedValue({
    user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'ADMIN', image: null },
    expires: new Date(Date.now() + 86400000).toISOString(),
  }),
  handlers: { GET: vi.fn(), POST: vi.fn() },
}));

// Mock permissions — default to allowing all calls
vi.mock('@/lib/permissions', () => ({
  requireAuth: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'ADMIN', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
  }),
  isAuthError: vi.fn().mockReturnValue(false),
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'ADMIN', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
  }),
}));

// Mock student-access — provides student + admin combined auth helpers
vi.mock('@/lib/student-access', () => ({
  requireStudent: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'STUDENT', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    callerId: 'test-caller-id',
    cohortGroupId: 'test-cohort-id',
    cohortGroupIds: ['test-cohort-id'],
    institutionId: null,
  }),
  requireStudentOrAdmin: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'STUDENT', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    callerId: 'test-caller-id',
    cohortGroupId: 'test-cohort-id',
    cohortGroupIds: ['test-cohort-id'],
    institutionId: null,
  }),
  isStudentAuthError: vi.fn().mockReturnValue(false),
}));

// Mock educator-access — provides educator + admin combined auth helpers
vi.mock('@/lib/educator-access', () => ({
  requireEducator: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'EDUCATOR', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    callerId: 'test-educator-caller-id',
    institutionId: null,
  }),
  requireEducatorOrAdmin: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'EDUCATOR', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    callerId: 'test-educator-caller-id',
    institutionId: null,
  }),
  isEducatorAuthError: vi.fn().mockReturnValue(false),
  requireEducatorCohortOwnership: vi.fn().mockResolvedValue({
    cohort: { id: 'test-cohort-id', name: 'Test Cohort', ownerId: 'test-educator-caller-id', _count: { members: 0 } },
  }),
  requireEducatorStudentAccess: vi.fn().mockResolvedValue({
    student: { id: 'test-student-id', name: 'Test Student' },
  }),
}));

// Mock access-control — prevents ESM resolution via auth → next-auth → next/server
vi.mock('@/lib/access-control', () => ({
  requireEntityAccess: vi.fn().mockResolvedValue({
    session: {
      user: { id: 'test-user', email: 'test@example.com', name: 'Test User', role: 'ADMIN', image: null },
      expires: new Date(Date.now() + 86400000).toISOString(),
    },
    scope: 'ALL',
  }),
  isEntityAuthError: vi.fn().mockReturnValue(false),
}));

// Mock system-settings — provide all exported constants and async getters
vi.mock('@/lib/system-settings', () => ({
  clearSystemSettingsCache: vi.fn(),
  getSystemSetting: vi.fn().mockImplementation(async (_key: string, defaultValue?: any) => defaultValue ?? null),
  PIPELINE_DEFAULTS: { minTranscriptWords: 20, shortTranscriptThresholdWords: 50, shortTranscriptConfidenceCap: 0.3, maxRetries: 2, mockMode: false, personalityDecayHalfLifeDays: 30, mockScoreBase: 0.3, mockScoreRange: 0.4 },
  getPipelineSettings: vi.fn().mockResolvedValue({ minTranscriptWords: 20, shortTranscriptThresholdWords: 50, shortTranscriptConfidenceCap: 0.3, maxRetries: 2, mockMode: false, personalityDecayHalfLifeDays: 30, mockScoreBase: 0.3, mockScoreRange: 0.4 }),
  getPipelineGates: vi.fn().mockResolvedValue({ minTranscriptWords: 20, shortTranscriptThresholdWords: 50, shortTranscriptConfidenceCap: 0.3 }),
  MEMORY_DEFAULTS: { confidenceDefault: 0.5, confidenceHigh: 0.8, confidenceLow: 0.3, summaryRecentLimit: 10, summaryTopLimit: 5, transcriptLimitChars: 8000 },
  getMemorySettings: vi.fn().mockResolvedValue({ confidenceDefault: 0.5, confidenceHigh: 0.8, confidenceLow: 0.3, summaryRecentLimit: 10, summaryTopLimit: 5, transcriptLimitChars: 8000 }),
  GOAL_DEFAULTS: { confidenceThreshold: 0.5, similarityThreshold: 0.8, transcriptMinChars: 100, transcriptLimitChars: 4000 },
  getGoalSettings: vi.fn().mockResolvedValue({ confidenceThreshold: 0.5, similarityThreshold: 0.8, transcriptMinChars: 100, transcriptLimitChars: 4000 }),
  ARTIFACT_DEFAULTS: { confidenceThreshold: 0.6, similarityThreshold: 0.8, transcriptMinChars: 100, transcriptLimitChars: 4000 },
  getArtifactSettings: vi.fn().mockResolvedValue({ confidenceThreshold: 0.6, similarityThreshold: 0.8, transcriptMinChars: 100, transcriptLimitChars: 4000 }),
  TRUST_DEFAULTS: { weightL5Regulatory: 1.0, weightL4Accredited: 0.95, weightL3Published: 0.80, weightL2Expert: 0.60, weightL1AiAssisted: 0.30, weightL0Unverified: 0.05, certificationMinWeight: 0.80, extractionMaxChunkChars: 8000 },
  getTrustSettings: vi.fn().mockResolvedValue({ weightL5Regulatory: 1.0, weightL4Accredited: 0.95, weightL3Published: 0.80, weightL2Expert: 0.60, weightL1AiAssisted: 0.30, weightL0Unverified: 0.05, certificationMinWeight: 0.80, extractionMaxChunkChars: 8000 }),
  AI_LEARNING_DEFAULTS: { initialConfidence: 0.3, confidenceIncrement: 0.05, minOccurrences: 3 },
  getAILearningSettings: vi.fn().mockResolvedValue({ initialConfidence: 0.3, confidenceIncrement: 0.05, minOccurrences: 3 }),
  CACHE_DEFAULTS: { systemSettingsTtlMs: 30000, aiConfigTtlMs: 60000, costConfigTtlMs: 300000, dataPathsTtlMs: 5000 },
  getCacheSettings: vi.fn().mockResolvedValue({ systemSettingsTtlMs: 30000, aiConfigTtlMs: 60000, costConfigTtlMs: 300000, dataPathsTtlMs: 5000 }),
  DEMO_CAPTURE_DEFAULTS: { defaultCaller: 'Paul', defaultDomain: 'qm-tutor', defaultPlaybook: '', defaultSpec: '' },
  getDemoCaptureSettings: vi.fn().mockResolvedValue({ defaultCaller: 'Paul', defaultDomain: 'qm-tutor', defaultPlaybook: '', defaultSpec: '' }),
  KNOWLEDGE_RETRIEVAL_DEFAULTS: { queryMessageCount: 3, topResults: 10, chunkLimit: 5, assertionLimit: 5, memoryLimit: 3, minRelevance: 0.3 },
  getKnowledgeRetrievalSettings: vi.fn().mockResolvedValue({ queryMessageCount: 3, topResults: 10, chunkLimit: 5, assertionLimit: 5, memoryLimit: 3, minRelevance: 0.3 }),
  VOICE_CALL_DEFAULTS: { provider: 'openai', model: 'gpt-4o', knowledgePlanEnabled: true, autoPipeline: true, toolLookupTeachingPoint: true, toolCheckMastery: true, toolRecordObservation: true, toolGetPracticeQuestion: true, toolGetNextModule: true, toolLogActivityResult: true, toolSendText: true, toolRequestArtifact: true, unknownCallerPrompt: 'You are a helpful voice assistant. This caller is not yet registered in the system. Have a friendly conversation and gather their name.', noActivePromptFallback: 'You are a helpful voice tutor. No personalized prompt is available yet — have a warm, friendly conversation.' },
  getVoiceCallSettings: vi.fn().mockResolvedValue({ provider: 'openai', model: 'gpt-4o', knowledgePlanEnabled: true, autoPipeline: true, toolLookupTeachingPoint: true, toolCheckMastery: true, toolRecordObservation: true, toolGetPracticeQuestion: true, toolGetNextModule: true, toolLogActivityResult: true, toolSendText: true, toolRequestArtifact: true, unknownCallerPrompt: 'You are a helpful voice assistant. This caller is not yet registered in the system. Have a friendly conversation and gather their name.', noActivePromptFallback: 'You are a helpful voice tutor. No personalized prompt is available yet — have a warm, friendly conversation.' }),
  ACTIONS_DEFAULTS: { transcriptLimit: 4000, minTranscriptLength: 100, confidenceThreshold: 0.6, similarityThreshold: 0.8 },
  getActionSettings: vi.fn().mockResolvedValue({ transcriptLimit: 4000, minTranscriptLength: 100, confidenceThreshold: 0.6, similarityThreshold: 0.8 }),
  SETTINGS_REGISTRY: [],
  EMAIL_TEMPLATE_DEFAULTS: {
    magicLinkSubject: 'Sign in', magicLinkHeading: 'Sign in', magicLinkBody: 'Click below',
    magicLinkButtonText: 'Sign In', magicLinkFooter: 'Expires soon',
    inviteSubject: 'Invitation', inviteHeading: 'Welcome', inviteBody: 'You are invited',
    inviteButtonText: 'Accept', inviteFooter: 'Expires in 7 days',
    sharedFromName: 'HF Admin', sharedBrandColorStart: '#3b82f6', sharedBrandColorEnd: '#9333ea',
  },
}));

// Mock global fetch
global.fetch = vi.fn();
