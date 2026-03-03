/**
 * Section Data Loader
 *
 * Registry of named data loader functions that fetch from Prisma.
 * Each loader mirrors exactly one query from the original compose-prompt route.
 * Spec sections reference loaders by name: "dataSource": "memories"
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { getLearnerProfile } from "@/lib/learner/profile";
import { resolvePlaybookId } from "@/lib/enrollment/resolve-playbook";
import { getSubjectsForPlaybook } from "@/lib/knowledge/domain-sources";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import type { LoadedDataContext } from "./types";

/** Pre-resolved content scope passed to content loaders via config. */
type ContentScope = {
  domainId: string;
  subjectIds: string[];
  subjects: Array<{
    id: string;
    teachingDepth: number | null;
    sources: Array<{ sourceId: string; documentType: string | null }>;
  }>;
  scoped: boolean;
} | null;

type LoaderFn = (callerId: string, config?: any) => Promise<any>;

const loaderRegistry = new Map<string, LoaderFn>();

function registerLoader(name: string, fn: LoaderFn) {
  loaderRegistry.set(name, fn);
}

export function getLoader(name: string): LoaderFn | undefined {
  return loaderRegistry.get(name);
}

/**
 * Load all data sources in parallel.
 * Mirrors the Promise.all() block from route.ts lines 109-355.
 */
export async function loadAllData(
  callerId: string,
  specConfig: Record<string, any>,
): Promise<LoadedDataContext> {
  const memoriesLimit = specConfig.memoriesLimit || 50;
  const recentCallsLimit = specConfig.recentCallsLimit || 5;

  // Pre-resolve content scope ONCE for all content loaders
  const contentScope = await resolveContentScope(callerId);

  const [
    caller,
    memories,
    personality,
    learnerProfile,
    recentCalls,
    callCount,
    behaviorTargets,
    callerTargets,
    callerAttributes,
    goals,
    playbooks,
    systemSpecs,
    onboardingSpec,
    onboardingSession,
    subjectSources,
    curriculumAssertions,
    curriculumQuestions,
    curriculumVocabulary,
    courseInstructions,
    openActions,
    visualAids,
  ] = await Promise.all([
    loaderRegistry.get("caller")!(callerId),
    loaderRegistry.get("memories")!(callerId, { limit: memoriesLimit }),
    loaderRegistry.get("personality")!(callerId),
    loaderRegistry.get("learnerProfile")!(callerId),
    loaderRegistry.get("recentCalls")!(callerId, { limit: recentCallsLimit }),
    loaderRegistry.get("callCount")!(callerId),
    loaderRegistry.get("behaviorTargets")!(callerId),
    loaderRegistry.get("callerTargets")!(callerId),
    loaderRegistry.get("callerAttributes")!(callerId),
    loaderRegistry.get("goals")!(callerId),
    loaderRegistry.get("playbooks")!(callerId, { playbookIds: specConfig.playbookIds }),
    loaderRegistry.get("systemSpecs")!(callerId),
    loaderRegistry.get("onboardingSpec")!(callerId),
    loaderRegistry.get("onboardingSession")!(callerId),
    loaderRegistry.get("subjectSources")!(callerId, { contentScope }),
    loaderRegistry.get("curriculumAssertions")!(callerId, { contentScope }),
    loaderRegistry.get("curriculumQuestions")!(callerId, { contentScope }),
    loaderRegistry.get("curriculumVocabulary")!(callerId, { contentScope }),
    loaderRegistry.get("courseInstructions")!(callerId, { contentScope }),
    loaderRegistry.get("openActions")!(callerId),
    loaderRegistry.get("visualAids")!(callerId, { contentScope }),
  ]);

  return {
    caller,
    memories: memories || [],
    personality,
    learnerProfile,
    recentCalls: recentCalls || [],
    callCount: callCount || 0,
    behaviorTargets: behaviorTargets || [],
    callerTargets: callerTargets || [],
    callerAttributes: callerAttributes || [],
    goals: goals || [],
    playbooks: playbooks || [],
    systemSpecs: systemSpecs || [],
    onboardingSpec: onboardingSpec || null,
    onboardingSession: onboardingSession || null,
    subjectSources: subjectSources || null,
    curriculumAssertions: curriculumAssertions || [],
    curriculumQuestions: curriculumQuestions || [],
    curriculumVocabulary: curriculumVocabulary || [],
    courseInstructions: courseInstructions || [],
    openActions: openActions || [],
    visualAids: visualAids || [],
  };
}

