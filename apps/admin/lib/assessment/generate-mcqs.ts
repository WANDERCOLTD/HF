/**
 * MCQ Auto-Generation — synthesises MCQ questions from ContentAssertion rows
 * when document extraction didn't produce any.
 *
 * Triggered after extraction completes for a primarySource with 0 MCQs.
 * Uses assertions as the knowledge base, asks AI to generate MCQs with distractors.
 *
 * Bloom-aware: questions are tagged with bloomLevel for cognitive-level spread.
 * Comprehension path: when TUTOR_QUESTIONs exist for a comprehension-led subject,
 * generates MCQs from the rich question bank data instead of flat assertions.
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { saveQuestions } from "@/lib/content-trust/save-questions";
import type { ExtractedQuestion } from "@/lib/content-trust/extractors/base-extractor";
import { createHash } from "crypto";
import { jsonrepair } from "jsonrepair";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_COUNT = 8;
const CALL_POINT = "content-trust.generate-mcq";
const COMPREHENSION_CALL_POINT = "content-trust.generate-mcq-comprehension";

/** Blocklist patterns that indicate framework/rubric leakage in generated questions */
const FRAMEWORK_BLOCKLIST = [
  /\b(skill\s*framework|assessment\s*framework|rubric|marking\s*criteria)\b/i,
  /\b(emerging|developing|secure)\b.*\b(level|tier|band|stage)\b/i,
  /\baccording to the (skill|assessment|marking)\b/i,
  /\bSKILL-\d{2}\b/,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedMcq {
  question: string;
  questionType?: "MCQ" | "TRUE_FALSE";
  bloomLevel?: string;
  options: { label: string; text: string; isCorrect: boolean }[];
  correctAnswer: string;
  chapter?: string;
  skillRef?: string;
  explanation?: string;
}

export interface GenerateMcqsResult {
  created: number;
  duplicatesSkipped: number;
  skipped: boolean;
  skipReason?: string;
}

type BloomLevel = "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";

const VALID_BLOOM_LEVELS = new Set<BloomLevel>(["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"]);

function normalizeBloomLevel(raw: unknown): BloomLevel | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.toUpperCase().trim() as BloomLevel;
  return VALID_BLOOM_LEVELS.has(upper) ? upper : undefined;
}

// ---------------------------------------------------------------------------
// Check if source needs MCQ generation
// ---------------------------------------------------------------------------

export async function sourceNeedsMcqs(sourceId: string): Promise<boolean> {
  const count = await prisma.contentQuestion.count({
    where: { sourceId, questionType: { in: ["MCQ", "TRUE_FALSE"] } },
  });
  return count === 0;
}

/**
 * Check if a source is linked to a subject (via SubjectSource) or is a
 * curriculum's primarySource.  Either condition means the source is
 * "owned" content that should have pre-test questions.
 *
 * Previously only checked primarySourceId, but that's set by curriculum
 * generation which runs *after* extraction — creating a race where MCQs
 * were permanently skipped.
 */
export async function isLinkedSource(sourceId: string): Promise<boolean> {
  const [primaryCount, subjectSourceCount] = await Promise.all([
    prisma.curriculum.count({ where: { primarySourceId: sourceId } }),
    prisma.subjectSource.count({ where: { sourceId } }),
  ]);
  return primaryCount > 0 || subjectSourceCount > 0;
}

// ---------------------------------------------------------------------------
// Teaching profile detection
// ---------------------------------------------------------------------------

interface TeachingProfileInfo {
  teachingProfile: string | null;
  subjectId: string | null;
}

async function getTeachingProfileForSource(
  sourceId: string,
  subjectSourceId?: string,
): Promise<TeachingProfileInfo> {
  // Fast path: use the provided subjectSourceId
  if (subjectSourceId) {
    const ss = await prisma.subjectSource.findUnique({
      where: { id: subjectSourceId },
      select: { subject: { select: { id: true, teachingProfile: true } } },
    });
    if (ss?.subject) {
      return { teachingProfile: ss.subject.teachingProfile, subjectId: ss.subject.id };
    }
  }

  // Fallback: find any subject linked to this source
  const ss = await prisma.subjectSource.findFirst({
    where: { sourceId },
    select: { subject: { select: { id: true, teachingProfile: true } } },
  });
  return {
    teachingProfile: ss?.subject?.teachingProfile ?? null,
    subjectId: ss?.subject?.id ?? null,
  };
}

