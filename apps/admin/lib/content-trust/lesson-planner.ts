/**
 * Lesson Planner
 *
 * Generates a structured lesson plan from a content source's extracted
 * assertions, questions, and vocabulary. Groups content into sessions
 * by topic/LO, estimates timing, and sequences prerequisites.
 *
 * Uses AI to refine session boundaries, naming, and transitions.
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { getLessonPlanModel } from "@/lib/lesson-plan/models";
import type { LessonPlanModelConfig } from "@/lib/lesson-plan/types";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface SessionMediaRef {
  mediaId: string;
  fileName?: string;
  captionText?: string | null;
  figureRef?: string | null;
  mimeType?: string;
}

export interface SessionSource {
  id: string;
  name: string;
  documentType: string;
}

export interface LessonSession {
  sessionNumber: number;
  title: string;
  objectives: string[];
  assertionIds: string[];
  questionIds: string[];
  vocabularyIds: string[];
  estimatedMinutes: number;
  sessionType: "introduce" | "practice" | "assess" | "review";
  /** Images auto-resolved from assertion → AssertionMedia → MediaAsset links */
  media?: SessionMediaRef[];
  /** Content sources feeding this session (for timeline display) */
  sources?: SessionSource[];
}

export interface PrerequisiteLink {
  sessionNumber: number;
  requiresSession: number;
  reason: string;
}

export interface LessonPlan {
  totalSessions: number;
  estimatedMinutesPerSession: number;
  sessions: LessonSession[];
  prerequisites: PrerequisiteLink[];
  generatedAt: string;
}