// =============================================================
// Content scope resolution — resolves once, passed to 5 loaders
// =============================================================

async function resolveContentScope(callerId: string): Promise<ContentScope> {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });
  if (!caller?.domainId) return null;

  const playbookId = await resolvePlaybookId(callerId);
  if (playbookId) {
    const result = await getSubjectsForPlaybook(playbookId, caller.domainId);
    return {
      domainId: caller.domainId,
      subjectIds: result.subjects.map((s) => s.id),
      subjects: result.subjects,
      scoped: result.scoped,
    };
  }

  // No single playbook — fall back to domain-wide
  const subjectDomains = await prisma.subjectDomain.findMany({
    where: { domainId: caller.domainId },
    select: {
      subject: {
        select: {
          id: true,
          teachingDepth: true,
          sources: {
            select: {
              sourceId: true,
              source: { select: { documentType: true } },
            },
          },
        },
      },
    },
  });

  return {
    domainId: caller.domainId,
    subjectIds: subjectDomains.map((sd) => sd.subject.id),
    subjects: subjectDomains.map((sd) => ({
      ...sd.subject,
      sources: sd.subject.sources.map((s) => ({
        sourceId: s.sourceId,
        documentType: s.source?.documentType ?? null,
      })),
    })),
    scoped: false,
  };
}

// =============================================================
// INDIVIDUAL LOADERS (extracted from route.ts lines 109-355)
// =============================================================