// ---------------------------------------------------------------------------
// Fetch TUTOR_QUESTIONs for a subject (from sibling QUESTION_BANK sources)
// ---------------------------------------------------------------------------

interface TutorQuestionData {
  questionText: string;
  skillRef: string | null;
  bloomLevel: string | null;
  metadata: Record<string, unknown> | null;
}

async function fetchTutorQuestionsForSubject(
  subjectId: string,
): Promise<TutorQuestionData[]> {
  // Find QUESTION_BANK sources linked to this subject
  const qbSources = await prisma.subjectSource.findMany({
    where: {
      subjectId,
      source: { documentType: "QUESTION_BANK" },
    },
    select: { sourceId: true },
  });

  if (qbSources.length === 0) return [];

  return prisma.contentQuestion.findMany({
    where: {
      sourceId: { in: qbSources.map((s) => s.sourceId) },
      questionType: "TUTOR_QUESTION",
    },
    select: {
      questionText: true,
      skillRef: true,
      bloomLevel: true,
      metadata: true,
    },
    orderBy: { sortOrder: "asc" },
    take: 50,
  }) as Promise<TutorQuestionData[]>;
}

// ---------------------------------------------------------------------------
// Comprehension MCQ prompt (generates MCQs from TUTOR_QUESTIONs)
// ---------------------------------------------------------------------------

function buildComprehensionPrompt(
  tutorQuestions: TutorQuestionData[],
  count: number,
): { systemPrompt: string; userContent: string } {
  const mcqCount = Math.max(1, count - 2);
  const tfCount = Math.min(3, count - mcqCount);

  const systemPrompt = `You are converting tutor reference questions into student-facing assessment items for an educational platform.

You are given open-ended comprehension questions that a tutor would ask, along with model responses at different proficiency tiers (Emerging = weak, Developing = partial, Secure = strong). Your job is to convert these into ${mcqCount} multiple-choice (MCQ) and ${tfCount} true/false (TRUE_FALSE) questions.

CONVERSION STRATEGY:
- Use the SECURE tier response as the basis for the CORRECT answer
- Use the EMERGING tier response as the basis for a plausible DISTRACTOR (common misconception)
- Generate 2 additional distractors that are plausible but clearly wrong
- The question should test the same comprehension SKILL as the original tutor question
- Preserve the bloom cognitive level (REMEMBER, UNDERSTAND, ANALYZE, EVALUATE)

MCQ rules:
- Each MCQ must have exactly 4 options labeled A, B, C, D
- Exactly one option must be correct
- Distractors should be plausible but clearly wrong

TRUE_FALSE rules:
- Each TRUE_FALSE is a clear statement that is definitively true or false
- Options are exactly: [{ "label": "True", "text": "True" }, { "label": "False", "text": "False" }]
- correctAnswer is "True" or "False"

General rules:
- Questions must test COMPREHENSION SKILLS (inference, vocabulary, analysis), not factual recall
- Spread across different skills — don't cluster on one skill
- Keep questions clear and concise
- Include a brief 1-sentence explanation for the correct answer
- Include the bloomLevel and skillRef from the source question

NEVER generate questions about:
- Assessment frameworks, rubrics, or skill levels (e.g. "Emerging", "Developing", "Secure")
- The structure or design of the curriculum itself
- How students are assessed or graded
- Internal skill codes (e.g. SKILL-01, SKILL-02)
Questions must test the SUBJECT MATTER through comprehension skills.

Return ONLY a JSON array:
[{
  "questionType": "MCQ",
  "question": "Based on the passage, what best describes...?",
  "bloomLevel": "UNDERSTAND",
  "skillRef": "SKILL-02:Inference",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false },
    { "label": "D", "text": "...", "isCorrect": false }
  ],
  "correctAnswer": "B",
  "chapter": "Inference",
  "explanation": "Brief explanation"
}]`;

  // Build user content from TUTOR_QUESTIONs
  const lines = tutorQuestions.map((tq, i) => {
    const meta = tq.metadata as {
      modelResponses?: Record<string, { response: string; tutorMove: string }>;
      assessmentNote?: string;
      textReference?: string;
    } | null;

    const skillLabel = tq.skillRef?.replace(/^SKILL-\d+:/, "") || "General";
    const parts = [`TUTOR_QUESTION ${i + 1} [${tq.skillRef || "General"}] (bloom: ${tq.bloomLevel || "UNDERSTAND"}):`];
    parts.push(`Question: "${tq.questionText}"`);

    if (meta?.textReference) parts.push(`Text reference: ${meta.textReference}`);
    if (meta?.assessmentNote) parts.push(`Tests: ${meta.assessmentNote}`);

    if (meta?.modelResponses) {
      if (meta.modelResponses.secure?.response) {
        parts.push(`Secure response: "${meta.modelResponses.secure.response}"`);
      }
      if (meta.modelResponses.developing?.response) {
        parts.push(`Developing response: "${meta.modelResponses.developing.response}"`);
      }
      if (meta.modelResponses.emerging?.response) {
        parts.push(`Emerging response: "${meta.modelResponses.emerging.response}"`);
      }
    }

    return parts.join("\n  ");
  });

  return {
    systemPrompt,
    userContent: `Convert these tutor questions into ${count} student-facing assessment items (${mcqCount} MCQ + ${tfCount} TRUE_FALSE).\nSpread across different skills.\n\n${lines.join("\n\n")}`,
  };
}