export interface LessonPlanOptions {
  sessionLength?: number; // default 30 min
  includeAssessment?: boolean; // default true
  includeReview?: boolean; // default true
  targetSessionCount?: number; // if set, consolidate small sessions to hit this target
  skipAIRefinement?: boolean; // skip AI title refinement for instant generation
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const MINUTES_PER_ASSERTION = 2;
const MINUTES_PER_QUESTION = 3;
const MINUTES_PER_VOCAB = 1;
const DEFAULT_SESSION_LENGTH = 30;

// ------------------------------------------------------------------
// Lesson plan generation
// ------------------------------------------------------------------

/**
 * Generate a lesson plan for a content source.
 *
 * 1. Load assertions, questions, vocabulary (grouped by LO/topic)
 * 2. Estimate time per topic
 * 3. Group into sessions (respecting max session length)
 * 4. Sequence: foundational → applied → assessment
 * 5. AI refinement for naming and transitions
 */
export async function generateLessonPlan(
  sourceId: string,
  options: LessonPlanOptions = {},
): Promise<LessonPlan> {
  const sessionLength = options.sessionLength || DEFAULT_SESSION_LENGTH;
  const includeAssessment = options.includeAssessment !== false;
  const includeReview = options.includeReview !== false;
  const targetSessionCount = options.targetSessionCount;

  // Load content
  const [assertions, questions, vocabulary] = await Promise.all([
    prisma.contentAssertion.findMany({
      where: { sourceId, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
      select: {
        id: true,
        assertion: true,
        category: true,
        chapter: true,
        learningOutcomeRef: true,
        depth: true,
        topicSlug: true,
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.contentQuestion.findMany({
      where: { sourceId },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        chapter: true,
        learningOutcomeRef: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.contentVocabulary.findMany({
      where: { sourceId },
      select: {
        id: true,
        term: true,
        topic: true,
        chapter: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (assertions.length === 0) {
    return {
      totalSessions: 0,
      estimatedMinutesPerSession: sessionLength,
      sessions: [],
      prerequisites: [],
      generatedAt: new Date().toISOString(),
    };
  }

  // Group content by topic (using LO ref, chapter, or topicSlug)
  const topicGroups = groupByTopic(assertions, questions, vocabulary);

  // Build sessions from topic groups
  const sessions: LessonSession[] = [];
  let sessionNumber = 1;

  for (const group of topicGroups) {
    const estimatedMinutes =
      group.assertions.length * MINUTES_PER_ASSERTION +
      group.questions.length * MINUTES_PER_QUESTION +
      group.vocabulary.length * MINUTES_PER_VOCAB;

    // If this group fits in a session, add it as one
    if (estimatedMinutes <= sessionLength) {
      sessions.push({
        sessionNumber,
        title: group.topic,
        objectives: group.assertions
          .filter((a) => a.depth === 0 || a.depth === 1)
          .slice(0, 3)
          .map((a) => a.assertion),
        assertionIds: group.assertions.map((a) => a.id),
        questionIds: group.questions.map((q) => q.id),
        vocabularyIds: group.vocabulary.map((v) => v.id),
        estimatedMinutes,
        sessionType: group.questions.length > group.assertions.length ? "practice" : "introduce",
      });
      sessionNumber++;
    } else {
      // Split into multiple sessions
      const numSessions = Math.ceil(estimatedMinutes / sessionLength);
      const assertionsPerSession = Math.ceil(group.assertions.length / numSessions);

      for (let i = 0; i < numSessions; i++) {
        const startIdx = i * assertionsPerSession;
        const sessionAssertions = group.assertions.slice(startIdx, startIdx + assertionsPerSession);
        const sessionQuestions = i === numSessions - 1 ? group.questions : [];
        const sessionVocab = i === 0 ? group.vocabulary : [];

        sessions.push({
          sessionNumber,
          title: `${group.topic} (Part ${i + 1})`,
          objectives: sessionAssertions
            .filter((a) => a.depth === 0 || a.depth === 1)
            .slice(0, 3)
            .map((a) => a.assertion),
          assertionIds: sessionAssertions.map((a) => a.id),
          questionIds: sessionQuestions.map((q) => q.id),
          vocabularyIds: sessionVocab.map((v) => v.id),
          estimatedMinutes: Math.min(sessionLength, estimatedMinutes / numSessions),
          sessionType: i === numSessions - 1 ? "practice" : "introduce",
        });
        sessionNumber++;
      }
    }
  }

  // Reserve slots for assessment/review within the session budget
  // so consolidation can pack teach sessions into the remaining slots
  let assessSlots = 0;
  if (targetSessionCount) {
    if (includeAssessment && questions.length > 0) assessSlots++;
    if (includeReview && sessions.length > 2) assessSlots++;
  }

  // Consolidate small sessions into session-length blocks
  const teachTarget = targetSessionCount
    ? Math.max(1, targetSessionCount - assessSlots)
    : undefined;
  const teachSessions = consolidateSessions(sessions, {
    sessionLength,
    targetSessionCount: teachTarget,
  });
  sessions.length = 0;
  sessions.push(...teachSessions);
  sessionNumber = sessions.length + 1;

  // Add assessment session if requested (only if budget allows)
  const canAddAssess = !targetSessionCount || sessions.length < targetSessionCount;
  if (includeAssessment && questions.length > 0 && canAddAssess) {
    sessions.push({
      sessionNumber,
      title: "Assessment",
      objectives: ["Review and assess understanding of all topics"],
      assertionIds: [],
      questionIds: questions.map((q) => q.id),
      vocabularyIds: [],
      estimatedMinutes: Math.min(sessionLength, questions.length * MINUTES_PER_QUESTION),
      sessionType: "assess",
    });
    sessionNumber++;
  }

  // Add review session if requested (only if budget allows)
  const canAddReview = !targetSessionCount || sessions.length < targetSessionCount;
  if (includeReview && sessions.length > 2 && canAddReview) {
    sessions.push({
      sessionNumber,
      title: "Review & Consolidation",
      objectives: ["Review key concepts", "Address gaps and misconceptions"],
      assertionIds: assertions.filter((a) => a.depth === 0 || a.depth === 1).map((a) => a.id),
      questionIds: [],
      vocabularyIds: vocabulary.map((v) => v.id),
      estimatedMinutes: sessionLength,
      sessionType: "review",
    });
    sessionNumber++;
  }

  // Build prerequisite links (each session depends on the previous)
  const prerequisites: PrerequisiteLink[] = sessions
    .filter((s) => s.sessionNumber > 1)
    .map((s) => ({
      sessionNumber: s.sessionNumber,
      requiresSession: s.sessionNumber - 1,
      reason: "Sequential topic progression",
    }));

  // AI refinement: improve session titles and objectives (skip for instant generation)
  const refined = options.skipAIRefinement
    ? sessions
    : await refineWithAI(sessions, assertions.length, questions.length, vocabulary.length);

  // Resolve images linked to each session's assertions via AssertionMedia
  await resolveSessionMedia(refined);

  return {
    totalSessions: refined.length,
    estimatedMinutesPerSession: sessionLength,
    sessions: refined,
    prerequisites,
    generatedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// Multi-source lesson plan generation (playbook-scoped)
// ------------------------------------------------------------------

export interface PlaybookPlanOptions extends LessonPlanOptions {
  /** Pedagogical model slug (e.g. 'direct_instruction', '5e'). Drives maxTpsPerSession + reviewFrequency. */
  lessonPlanModel?: string;
}

export interface SessionCountRecommendation {
  min: number;
  recommended: number;
  max: number;
  breakdown: {
    onboarding: number;
    teaching: number;
    review: number;
    assess: number;
    consolidation: number;
  };
  effectiveMaxTPs: number;
  totalTPs: number;
  totalModules: number;
}

export interface AdvisoryCheck {
  id: string;
  severity: "error" | "warning" | "info";
  message: string;
  affectedSessions?: number[];
}

export interface ExtendedLessonPlan extends LessonPlan {
  recommendation?: SessionCountRecommendation;
  advisories?: AdvisoryCheck[];
}

/**
 * Generate a lesson plan for an entire playbook (course) across all its content sources.
 *
 * Unlike `generateLessonPlan(sourceId)` which plans a single source,
 * this loads all sources for a playbook, applies topological prerequisite
 * ordering from parentId chains, respects maxTpsPerSession from the
 * pedagogical model, and produces advisory warnings.
 */
export async function generateLessonPlanForPlaybook(
  playbookId: string,
  options: PlaybookPlanOptions = {},
): Promise<ExtendedLessonPlan> {
  const sessionLength = options.sessionLength || DEFAULT_SESSION_LENGTH;
  const modelDef = getLessonPlanModel(options.lessonPlanModel);
  const maxTPs = modelDef.defaults.maxTpsPerSession;
  const effectiveMaxTPs = Math.round(maxTPs * (sessionLength / 15));

  // 1. Resolve all source IDs for this playbook via PlaybookSource
  const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
  const sourceIds = await getSourceIdsForPlaybook(playbookId);
  if (sourceIds.length === 0) return emptyPlan(sessionLength);

  // 2. Load all content across sources
  const [assertions, questions, vocabulary] = await Promise.all([
    prisma.contentAssertion.findMany({
      where: { sourceId: { in: sourceIds }, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
      select: {
        id: true,
        assertion: true,
        category: true,
        chapter: true,
        learningOutcomeRef: true,
        depth: true,
        topicSlug: true,
        parentId: true,
        sourceId: true,
      },
      orderBy: [{ depth: "asc" }, { orderIndex: "asc" }],
    }),
    prisma.contentQuestion.findMany({
      where: { sourceId: { in: sourceIds } },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        chapter: true,
        learningOutcomeRef: true,
      },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.contentVocabulary.findMany({
      where: { sourceId: { in: sourceIds } },
      select: { id: true, term: true, topic: true, chapter: true },
      orderBy: { sortOrder: "asc" },
    }),
  ]);

  if (assertions.length === 0) return emptyPlan(sessionLength);

  // 3. Topological sort by parentId chains
  const sortedAssertions = topologicalSortAssertions(assertions);

  // 4. Group by topic and build sessions (reusing existing logic)
  const topicGroups = groupByTopic(sortedAssertions, questions, vocabulary);
  const sessions: LessonSession[] = [];
  let sessionNumber = 1;

  for (const group of topicGroups) {
    const estimatedMinutes =
      group.assertions.length * MINUTES_PER_ASSERTION +
      group.questions.length * MINUTES_PER_QUESTION +
      group.vocabulary.length * MINUTES_PER_VOCAB;

    // Dual constraint: time budget AND cognitive load cap
    const maxAssertionsPerSession = effectiveMaxTPs;
    const needsSplitByTime = estimatedMinutes > sessionLength;
    const needsSplitByTPs = group.assertions.length > maxAssertionsPerSession;

    if (!needsSplitByTime && !needsSplitByTPs) {
      sessions.push({
        sessionNumber,
        title: group.topic,
        objectives: group.assertions
          .filter((a) => a.depth === 0 || a.depth === 1)
          .slice(0, 3)
          .map((a) => a.assertion),
        assertionIds: group.assertions.map((a) => a.id),
        questionIds: group.questions.map((q) => q.id),
        vocabularyIds: group.vocabulary.map((v) => v.id),
        estimatedMinutes,
        sessionType: group.questions.length > group.assertions.length ? "practice" : "introduce",
      });
      sessionNumber++;
    } else {
      // Split by whichever constraint is tighter
      const numByTime = Math.ceil(estimatedMinutes / sessionLength);
      const numByTPs = Math.ceil(group.assertions.length / maxAssertionsPerSession);
      const numSessions = Math.max(numByTime, numByTPs);
      const assertionsPerSession = Math.ceil(group.assertions.length / numSessions);

      for (let i = 0; i < numSessions; i++) {
        const startIdx = i * assertionsPerSession;
        const sessionAssertions = group.assertions.slice(startIdx, startIdx + assertionsPerSession);
        const sessionQuestions = i === numSessions - 1 ? group.questions : [];
        const sessionVocab = i === 0 ? group.vocabulary : [];

        sessions.push({
          sessionNumber,
          title: numSessions > 1 ? `${group.topic} (Part ${i + 1})` : group.topic,
          objectives: sessionAssertions
            .filter((a) => a.depth === 0 || a.depth === 1)
            .slice(0, 3)
            .map((a) => a.assertion),
          assertionIds: sessionAssertions.map((a) => a.id),
          questionIds: sessionQuestions.map((q) => q.id),
          vocabularyIds: sessionVocab.map((v) => v.id),
          estimatedMinutes: Math.min(sessionLength, estimatedMinutes / numSessions),
          sessionType: i === numSessions - 1 && sessionQuestions.length > 0 ? "practice" : "introduce",
        });
        sessionNumber++;
      }
    }
  }

  // 5. Consolidate to target session count
  const includeAssessment = options.includeAssessment !== false;
  const includeReview = options.includeReview !== false;
  let assessSlots = 0;
  if (options.targetSessionCount) {
    if (includeAssessment && questions.length > 0) assessSlots++;
    if (includeReview && sessions.length > 2) assessSlots++;
  }

  const teachTarget = options.targetSessionCount
    ? Math.max(1, options.targetSessionCount - assessSlots)
    : undefined;
  const teachSessions = consolidateSessions(sessions, {
    sessionLength,
    targetSessionCount: teachTarget,
  });
  sessions.length = 0;
  sessions.push(...teachSessions);
  sessionNumber = sessions.length + 1;

  // 6. Add structural sessions
  const canAddAssess = !options.targetSessionCount || sessions.length < options.targetSessionCount;
  if (includeAssessment && questions.length > 0 && canAddAssess) {
    sessions.push({
      sessionNumber,
      title: "Assessment",
      objectives: ["Review and assess understanding of all topics"],
      assertionIds: [],
      questionIds: questions.map((q) => q.id),
      vocabularyIds: [],
      estimatedMinutes: Math.min(sessionLength, questions.length * MINUTES_PER_QUESTION),
      sessionType: "assess",
    });
    sessionNumber++;
  }

  const canAddReview = !options.targetSessionCount || sessions.length < options.targetSessionCount;
  if (includeReview && sessions.length > 2 && canAddReview) {
    sessions.push({
      sessionNumber,
      title: "Review & Consolidation",
      objectives: ["Review key concepts", "Address gaps and misconceptions"],
      assertionIds: assertions.filter((a) => a.depth === 0 || a.depth === 1).map((a) => a.id),
      questionIds: [],
      vocabularyIds: vocabulary.map((v) => v.id),
      estimatedMinutes: sessionLength,
      sessionType: "review",
    });
    sessionNumber++;
  }

  // 7. Build prerequisite links from actual parentId graph
  const prerequisites = buildPrerequisiteLinks(assertions, sessions);

  // 8. AI refinement
  const refined = options.skipAIRefinement
    ? sessions
    : await refineWithAI(sessions, assertions.length, questions.length, vocabulary.length);

  // 9. Resolve media
  await resolveSessionMedia(refined);

  // 10. Session count recommendation
  const recommendation = computeSessionCountRecommendation(
    assertions.length,
    topicGroups.length,
    modelDef.defaults,
    sessionLength,
  );

  // 11. Advisory checks
  const advisories = runAdvisoryChecks(refined, assertions, maxTPs);

  return {
    totalSessions: refined.length,
    estimatedMinutesPerSession: sessionLength,
    sessions: refined,
    prerequisites,
    generatedAt: new Date().toISOString(),
    recommendation,
    advisories: advisories.length > 0 ? advisories : undefined,
  };
}

function emptyPlan(sessionLength: number): ExtendedLessonPlan {
  return {
    totalSessions: 0,
    estimatedMinutesPerSession: sessionLength,
    sessions: [],
    prerequisites: [],
    generatedAt: new Date().toISOString(),
  };
}

// ------------------------------------------------------------------
// Topological sort for prerequisite ordering
// ------------------------------------------------------------------

/**
 * Sort assertions respecting parentId dependency chains (Kahn's algorithm).
 * Parents appear before their children in the output.
 * Falls back to depth+orderIndex ordering if no parentId links exist.
 * Throws on cycle detection.
 */
function topologicalSortAssertions<
  T extends { id: string; parentId?: string | null; depth: number | null },
>(assertions: T[]): T[] {
  const idSet = new Set(assertions.map((a) => a.id));
  const childrenOf = new Map<string, string[]>();
  const inDegree = new Map<string, number>();

  // Initialize
  for (const a of assertions) {
    inDegree.set(a.id, 0);
    if (!childrenOf.has(a.id)) childrenOf.set(a.id, []);
  }

  // Build graph — only count edges where both parent and child are in our set
  for (const a of assertions) {
    if (a.parentId && idSet.has(a.parentId)) {
      childrenOf.get(a.parentId)!.push(a.id);
      inDegree.set(a.id, (inDegree.get(a.id) || 0) + 1);
    }
  }

  // Check if any edges exist — if not, return original order (depth+orderIndex from query)
  const hasEdges = [...inDegree.values()].some((d) => d > 0);
  if (!hasEdges) return assertions;

  // Kahn's algorithm
  const queue: string[] = [];
  for (const [id, deg] of inDegree) {
    if (deg === 0) queue.push(id);
  }

  // Sort roots by depth (shallower first) for stable output
  const byId = new Map(assertions.map((a) => [a.id, a]));
  queue.sort((a, b) => ((byId.get(a)?.depth ?? 0) - (byId.get(b)?.depth ?? 0)));

  const sorted: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    sorted.push(id);
    for (const childId of childrenOf.get(id) || []) {
      const newDeg = (inDegree.get(childId) || 1) - 1;
      inDegree.set(childId, newDeg);
      if (newDeg === 0) queue.push(childId);
    }
  }

  if (sorted.length !== assertions.length) {
    const missing = assertions.length - sorted.length;
    throw new Error(
      `Cycle detected in ContentAssertion parentId chains: ${missing} assertion(s) could not be ordered. ` +
      `Check parentId references for circular dependencies.`,
    );
  }

  // Rebuild array in sorted order
  return sorted.map((id) => byId.get(id)!);
}

// Exported for testing
export { topologicalSortAssertions };

// ------------------------------------------------------------------
// Prerequisite links from parentId graph
// ------------------------------------------------------------------

/**
 * Build prerequisite links between sessions based on actual parentId
 * dependencies. If TP-A (in session 2) is the parent of TP-B (in session 5),
 * then session 5 requires session 2.
 */
function buildPrerequisiteLinks(
  assertions: Array<{ id: string; parentId?: string | null }>,
  sessions: LessonSession[],
): PrerequisiteLink[] {
  // Build assertion → session map
  const assertionToSession = new Map<string, number>();
  for (const session of sessions) {
    for (const aId of session.assertionIds) {
      assertionToSession.set(aId, session.sessionNumber);
    }
  }

  const links = new Map<string, PrerequisiteLink>();

  for (const a of assertions) {
    if (!a.parentId) continue;
    const childSession = assertionToSession.get(a.id);
    const parentSession = assertionToSession.get(a.parentId);
    if (childSession == null || parentSession == null) continue;
    if (parentSession >= childSession) continue; // already in order or same session

    const key = `${childSession}->${parentSession}`;
    if (!links.has(key)) {
      links.set(key, {
        sessionNumber: childSession,
        requiresSession: parentSession,
        reason: "Teaching point dependency (parentId chain)",
      });
    }
  }

  // If no real dependencies, fall back to linear chain
  if (links.size === 0) {
    return sessions
      .filter((s) => s.sessionNumber > 1)
      .map((s) => ({
        sessionNumber: s.sessionNumber,
        requiresSession: s.sessionNumber - 1,
        reason: "Sequential topic progression",
      }));
  }

  return [...links.values()].sort((a, b) => a.sessionNumber - b.sessionNumber);
}

// ------------------------------------------------------------------
// Session count recommendation
// ------------------------------------------------------------------

export function computeSessionCountRecommendation(
  totalTPs: number,
  totalModules: number,
  modelConfig: Required<LessonPlanModelConfig>,
  sessionLengthMins: number,
): SessionCountRecommendation {
  const { maxTpsPerSession, reviewFrequency, assessmentStyle } = modelConfig;
  const effectiveMaxTPs = Math.round(maxTpsPerSession * (sessionLengthMins / 15));

  const teaching = Math.max(1, Math.ceil(totalTPs / Math.max(1, effectiveMaxTPs)));
  const onboarding = 1;
  const review = reviewFrequency > 0 ? Math.max(0, Math.floor(totalModules / reviewFrequency)) : 0;
  const assess = assessmentStyle !== "none" ? 1 : 0;
  const consolidation = 1;

  const recommended = onboarding + teaching + review + assess + consolidation;
  const min = Math.max(2, onboarding + Math.max(1, totalModules) + consolidation);
  const max = onboarding + teaching * 2 + review + assess + consolidation; // each teach could get a deepen

  return {
    min: Math.min(min, recommended),
    recommended,
    max,
    breakdown: { onboarding, teaching, review, assess, consolidation },
    effectiveMaxTPs,
    totalTPs,
    totalModules,
  };
}

// ------------------------------------------------------------------
// Advisory checks
// ------------------------------------------------------------------

export function runAdvisoryChecks(
  sessions: LessonSession[],
  assertions: Array<{ id: string; parentId?: string | null }>,
  maxTpsPerSession: number,
): AdvisoryCheck[] {
  const checks: AdvisoryCheck[] = [];

  // Build assertion → session map
  const assertionToSession = new Map<string, number>();
  for (const session of sessions) {
    for (const aId of session.assertionIds) {
      assertionToSession.set(aId, session.sessionNumber);
    }
  }

  // 1. Overloaded sessions
  const teachingSessions = sessions.filter((s) => !["assess", "review"].includes(s.sessionType));
  for (const s of teachingSessions) {
    if (s.assertionIds.length > maxTpsPerSession) {
      checks.push({
        id: "overloaded_session",
        severity: "warning",
        message: `Session ${s.sessionNumber} "${s.title}" has ${s.assertionIds.length} teaching points (max ${maxTpsPerSession}) — consider splitting`,
        affectedSessions: [s.sessionNumber],
      });
    }
  }

  // 2. Thin sessions
  for (const s of teachingSessions) {
    if (s.assertionIds.length > 0 && s.assertionIds.length < 3) {
      checks.push({
        id: "thin_session",
        severity: "info",
        message: `Session ${s.sessionNumber} "${s.title}" has only ${s.assertionIds.length} teaching point(s) — consider merging with an adjacent session`,
        affectedSessions: [s.sessionNumber],
      });
    }
  }

  // 3. Unassigned TPs
  const assignedIds = new Set(sessions.flatMap((s) => s.assertionIds));
  const unassignedCount = assertions.filter((a) => !assignedIds.has(a.id)).length;
  if (unassignedCount > 0) {
    checks.push({
      id: "unassigned_tps",
      severity: "warning",
      message: `${unassignedCount} teaching point(s) are not assigned to any session`,
    });
  }

  // 4. Prerequisite violations
  for (const a of assertions) {
    if (!a.parentId) continue;
    const childSession = assertionToSession.get(a.id);
    const parentSession = assertionToSession.get(a.parentId);
    if (childSession == null || parentSession == null) continue;
    if (childSession < parentSession) {
      checks.push({
        id: "prerequisite_violation",
        severity: "error",
        message: `Teaching point in session ${childSession} depends on a prerequisite in session ${parentSession} — prerequisite should come first`,
        affectedSessions: [childSession, parentSession],
      });
    }
  }

  return checks;
}

// ------------------------------------------------------------------
// Session media resolution
// ------------------------------------------------------------------

/**
 * Batch-resolve images linked to each session's assertions.
 * Queries AssertionMedia → MediaAsset for all assertion IDs across sessions,
 * then groups results back by session. Mutates sessions in place.
 */
async function resolveSessionMedia(sessions: LessonSession[]): Promise<void> {
  const allAssertionIds = sessions.flatMap((s) => s.assertionIds);
  if (allAssertionIds.length === 0) return;

  const links = await prisma.assertionMedia.findMany({
    where: { assertionId: { in: allAssertionIds } },
    select: {
      assertionId: true,
      media: {
        select: {
          id: true,
          fileName: true,
          captionText: true,
          figureRef: true,
          mimeType: true,
        },
      },
    },
  });

  if (links.length === 0) return;

  // Build assertionId → media refs map
  const assertionMediaMap = new Map<string, SessionMediaRef[]>();
  for (const link of links) {
    const refs = assertionMediaMap.get(link.assertionId) || [];
    refs.push({
      mediaId: link.media.id,
      fileName: link.media.fileName,
      captionText: link.media.captionText,
      figureRef: link.media.figureRef,
      mimeType: link.media.mimeType,
    });
    assertionMediaMap.set(link.assertionId, refs);
  }

  // Assign to sessions, deduplicating by mediaId
  for (const session of sessions) {
    const seen = new Set<string>();
    const media: SessionMediaRef[] = [];
    for (const aId of session.assertionIds) {
      for (const ref of assertionMediaMap.get(aId) || []) {
        if (!seen.has(ref.mediaId)) {
          seen.add(ref.mediaId);
          media.push(ref);
        }
      }
    }
    if (media.length > 0) {
      session.media = media;
    }
  }
}

// ------------------------------------------------------------------
// Session consolidation
// ------------------------------------------------------------------

/**
 * Merge consecutive small sessions until each reaches the target duration.
 * Greedy first-fit: walk sessions in order, keep merging the next one into the
 * current "bucket" until adding it would exceed `targetMinutes`. Then start a
 * new bucket.
 *
 * If `targetSessionCount` is provided, we derive `targetMinutes` from the total
 * estimated time ÷ target count (clamped to a sane range).
 */
export function consolidateSessions(
  sessions: LessonSession[],
  opts: { sessionLength: number; targetSessionCount?: number },
): LessonSession[] {
  if (sessions.length <= 1) return sessions;

  const totalMinutes = sessions.reduce((s, sess) => s + sess.estimatedMinutes, 0);

  // Derive how full each consolidated session should be
  let targetMinutes: number;
  if (opts.targetSessionCount && opts.targetSessionCount > 0) {
    // Use target count to size sessions, but clamp between 5 and 2× sessionLength
    targetMinutes = Math.max(5, Math.min(totalMinutes / opts.targetSessionCount, opts.sessionLength * 2));
  } else {
    // Default: fill to 80% of session length so there's breathing room
    targetMinutes = opts.sessionLength * 0.8;
  }

  const consolidated: LessonSession[] = [];
  let bucket: LessonSession | null = null;

  for (const sess of sessions) {
    if (!bucket) {
      bucket = { ...sess };
      continue;
    }

    // Would adding this session exceed the target?
    if (bucket.estimatedMinutes + sess.estimatedMinutes > targetMinutes && bucket.estimatedMinutes > 0) {
      consolidated.push(bucket);
      bucket = { ...sess };
    } else {
      // Merge into current bucket
      bucket = mergeTwoSessions(bucket, sess);
    }
  }
  if (bucket) consolidated.push(bucket);

  // Hard cap: if we still exceed targetSessionCount, force-merge smallest adjacent pairs
  if (opts.targetSessionCount && consolidated.length > opts.targetSessionCount) {
    while (consolidated.length > opts.targetSessionCount && consolidated.length > 1) {
      // Find the adjacent pair with smallest combined duration (least disruption)
      let bestIdx = 0;
      let bestCombined = Infinity;
      for (let i = 0; i < consolidated.length - 1; i++) {
        const combined = consolidated[i].estimatedMinutes + consolidated[i + 1].estimatedMinutes;
        if (combined < bestCombined) {
          bestCombined = combined;
          bestIdx = i;
        }
      }
      const merged = mergeTwoSessions(consolidated[bestIdx], consolidated[bestIdx + 1]);
      consolidated.splice(bestIdx, 2, merged);
    }
  }

  // Split to reach target: if fewer sessions than requested, split the largest ones
  if (opts.targetSessionCount && consolidated.length < opts.targetSessionCount) {
    while (consolidated.length < opts.targetSessionCount) {
      // Find the session with the most assertions (best candidate to split)
      let bestIdx = 0;
      let bestCount = 0;
      for (let i = 0; i < consolidated.length; i++) {
        const count = consolidated[i].assertionIds.length;
        if (count > bestCount) {
          bestCount = count;
          bestIdx = i;
        }
      }
      // Need at least 2 assertions to split
      if (bestCount < 2) break;

      const session = consolidated[bestIdx];
      const midpoint = Math.ceil(session.assertionIds.length / 2);

      const firstHalf: LessonSession = {
        ...session,
        title: session.title,
        assertionIds: session.assertionIds.slice(0, midpoint),
        questionIds: [], // questions go to the second half
        vocabularyIds: session.vocabularyIds, // vocab stays with intro
        estimatedMinutes: Math.round(session.estimatedMinutes / 2),
        objectives: session.objectives.slice(0, Math.ceil(session.objectives.length / 2)),
        sessionType: "introduce",
      };

      const secondHalf: LessonSession = {
        ...session,
        title: `${session.title} (continued)`,
        assertionIds: session.assertionIds.slice(midpoint),
        questionIds: session.questionIds,
        vocabularyIds: [],
        estimatedMinutes: Math.round(session.estimatedMinutes / 2),
        objectives: session.objectives.slice(Math.ceil(session.objectives.length / 2)),
        sessionType: session.questionIds.length > 0 ? "practice" : "introduce",
      };

      consolidated.splice(bestIdx, 1, firstHalf, secondHalf);
    }
  }

  // Re-number
  for (let i = 0; i < consolidated.length; i++) {
    consolidated[i].sessionNumber = i + 1;
  }

  return consolidated;
}

/** Merge session B into session A, combining all content arrays and picking the best title. */
function mergeTwoSessions(a: LessonSession, b: LessonSession): LessonSession {
  // Deduplicate sources by id
  const seenSourceIds = new Set<string>();
  const mergedSources: SessionSource[] = [];
  for (const src of [...(a.sources || []), ...(b.sources || [])]) {
    if (!seenSourceIds.has(src.id)) {
      seenSourceIds.add(src.id);
      mergedSources.push(src);
    }
  }

  return {
    sessionNumber: a.sessionNumber, // re-numbered later
    title: a.title, // AI refinement fixes titles afterward
    objectives: [...a.objectives, ...b.objectives].slice(0, 5),
    assertionIds: [...a.assertionIds, ...b.assertionIds],
    questionIds: [...a.questionIds, ...b.questionIds],
    vocabularyIds: [...a.vocabularyIds, ...b.vocabularyIds],
    estimatedMinutes: a.estimatedMinutes + b.estimatedMinutes,
    sessionType: a.sessionType === "practice" || b.sessionType === "practice" ? "practice" : "introduce",
    media: [...(a.media || []), ...(b.media || [])],
    sources: mergedSources.length > 0 ? mergedSources : undefined,
  };
}

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

interface TopicGroup {
  topic: string;
  assertions: Array<{ id: string; assertion: string; depth: number | null }>;
  questions: Array<{ id: string }>;
  vocabulary: Array<{ id: string }>;
}

function groupByTopic(
  assertions: Array<{ id: string; assertion: string; chapter: string | null; learningOutcomeRef: string | null; depth: number | null; topicSlug: string | null }>,
  questions: Array<{ id: string; chapter: string | null; learningOutcomeRef: string | null }>,
  vocabulary: Array<{ id: string; topic: string | null; chapter: string | null }>,
): TopicGroup[] {
  const groups = new Map<string, TopicGroup>();

  // Group assertions
  for (const a of assertions) {
    const key = a.learningOutcomeRef || a.topicSlug || a.chapter || "General";
    if (!groups.has(key)) {
      groups.set(key, { topic: key, assertions: [], questions: [], vocabulary: [] });
    }
    groups.get(key)!.assertions.push({ id: a.id, assertion: a.assertion, depth: a.depth });
  }

  // Group questions
  for (const q of questions) {
    const key = q.learningOutcomeRef || q.chapter || "General";
    if (groups.has(key)) {
      groups.get(key)!.questions.push({ id: q.id });
    } else {
      // Assign to first group as fallback
      const first = [...groups.values()][0];
      if (first) first.questions.push({ id: q.id });
    }
  }

  // Group vocabulary
  for (const v of vocabulary) {
    const key = v.topic || v.chapter || "General";
    if (groups.has(key)) {
      groups.get(key)!.vocabulary.push({ id: v.id });
    } else {
      const first = [...groups.values()][0];
      if (first) first.vocabulary.push({ id: v.id });
    }
  }

  return [...groups.values()];
}

async function refineWithAI(
  sessions: LessonSession[],
  assertionCount: number,
  questionCount: number,
  vocabularyCount: number,
): Promise<LessonSession[]> {
  if (sessions.length === 0) return sessions;

  try {
    const sessionSummary = sessions.map((s) => ({
      number: s.sessionNumber,
      title: s.title,
      type: s.sessionType,
      assertionCount: s.assertionIds.length,
      questionCount: s.questionIds.length,
      vocabCount: s.vocabularyIds.length,
      minutes: s.estimatedMinutes,
      objectives: s.objectives.slice(0, 2),
    }));

    // @ai-call content-trust.lesson-plan — Refine lesson plan session titles and objectives | config: /x/ai-config
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "content-trust.lesson-plan",
        messages: [
          {
            role: "system",
            content: `You are a curriculum designer. Given a raw lesson plan, improve the session titles to be student-friendly and concise. Keep session numbers and content assignments unchanged. Return a JSON array of objects with "number" and "title" fields only.`,
          },
          {
            role: "user",
            content: `Lesson plan with ${assertionCount} teaching points, ${questionCount} questions, ${vocabularyCount} vocabulary items across ${sessions.length} sessions:\n\n${JSON.stringify(sessionSummary, null, 2)}\n\nReturn improved titles as JSON array: [{"number": 1, "title": "Better Title"}, ...]`,
          },
        ],
      },
      { sourceOp: "content-trust:lesson-plan" },
    );

    logAssistantCall(
      {
        callPoint: "content-trust.lesson-plan",
        userMessage: `Refine ${sessions.length} session titles`,
        metadata: { sessionCount: sessions.length },
      },
      { response: "Titles refined", success: true },
    );

    const responseText = result.content.trim();
    let jsonStr = responseText.startsWith("[") ? responseText : responseText.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
    const refinedTitles = JSON.parse(jsonStr);

    if (Array.isArray(refinedTitles)) {
      const titleMap = new Map(refinedTitles.map((r: any) => [r.number, r.title]));
      for (const session of sessions) {
        const newTitle = titleMap.get(session.sessionNumber);
        if (newTitle && typeof newTitle === "string") {
          session.title = newTitle;
        }
      }
    }
  } catch (err: any) {
    console.warn("[lesson-planner] AI refinement failed, using raw titles:", err?.message);
  }

  return sessions;
}