registerLoader("caller", async (callerId) => {
  return prisma.caller.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      name: true,
      email: true,
      phone: true,
      externalId: true,
      domainId: true,
      previousDomainId: true,
      domainSwitchCount: true,
      domain: {
        select: {
          id: true,
          name: true,
          description: true,
          slug: true,
          // Onboarding configuration (from merged Persona concept)
          onboardingWelcome: true,
          onboardingIdentitySpecId: true,
          onboardingFlowPhases: true,
          onboardingDefaultTargets: true,
          onboardingIdentitySpec: {
            select: {
              id: true,
              slug: true,
              name: true,
            },
          },
        },
      },
      cohortGroup: {
        select: {
          id: true,
          name: true,
          owner: { select: { id: true, name: true } },
        },
      },
      cohortMemberships: {
        select: {
          cohortGroup: {
            select: {
              id: true,
              name: true,
              owner: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
  });
});

registerLoader("memories", async (callerId, config) => {
  return prisma.callerMemory.findMany({
    where: {
      callerId,
      supersededById: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    orderBy: [{ category: "asc" }, { confidence: "desc" }],
    take: config?.limit || 50,
    select: {
      category: true,
      key: true,
      value: true,
      confidence: true,
      evidence: true,
      extractedAt: true,
      decayFactor: true,
    },
  });
});

registerLoader("personality", async (callerId) => {
  // Load from CallerPersonalityProfile for dynamic parameter values (Big Five, VARK, etc.)
  const profile = await prisma.callerPersonalityProfile.findUnique({
    where: { callerId },
    select: {
      parameterValues: true,
      lastUpdatedAt: true,
    },
  });

  // Also load legacy CallerPersonality for backward compatibility fields
  const legacy = await prisma.callerPersonality.findUnique({
    where: { callerId },
    select: {
      preferredTone: true,
      preferredLength: true,
      technicalLevel: true,
      confidenceScore: true,
    },
  });

  // Merge profile parameter values with legacy fields
  return {
    ...(profile?.parameterValues as Record<string, number> || {}),
    preferredTone: legacy?.preferredTone,
    preferredLength: legacy?.preferredLength,
    technicalLevel: legacy?.technicalLevel,
    confidenceScore: legacy?.confidenceScore,
    lastUpdatedAt: profile?.lastUpdatedAt,
  };
});

registerLoader("learnerProfile", async (callerId) => {
  try {
    return await getLearnerProfile(callerId);
  } catch (error) {
    console.error("[compose-prompt] Failed to load learner profile:", error);
    return null;
  }
});

registerLoader("recentCalls", async (callerId, config) => {
  return prisma.call.findMany({
    where: { callerId },
    orderBy: { createdAt: "desc" },
    take: config?.limit || 5,
    select: {
      id: true,
      transcript: true,
      createdAt: true,
      scores: {
        select: {
          parameterId: true,
          score: true,
          parameter: { select: { name: true } },
        },
      },
    },
  });
});

registerLoader("callCount", async (callerId) => {
  return prisma.call.count({
    where: { callerId },
  });
});

registerLoader("behaviorTargets", async (_callerId) => {
  return prisma.behaviorTarget.findMany({
    where: {
      effectiveUntil: null,
    },
    include: {
      parameter: {
        select: {
          name: true,
          interpretationLow: true,
          interpretationHigh: true,
          domainGroup: true,
        },
      },
    },
  });
});

registerLoader("callerTargets", async (callerId) => {
  return prisma.callerTarget.findMany({
    where: { callerId },
    include: {
      parameter: {
        select: {
          name: true,
          interpretationLow: true,
          interpretationHigh: true,
          domainGroup: true,
        },
      },
    },
  });
});

registerLoader("callerAttributes", async (callerId) => {
  return prisma.callerAttribute.findMany({
    where: {
      callerId,
      OR: [
        { validUntil: null },
        { validUntil: { gt: new Date() } },
      ],
    },
    orderBy: [{ scope: "asc" }, { key: "asc" }],
    select: {
      key: true,
      scope: true,
      domain: true,
      valueType: true,
      stringValue: true,
      numberValue: true,
      booleanValue: true,
      jsonValue: true,
      confidence: true,
      sourceSpecSlug: true,
    },
  });
});

registerLoader("goals", async (callerId) => {
  return prisma.goal.findMany({
    where: {
      callerId,
      status: { in: ["ACTIVE", "PAUSED"] },
    },
    include: {
      contentSpec: {
        select: { id: true, name: true, slug: true },
      },
      playbook: {
        select: { id: true, name: true },
      },
    },
    orderBy: [
      { priority: "desc" },
      { progress: "asc" },
      { startedAt: "desc" },
    ],
    take: 10,
  });
});

registerLoader("playbooks", async (callerId, loaderConfig?: { playbookIds?: string[] }) => {
  const specSelect = {
    id: true,
    slug: true,
    name: true,
    description: true,
    specRole: true,
    outputType: true,
    config: true,
    promptTemplate: true,
    domain: true,
    extendsAgent: true,
  };

  const itemInclude = {
    where: { isEnabled: true, itemType: "SPEC" as const },
    orderBy: { sortOrder: "asc" as const },
    include: { spec: { select: specSelect } },
  };

  // 1. Check CallerPlaybook enrollments (ACTIVE)
  const enrollments = await prisma.callerPlaybook.findMany({
    where: { callerId, status: "ACTIVE" },
    select: { playbookId: true },
  });

  if (enrollments.length > 0) {
    let playbookIds = enrollments.map((e) => e.playbookId);

    // If caller explicitly requests specific playbooks, intersect with enrollments
    if (loaderConfig?.playbookIds && loaderConfig.playbookIds.length > 0) {
      const requested = new Set(loaderConfig.playbookIds);
      playbookIds = playbookIds.filter((id) => requested.has(id));
    }

    if (playbookIds.length > 0) {
      const playbooks = await prisma.playbook.findMany({
        where: { id: { in: playbookIds }, status: "PUBLISHED" },
        orderBy: { sortOrder: "asc" },
        include: {
          domain: true,
          items: itemInclude,
          group: { select: { id: true, name: true, identityOverride: true } },
        },
      });

      if (playbooks.length > 0) return playbooks;
    }
  }

  // 2. Domain-based fallback (no enrollments or no published enrolled playbooks)
  const callerWithDomain = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });

  if (!callerWithDomain?.domainId) return [];

  const whereClause: Record<string, unknown> = {
    domainId: callerWithDomain.domainId,
    status: "PUBLISHED",
  };

  if (loaderConfig?.playbookIds && loaderConfig.playbookIds.length > 0) {
    whereClause.id = { in: loaderConfig.playbookIds };
  }

  return prisma.playbook.findMany({
    where: whereClause,
    orderBy: { sortOrder: "asc" },
    include: {
      domain: true,
      items: itemInclude,
      group: { select: { id: true, name: true, identityOverride: true } },
    },
  });
});

registerLoader("systemSpecs", async (_callerId) => {
  return prisma.analysisSpec.findMany({
    where: {
      scope: "SYSTEM",
      isActive: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      description: true,
      specRole: true,
      outputType: true,
      config: true,
      domain: true,
      extendsAgent: true,
    },
  });
});

/**
 * Load the onboarding/bootstrap spec for first-call defaults.
 * Uses env-configurable spec slug (default: INIT-001, configurable via ONBOARDING_SPEC_SLUG).
 * Returns the spec config with default targets and first-call flow.
 * NOTE: This is now a FALLBACK - Domain.onboarding* fields take precedence.
 */
registerLoader("onboardingSpec", async (_callerId) => {
  // Get onboarding spec slug from config (env-configurable)
  const onboardingSlug = config.specs.onboarding;

  const spec = await prisma.analysisSpec.findFirst({
    where: {
      OR: [
        { slug: { contains: onboardingSlug.toLowerCase(), mode: "insensitive" } },
        { slug: { contains: "onboarding" } },
        { domain: "onboarding" },
      ],
      isActive: true,
    },
    select: {
      id: true,
      slug: true,
      name: true,
      config: true,
    },
  });
  return spec;
});

/**
 * Load the caller's OnboardingSession for their current domain.
 * Used to determine if this is their first call in the domain.
 */
registerLoader("onboardingSession", async (callerId) => {
  const caller = await prisma.caller.findUnique({
    where: { id: callerId },
    select: { domainId: true },
  });

  if (!caller?.domainId) {
    return null;
  }

  return prisma.onboardingSession.findUnique({
    where: {
      callerId_domainId: {
        callerId,
        domainId: caller.domainId,
      },
    },
    select: {
      id: true,
      currentPhase: true,
      completedPhases: true,
      isComplete: true,
      wasSkipped: true,
      discoveredGoals: true,
      createdAt: true,
      completedAt: true,
    },
  });
});

/**
 * Load subject-based sources for the caller's course (playbook-scoped, domain fallback).
 * Returns all subjects linked to the course, with their sources and curricula.
 */
registerLoader("subjectSources", async (callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope || scope.subjectIds.length === 0) return null;

  // Fetch full subject data with sources and curricula
  const subjects = await prisma.subject.findMany({
    where: { id: { in: scope.subjectIds } },
    include: {
      sources: {
        include: {
          source: {
            select: {
              id: true,
              slug: true,
              name: true,
              trustLevel: true,
              publisherOrg: true,
              accreditingBody: true,
              qualificationRef: true,
              validUntil: true,
              isActive: true,
            },
          },
        },
        orderBy: { sortOrder: "asc" },
      },
      curricula: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        select: {
          id: true,
          slug: true,
          name: true,
          description: true,
          notableInfo: true,
          deliveryConfig: true,
          trustLevel: true,
          qualificationBody: true,
          qualificationNumber: true,
          qualificationLevel: true,
        },
      },
    },
  });

  if (subjects.length === 0) return null;

  return {
    subjects: subjects.map((subject) => ({
      id: subject.id,
      slug: subject.slug,
      name: subject.name,
      defaultTrustLevel: subject.defaultTrustLevel,
      qualificationRef: subject.qualificationRef,
      sources: subject.sources.map((ss) => ({
        slug: ss.source.slug,
        name: ss.source.name,
        trustLevel: ss.trustLevelOverride || ss.source.trustLevel,
        tags: ss.tags || ["content"],
        publisherOrg: ss.source.publisherOrg,
        accreditingBody: ss.source.accreditingBody,
        qualificationRef: ss.source.qualificationRef,
        validUntil: ss.source.validUntil,
        isActive: ss.source.isActive,
      })),
      curriculum: subject.curricula[0] || null,
    })),
  };
});