// ---------------------------------------------------------------------------
// Default bloom-distributed MCQ prompt (for non-comprehension courses)
// ---------------------------------------------------------------------------

function buildBloomDistributedPrompt(
  assertionText: string,
  count: number,
): string {
  const rememberCount = Math.max(1, Math.floor(count * 0.25));
  const understandCount = Math.max(1, Math.floor(count * 0.25));
  const applyCount = Math.max(1, Math.floor(count * 0.25));
  const analyzeCount = Math.max(0, count - rememberCount - understandCount - applyCount);

  return `You are an assessment question generator for an educational platform.
Given a list of content assertions (facts/concepts from course materials), generate a mix of questions spread across cognitive levels.

Generate exactly ${count} questions with this bloom distribution:
- ${rememberCount} at REMEMBER level (recall, define, identify)
- ${understandCount} at UNDERSTAND level (explain, describe, interpret)
- ${applyCount} at APPLY level (use in context, calculate, demonstrate)
- ${analyzeCount} at ANALYZE level (compare, contrast, evaluate)

Each question can be MCQ (4 options A/B/C/D, one correct) or TRUE_FALSE.
Aim for roughly 75% MCQ and 25% TRUE_FALSE.

MCQ rules:
- Each MCQ must have exactly 4 options labeled A, B, C, D
- Exactly one option must be correct
- Distractors should be plausible but clearly wrong

TRUE_FALSE rules:
- Each TRUE_FALSE is a clear statement that is definitively true or false
- Options are exactly: [{ "label": "True", "text": "True" }, { "label": "False", "text": "False" }]
- correctAnswer is "True" or "False"
- Avoid trivially obvious statements — make the student think

General rules:
- REMEMBER questions test recall of specific facts
- UNDERSTAND questions test whether the student can explain or interpret
- APPLY questions test whether the student can use knowledge in a scenario
- ANALYZE questions test whether the student can compare, evaluate, or reason
- Spread across different topics/chapters
- Include a brief 1-sentence explanation for the correct answer

NEVER generate questions about:
- Assessment frameworks, rubrics, or skill levels (e.g. "Emerging", "Developing", "Secure")
- The structure or design of the curriculum itself
- How students are assessed or graded
- Internal skill codes (e.g. SKILL-01, SKILL-02)
Questions must test the SUBJECT MATTER, not knowledge of the teaching system.

Return ONLY a JSON array:
[{
  "questionType": "MCQ",
  "question": "What is...?",
  "bloomLevel": "REMEMBER",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false },
    { "label": "D", "text": "...", "isCorrect": false }
  ],
  "correctAnswer": "B",
  "chapter": "optional chapter reference",
  "explanation": "Brief explanation"
}]`;
}

// ---------------------------------------------------------------------------
// Generate MCQs from assertions or TUTOR_QUESTIONs
// ---------------------------------------------------------------------------

/** Document types that should never generate student-facing MCQs */
const MCQ_EXCLUDED_DOC_TYPES = new Set([
  "COURSE_REFERENCE",  // Teacher guide — instructions, not student content
  "QUESTION_BANK",     // Already has TUTOR_QUESTION items
]);

