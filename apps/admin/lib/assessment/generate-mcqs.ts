/**
 * MCQ Auto-Generation — synthesises MCQ questions from ContentAssertion rows
 * when document extraction didn't produce any.
 *
 * Triggered after extraction completes for a primarySource with 0 MCQs.
 * Uses assertions as the knowledge base, asks AI to generate MCQs with distractors.
 */

import { prisma } from "@/lib/prisma";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { saveQuestions } from "@/lib/content-trust/save-questions";
import type { ExtractedQuestion } from "@/lib/content-trust/extractors/base-extractor";
import { createHash } from "crypto";
import { jsonrepair } from "jsonrepair";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_COUNT = 8;
const CALL_POINT = "content-trust.generate-mcq";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedMcq {
  question: string;
  questionType?: "MCQ" | "TRUE_FALSE";
  options: { label: string; text: string; isCorrect: boolean }[];
  correctAnswer: string;
  chapter?: string;
  explanation?: string;
}

export interface GenerateMcqsResult {
  created: number;
  duplicatesSkipped: number;
  skipped: boolean;
  skipReason?: string;
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
// Generate MCQs from assertions
// ---------------------------------------------------------------------------

export async function generateMcqsForSource(
  sourceId: string,
  options?: { count?: number; userId?: string; subjectSourceId?: string },
): Promise<GenerateMcqsResult> {
  const count = options?.count ?? DEFAULT_COUNT;

  // Load assertions for this source (scoped by subjectSourceId when available)
  const assertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId,
      ...(options?.subjectSourceId ? { subjectSourceId: options.subjectSourceId } : {}),
    },
    select: {
      id: true,
      claim: true,
      category: true,
      chapter: true,
      section: true,
    },
    orderBy: { sortOrder: "asc" },
    take: 100, // Cap to avoid huge prompts
  });

  if (assertions.length < 3) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "too_few_assertions" };
  }

  // Build assertion summary for prompt
  const assertionText = assertions
    .map((a, i) => `${i + 1}. [${a.category}] ${a.claim}${a.chapter ? ` (${a.chapter})` : ""}`)
    .join("\n");

  const mcqCount = Math.max(1, count - 2);
  const tfCount = Math.min(3, count - mcqCount);

  const systemPrompt = `You are an assessment question generator for an educational platform.
Given a list of content assertions (facts/concepts from course materials), generate a mix of questions: ${mcqCount} multiple-choice (MCQ) and ${tfCount} true/false (TRUE_FALSE).

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
- Questions should test understanding, not just recall
- Spread across different topics/chapters
- Keep questions clear and concise
- Include a brief 1-sentence explanation for the correct answer

Return ONLY a JSON array of objects:
[{
  "questionType": "MCQ",
  "question": "What is...?",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false },
    { "label": "D", "text": "...", "isCorrect": false }
  ],
  "correctAnswer": "B",
  "chapter": "optional chapter reference",
  "explanation": "Brief explanation"
},
{
  "questionType": "TRUE_FALSE",
  "question": "Photosynthesis converts sunlight into chemical energy.",
  "options": [
    { "label": "True", "text": "True", "isCorrect": true },
    { "label": "False", "text": "False", "isCorrect": false }
  ],
  "correctAnswer": "True",
  "chapter": "Chapter 2",
  "explanation": "Plants use chlorophyll to convert light energy during photosynthesis."
}]`;

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

  // Parse AI response
  let mcqs: GeneratedMcq[];
  try {
    const cleaned = result.content.replace(/```json\n?|\n?```/g, "").trim();
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
        chapter: m.chapter,
        tags: ["auto-generated"],
        contentHash: createHash("sha256")
          .update(`${qType.toLowerCase()}:${m.question}:${m.correctAnswer}`)
          .digest("hex")
          .slice(0, 16),
      };
    });

  if (questions.length === 0) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "no_valid_mcqs" };
  }

  const saveResult = await saveQuestions(sourceId, questions, options?.subjectSourceId);

  console.log(
    `[generate-mcqs] Source ${sourceId}: generated ${questions.length}, saved ${saveResult.created}, dupes ${saveResult.duplicatesSkipped}`,
  );

  return {
    created: saveResult.created,
    duplicatesSkipped: saveResult.duplicatesSkipped,
    skipped: false,
  };
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