/**
 * Load curriculum assertions (approved teaching points) for the caller's course.
 * Fetches from ContentAssertion table, filtered by course-scoped content sources.
 * Returns assertions grouped-ready with source metadata for the teaching-content transform.
 */
registerLoader("curriculumAssertions", async (_callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope) return [];

  const sourceIds = scope.subjects.flatMap((s) =>
    s.sources
      .filter((ss) => ss.documentType !== "COURSE_REFERENCE")
      .map((ss) => ss.sourceId)
  );
  if (sourceIds.length === 0) return [];

  // Extract teachingDepth from first subject that has one
  const teachingDepth = scope.subjects
    .map((s) => s.teachingDepth)
    .find((d) => d !== null) ?? null;

  // Fetch assertions from these sources
  // Order by depth (tree traversal) then orderIndex, with exam relevance as tiebreaker
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: [...new Set(sourceIds)] },
      category: { notIn: [...INSTRUCTION_CATEGORIES] },
    },
    orderBy: [
      { depth: "asc" },
      { orderIndex: "asc" },
      { examRelevance: "desc" },
    ],
    take: 300,
    select: {
      id: true,
      assertion: true,
      category: true,
      chapter: true,
      section: true,
      pageRef: true,
      tags: true,
      trustLevel: true,
      examRelevance: true,
      learningOutcomeRef: true,
      depth: true,
      parentId: true,
      orderIndex: true,
      topicSlug: true,
      teachMethod: true,
      source: {
        select: {
          name: true,
          trustLevel: true,
        },
      },
    },
  });

  const result = assertions.map((a) => ({
    id: a.id,
    assertion: a.assertion,
    category: a.category,
    chapter: a.chapter,
    section: a.section,
    pageRef: a.pageRef,
    tags: a.tags,
    trustLevel: a.trustLevel,
    examRelevance: a.examRelevance,
    learningOutcomeRef: a.learningOutcomeRef,
    sourceName: a.source.name,
    sourceTrustLevel: a.source.trustLevel,
    depth: a.depth,
    parentId: a.parentId,
    orderIndex: a.orderIndex,
    topicSlug: a.topicSlug,
    teachMethod: a.teachMethod ?? null,
  }));

  // Attach teachingDepth as metadata on the loader context
  (result as any).__teachingDepth = teachingDepth;

  return result;
});