export async function generateMcqsForSource(
  sourceId: string,
  options?: { count?: number; userId?: string; subjectSourceId?: string },
): Promise<GenerateMcqsResult> {
  const count = options?.count ?? DEFAULT_COUNT;

  // Skip teacher guides and question banks — they aren't student content
  const source = await prisma.contentSource.findUnique({
    where: { id: sourceId },
    select: { documentType: true },
  });
  if (source?.documentType && MCQ_EXCLUDED_DOC_TYPES.has(source.documentType)) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "excluded_doc_type" };
  }

  // Detect teaching profile for bloom-aware generation
  const { teachingProfile, subjectId } = await getTeachingProfileForSource(
    sourceId,
    options?.subjectSourceId,
  );
  const isComprehension = teachingProfile === "comprehension-led";

  // Comprehension path: try to generate from TUTOR_QUESTIONs first
  if (isComprehension && subjectId) {
    const tutorQuestions = await fetchTutorQuestionsForSubject(subjectId);
    if (tutorQuestions.length >= 3) {
      return generateFromTutorQuestions(sourceId, tutorQuestions, count, options);
    }
    // Fall through to assertion-based path if too few TUTOR_QUESTIONs
  }

  // Default path: generate from assertions (bloom-distributed)
  return generateFromAssertions(sourceId, count, options, isComprehension ? "comprehension" : "assertion");
}

// ---------------------------------------------------------------------------
// Comprehension path: TUTOR_QUESTION → MCQ
// ---------------------------------------------------------------------------

async function generateFromTutorQuestions(
  sourceId: string,
  tutorQuestions: TutorQuestionData[],
  count: number,
  options?: { userId?: string; subjectSourceId?: string },
): Promise<GenerateMcqsResult> {
  const { systemPrompt, userContent } = buildComprehensionPrompt(tutorQuestions, count);

  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint: COMPREHENSION_CALL_POINT,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    },
    { userId: options?.userId, sourceOp: COMPREHENSION_CALL_POINT },
  );

  if (!result.content) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "ai_no_response" };
  }

  return parseAndSaveMcqs(sourceId, result.content, options, "comprehension");
}

// ---------------------------------------------------------------------------
// Default path: Assertion → MCQ (bloom-distributed)
// ---------------------------------------------------------------------------

