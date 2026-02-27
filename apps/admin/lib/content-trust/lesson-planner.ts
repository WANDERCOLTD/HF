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
      where: { sourceId },
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

  // Consolidate small sessions into session-length blocks
  const teachSessions = consolidateSessions(sessions, { sessionLength, targetSessionCount });
  sessions.length = 0;
  sessions.push(...teachSessions);
  sessionNumber = sessions.length + 1;

  // Add assessment session if requested
  if (includeAssessment && questions.length > 0) {
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

  // Add review session if requested
  if (includeReview && sessions.length > 2) {
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

  // AI refinement: improve session titles and objectives
  const refined = await refineWithAI(sessions, assertions.length, questions.length, vocabulary.length);

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

  // Re-number
  for (let i = 0; i < consolidated.length; i++) {
    consolidated[i].sessionNumber = i + 1;
  }

  return consolidated;
}

/** Merge session B into session A, combining all content arrays and picking the best title. */
function mergeTwoSessions(a: LessonSession, b: LessonSession): LessonSession {
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