/**
 * Curriculum questions — extracted Q&A pairs from content sources
 * linked to the caller's course. Available for practice and assessment.
 */
registerLoader("curriculumQuestions", async (_callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope) return [];

  const sourceIds = scope.subjects.flatMap((s) =>
    s.sources
      .filter((ss) => ss.documentType !== "COURSE_REFERENCE")
      .map((ss) => ss.sourceId)
  );
  if (sourceIds.length === 0) return [];

  return prisma.contentQuestion.findMany({
    where: { sourceId: { in: [...new Set(sourceIds)] } },
    orderBy: [{ sortOrder: "asc" }],
    take: 100,
    select: {
      id: true,
      questionText: true,
      questionType: true,
      options: true,
      correctAnswer: true,
      chapter: true,
      learningOutcomeRef: true,
      difficulty: true,
    },
  });
});

/**
 * Curriculum vocabulary — extracted term/definition pairs from content sources
 * linked to the caller's course.
 */
registerLoader("curriculumVocabulary", async (_callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope) return [];

  const sourceIds = scope.subjects.flatMap((s) =>
    s.sources
      .filter((ss) => ss.documentType !== "COURSE_REFERENCE")
      .map((ss) => ss.sourceId)
  );
  if (sourceIds.length === 0) return [];

  return prisma.contentVocabulary.findMany({
    where: { sourceId: { in: [...new Set(sourceIds)] } },
    orderBy: [{ sortOrder: "asc" }, { term: "asc" }],
    take: 100,
    select: {
      id: true,
      term: true,
      definition: true,
      partOfSpeech: true,
      exampleUsage: true,
      topic: true,
    },
  });
});