async function generateFromAssertions(
  sourceId: string,
  count: number,
  options?: { userId?: string; subjectSourceId?: string },
  source: "comprehension" | "assertion" = "assertion",
): Promise<GenerateMcqsResult> {
  // Load assertions for this source (scoped by subjectSourceId when available)
  const assertionSelect = {
    id: true,
    assertion: true,
    category: true,
    chapter: true,
    section: true,
  } as const;

  let assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId,
      category: { notIn: [...INSTRUCTION_CATEGORIES] },
      ...(options?.subjectSourceId ? { subjectSourceId: options.subjectSourceId } : {}),
    },
    select: assertionSelect,
    orderBy: { createdAt: "asc" },
    take: 100,
  });

  // Fallback: if scoped query found too few, retry without subject scope
  if (assertions.length < 3 && options?.subjectSourceId) {
    assertions = await prisma.contentAssertion.findMany({
      where: { sourceId, category: { notIn: [...INSTRUCTION_CATEGORIES] } },
      select: assertionSelect,
      orderBy: { createdAt: "asc" },
      take: 100,
    });
  }

  if (assertions.length < 3) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "too_few_assertions" };
  }

  // Build assertion summary for prompt
  const assertionText = assertions
    .map((a, i) => `${i + 1}. [${a.category}] ${a.assertion}${a.chapter ? ` (${a.chapter})` : ""}`)
    .join("\n");

  const systemPrompt = buildBloomDistributedPrompt(assertionText, count);

  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint: CALL_POINT,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Content assertions:\n\n${assertionText}` },
      ],
    },
    { userId: options?.userId, sourceOp: CALL_POINT },
  );

  if (!result.content) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "ai_no_response" };
  }

  return parseAndSaveMcqs(sourceId, result.content, options, source);
}

// ---------------------------------------------------------------------------
// Shared: Parse AI response and save
// ---------------------------------------------------------------------------

async function parseAndSaveMcqs(
  sourceId: string,
  aiContent: string,
  options?: { userId?: string; subjectSourceId?: string },
  source: "comprehension" | "assertion" = "assertion",
): Promise<GenerateMcqsResult> {
  let mcqs: GeneratedMcq[];
  try {
    const cleaned = aiContent.replace(/```json\n?|\n?```/g, "").trim();
    mcqs = JSON.parse(jsonrepair(cleaned));
  } catch {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "ai_parse_error" };
  }

  if (!Array.isArray(mcqs) || mcqs.length === 0) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "ai_empty_response" };
  }

  // Convert to ExtractedQuestion format
  const questions: ExtractedQuestion[] = mcqs
    .filter((m) => m.question && m.options?.length >= 2 && m.correctAnswer)
    .map((m) => {
      const qType = m.questionType === "TRUE_FALSE" ? "TRUE_FALSE" as const : "MCQ" as const;
      const bloomLevel = normalizeBloomLevel(m.bloomLevel);
      return {
        questionText: m.question,
        questionType: qType,
        options: m.options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: o.isCorrect,
        })),
        correctAnswer: m.correctAnswer,
        answerExplanation: m.explanation,
        chapter: source === "comprehension"
          ? (m.skillRef?.replace(/^SKILL-\d+:/, "") || m.chapter)
          : m.chapter,
        skillRef: m.skillRef,
        bloomLevel,
        assessmentUse: source === "comprehension" ? "POST_TEST" as const : "BOTH" as const,
        tags: ["auto-generated", source === "comprehension" ? "comprehension-skill" : "bloom-distributed"],
        contentHash: createHash("sha256")
          .update(`${source}-${qType.toLowerCase()}:${m.question}:${m.correctAnswer}`)
          .digest("hex")
          .slice(0, 16),
      };
    });

  // Filter out questions that leak framework/rubric language
  const cleanQuestions = questions.filter((q) => {
    const blocked = FRAMEWORK_BLOCKLIST.some((re) => re.test(q.questionText));
    if (blocked) {
      console.warn(`[generate-mcqs] Dropped framework-language question: "${q.questionText.slice(0, 80)}..."`);
    }
    return !blocked;
  });

  if (cleanQuestions.length === 0) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "no_valid_mcqs" };
  }

  const saveResult = await saveQuestions(sourceId, cleanQuestions, options?.subjectSourceId);

  const dropped = questions.length - cleanQuestions.length;
  console.log(
    `[generate-mcqs] Source ${sourceId} (${source}): generated ${questions.length}, saved ${saveResult.created}, dupes ${saveResult.duplicatesSkipped}${dropped > 0 ? `, blocked ${dropped} framework-language` : ""}`,
  );

  return {
    created: saveResult.created,
    duplicatesSkipped: saveResult.duplicatesSkipped,
    skipped: false,
  };
}

// ---------------------------------------------------------------------------
// Re-trigger MCQs for sibling sources when a QUESTION_BANK is extracted
// ---------------------------------------------------------------------------

/**
 * When a QUESTION_BANK finishes extraction, regenerate MCQs for sibling
 * content sources in the same subject. This lets the comprehension path
 * use the newly-available TUTOR_QUESTIONs as source material.
 */
export async function regenerateSiblingMcqs(
  subjectId: string,
  questionBankSourceId: string,
  userId?: string,
): Promise<void> {
  // Find sibling content sources (not QB, not COURSE_REFERENCE)
  const siblings = await prisma.subjectSource.findMany({
    where: {
      subjectId,
      source: {
        documentType: { notIn: ["QUESTION_BANK", "COURSE_REFERENCE"] },
      },
    },
    select: { id: true, sourceId: true },
  });

  if (siblings.length === 0) return;

  console.log(
    `[generate-mcqs] QB ${questionBankSourceId} extracted — regenerating MCQs for ${siblings.length} sibling source(s)`,
  );

  for (const sibling of siblings) {
    // Delete existing auto-generated MCQs for this source
    await prisma.contentQuestion.deleteMany({
      where: {
        sourceId: sibling.sourceId,
        questionType: { in: ["MCQ", "TRUE_FALSE"] },
        tags: { hasSome: ["auto-generated"] },
      },
    });

    // Regenerate with comprehension path now available
    await generateMcqsForSource(sibling.sourceId, {
      userId,
      subjectSourceId: sibling.id,
    });
  }
}

// ---------------------------------------------------------------------------
// Post-extraction hook — called after extraction completes
// ---------------------------------------------------------------------------

/**
 * Check if a source needs MCQ generation and run it if so.
 * Non-blocking — intended to be called with .catch() in fire-and-forget style.
 */
export async function maybeGenerateMcqs(
  sourceId: string,
  userId?: string,
  subjectSourceId?: string,
): Promise<void> {
  const [needsMcqs, linked] = await Promise.all([
    sourceNeedsMcqs(sourceId),
    isLinkedSource(sourceId),
  ]);

  if (!needsMcqs || !linked) return;

  console.log(`[generate-mcqs] Source ${sourceId} is linked source with 0 MCQs — auto-generating`);
  await generateMcqsForSource(sourceId, { userId, subjectSourceId });
}