/**
 * Course instructions — tutor rules extracted from any content source.
 * These are instructions for HOW to teach, not WHAT to teach.
 * Filtered by ASSERTION CATEGORY (instruction categories like teaching_rule,
 * session_flow, etc.) rather than by source DocumentType — this handles
 * mixed documents that contain both tutor instructions and student content.
 */
registerLoader("courseInstructions", async (_callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope) return [];

  // Get ALL source IDs (not filtered by documentType — filter by category instead)
  const allSourceIds = scope.subjects.flatMap((s) =>
    s.sources.map((ss) => ss.sourceId)
  );
  if (allSourceIds.length === 0) return [];

  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId: { in: [...new Set(allSourceIds)] },
      category: { in: [...INSTRUCTION_CATEGORIES] },
    },
    orderBy: [
      { depth: "asc" },
      { orderIndex: "asc" },
    ],
    take: 200,
    select: {
      id: true,
      assertion: true,
      category: true,
      chapter: true,
      section: true,
      tags: true,
      depth: true,
      parentId: true,
      orderIndex: true,
      source: {
        select: { name: true },
      },
    },
  });

  return assertions.map((a) => ({
    id: a.id,
    assertion: a.assertion,
    category: a.category,
    chapter: a.chapter,
    section: a.section,
    tags: a.tags,
    sourceName: a.source.name,
    depth: a.depth,
    parentId: a.parentId,
    orderIndex: a.orderIndex,
  }));
});

/**
 * Open actions — pending/in-progress actions for this caller.
 * Fed into voice prompt so the AI agent can reference them.
 */
registerLoader("openActions", async (callerId) => {
  return prisma.callAction.findMany({
    where: {
      callerId,
      status: { in: ["PENDING", "IN_PROGRESS"] },
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      type: true,
      title: true,
      description: true,
      assignee: true,
      priority: true,
      dueAt: true,
      createdAt: true,
    },
  });
});

/**
 * Visual aids — extracted images from content sources linked to the caller's domain.
 * Injected into prompt so the AI knows what figures/diagrams are available to reference
 * (verbally in voice calls, or via share_content in sim).
 */
registerLoader("visualAids", async (_callerId, loaderConfig) => {
  const scope: ContentScope = loaderConfig?.contentScope ?? null;
  if (!scope || scope.subjectIds.length === 0) return [];

  const subjectIds = scope.subjectIds;

  const subjectMedia = await prisma.subjectMedia.findMany({
    where: {
      subjectId: { in: subjectIds },
      media: { mimeType: { startsWith: "image/" } },
    },
    include: {
      media: {
        select: {
          id: true,
          fileName: true,
          captionText: true,
          figureRef: true,
          mimeType: true,
          pageNumber: true,
        },
      },
    },
    take: 20,
    orderBy: { sortOrder: "asc" },
  });

  // Resolve chapter from AssertionMedia link if available
  const mediaIds = subjectMedia.map((sm) => sm.media.id);
  const assertionLinks = mediaIds.length > 0
    ? await prisma.assertionMedia.findMany({
        where: { mediaId: { in: mediaIds } },
        select: {
          mediaId: true,
          assertion: { select: { chapter: true } },
        },
        distinct: ["mediaId"],
      })
    : [];
  const mediaChapterMap = new Map(
    assertionLinks.map((al) => [al.mediaId, al.assertion.chapter]),
  );

  return subjectMedia.map((sm) => ({
    mediaId: sm.media.id,
    fileName: sm.media.fileName,
    captionText: sm.media.captionText,
    figureRef: sm.media.figureRef,
    chapter: mediaChapterMap.get(sm.media.id) || null,
    mimeType: sm.media.mimeType,
  }));
});
