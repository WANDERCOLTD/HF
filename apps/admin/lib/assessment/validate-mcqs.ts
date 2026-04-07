/**
 * MCQ Validation Pass — hybrid deterministic + AI quality review
 *
 * Runs after MCQ generation, before persistence. Catches structural
 * quality issues that the generation prompt alone can't guarantee.
 *
 * Two layers:
 * 1. Deterministic checks (always run, can reject questions)
 *    - Option length disparity (correct answer giveaway)
 *    - Distractor similarity (too-similar pairs)
 *    - Missing distractorType on incorrect options
 * 2. AI review (optional, flags issues but never auto-applies fixes)
 *    - Arguably-correct distractors
 *    - Reading level mismatch
 *    - Replacement suggestions (logged only, not written to DB)
 *
 * Follows validateManifest pattern: pure function, returns { validated, issues }.
 */

import type { ExtractedQuestion, DistractorType } from "@/lib/content-trust/extractors/base-extractor";
import { VALID_DISTRACTOR_TYPES } from "@/lib/content-trust/extractors/base-extractor";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { jsonrepair } from "jsonrepair";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type McqIssueSeverity = "error" | "warning" | "info";

export interface McqIssue {
  questionIndex: number;
  questionText: string;
  severity: McqIssueSeverity;
  check: string;
  message: string;
  suggestion?: string;
}

export interface McqValidationResult {
  /** Questions that passed all error-level checks */
  validated: ExtractedQuestion[];
  /** All issues found (errors, warnings, info) */
  issues: McqIssue[];
  /** Questions rejected by error-level checks */
  rejected: number;
  /** Whether AI review was run */
  aiReviewRun: boolean;
}

const VALIDATE_CALL_POINT = "content-trust.validate-mcq";

// ---------------------------------------------------------------------------
// Deterministic checks
// ---------------------------------------------------------------------------

/**
 * Check if the correct answer is significantly longer than distractors.
 * Common giveaway: correct answer has more detail/qualifications.
 */
function checkOptionLengthDisparity(q: ExtractedQuestion, idx: number): McqIssue[] {
  const issues: McqIssue[] = [];
  if (!q.options || q.options.length < 3) return issues;

  const correctOpts = q.options.filter((o) => o.isCorrect);
  const incorrectOpts = q.options.filter((o) => !o.isCorrect);

  if (correctOpts.length !== 1 || incorrectOpts.length === 0) return issues;

  const correctLen = correctOpts[0].text.length;
  const avgIncorrectLen = incorrectOpts.reduce((sum, o) => sum + o.text.length, 0) / incorrectOpts.length;

  // Flag if correct answer is >1.8x the average distractor length
  if (correctLen > avgIncorrectLen * 1.8 && correctLen - avgIncorrectLen > 20) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "warning",
      check: "option_length_disparity",
      message: `Correct answer (${correctLen} chars) is significantly longer than average distractor (${Math.round(avgIncorrectLen)} chars) — may give away the answer`,
    });
  }

  // Also flag if correct answer is much shorter (rare but can happen)
  if (correctLen < avgIncorrectLen * 0.4 && avgIncorrectLen - correctLen > 20) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "warning",
      check: "option_length_disparity",
      message: `Correct answer (${correctLen} chars) is significantly shorter than average distractor (${Math.round(avgIncorrectLen)} chars) — may give away the answer`,
    });
  }

  return issues;
}

/**
 * Check for distractor pairs that are too similar (using character overlap).
 * If two distractors are nearly identical, one provides no diagnostic value.
 */
function checkDistractorSimilarity(q: ExtractedQuestion, idx: number): McqIssue[] {
  const issues: McqIssue[] = [];
  if (!q.options || q.options.length < 3) return issues;

  const incorrectOpts = q.options.filter((o) => !o.isCorrect);

  for (let i = 0; i < incorrectOpts.length; i++) {
    for (let j = i + 1; j < incorrectOpts.length; j++) {
      const similarity = computeWordOverlap(incorrectOpts[i].text, incorrectOpts[j].text);
      if (similarity > 0.8) {
        issues.push({
          questionIndex: idx,
          questionText: q.questionText,
          severity: "warning",
          check: "distractor_similarity",
          message: `Distractors "${incorrectOpts[i].label}" and "${incorrectOpts[j].label}" are very similar (${Math.round(similarity * 100)}% word overlap) — reduces diagnostic value`,
        });
      }
    }
  }

  return issues;
}

/** Word-level Jaccard similarity */
function computeWordOverlap(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;

  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Check that all incorrect MCQ options have a valid distractorType.
 * Missing types get backfilled (not rejected), but flagged as info.
 */
function checkDistractorTypes(q: ExtractedQuestion, idx: number): McqIssue[] {
  const issues: McqIssue[] = [];
  if (!q.options || q.questionType === "TRUE_FALSE") return issues;

  const incorrectOpts = q.options.filter((o) => !o.isCorrect);
  const missingType = incorrectOpts.filter((o) => !o.distractorType);

  if (missingType.length > 0) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "info",
      check: "missing_distractor_type",
      message: `${missingType.length} distractor(s) missing distractorType — backfilled as "surface_lure"`,
    });

    // Backfill missing types
    for (const opt of missingType) {
      opt.distractorType = "surface_lure" as DistractorType;
    }
  }

  // Check for invalid types (shouldn't happen after upstream guard, but defense in depth)
  const invalidType = incorrectOpts.filter((o) => o.distractorType && !VALID_DISTRACTOR_TYPES.has(o.distractorType as DistractorType));
  if (invalidType.length > 0) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "info",
      check: "invalid_distractor_type",
      message: `${invalidType.length} distractor(s) had invalid distractorType — corrected to "surface_lure"`,
    });
    for (const opt of invalidType) {
      opt.distractorType = "surface_lure" as DistractorType;
    }
  }

  return issues;
}

/**
 * Check that MCQ has exactly one correct answer and at least 2 distractors.
 */
function checkStructure(q: ExtractedQuestion, idx: number): McqIssue[] {
  const issues: McqIssue[] = [];
  if (!q.options) return issues;

  const correctCount = q.options.filter((o) => o.isCorrect).length;
  if (correctCount !== 1) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "error",
      check: "incorrect_correct_count",
      message: `Expected exactly 1 correct option, found ${correctCount}`,
    });
  }

  if (q.questionType === "MCQ" && q.options.length < 4) {
    issues.push({
      questionIndex: idx,
      questionText: q.questionText,
      severity: "error",
      check: "too_few_options",
      message: `MCQ has ${q.options.length} options, expected 4`,
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Deterministic validation (always runs)
// ---------------------------------------------------------------------------

/**
 * Run all deterministic checks on a batch of MCQs.
 * Questions with error-severity issues are rejected.
 * Questions with warning/info issues are kept but issues are reported.
 */
export function validateMcqBatch(questions: ExtractedQuestion[]): McqValidationResult {
  const allIssues: McqIssue[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    allIssues.push(
      ...checkStructure(q, i),
      ...checkOptionLengthDisparity(q, i),
      ...checkDistractorSimilarity(q, i),
      ...checkDistractorTypes(q, i),
    );
  }

  // Reject questions with error-level issues
  const errorIndices = new Set(allIssues.filter((i) => i.severity === "error").map((i) => i.questionIndex));
  const validated = questions.filter((_, i) => !errorIndices.has(i));
  const rejected = errorIndices.size;

  if (allIssues.length > 0) {
    const errors = allIssues.filter((i) => i.severity === "error").length;
    const warnings = allIssues.filter((i) => i.severity === "warning").length;
    console.log(`[validate-mcqs] Deterministic: ${questions.length} questions, ${errors} errors (rejected), ${warnings} warnings`);
  }

  return { validated, issues: allIssues, rejected, aiReviewRun: false };
}

// ---------------------------------------------------------------------------
// AI review (optional — flags issues, never auto-applies)
// ---------------------------------------------------------------------------

interface AiReviewIssue {
  questionIndex: number;
  issue: string;
  severity: "warning" | "info";
  suggestion?: string;
}

/**
 * Run AI quality review on validated MCQs.
 * Returns additional issues to append to the validation result.
 * AI suggestions are logged but never auto-applied to DB.
 */
export async function aiReviewMcqs(
  questions: ExtractedQuestion[],
  audienceDescription?: string,
  userId?: string,
): Promise<McqIssue[]> {
  if (questions.length === 0) return [];

  const questionsForReview = questions.slice(0, 12).map((q, i) => ({
    index: i,
    question: q.questionText,
    type: q.questionType,
    bloomLevel: q.bloomLevel,
    options: q.options?.map((o) => ({
      label: o.label,
      text: o.text,
      isCorrect: o.isCorrect,
      distractorType: o.distractorType,
    })),
    correctAnswer: q.correctAnswer,
  }));

  const systemPrompt = `You are a quality reviewer for educational assessment questions. Review each MCQ for these issues:

1. ARGUABLY_CORRECT: Is any distractor arguably correct or ambiguous? (severity: warning)
2. READING_LEVEL: Does the vocabulary/complexity match the target audience? (severity: warning)
3. GIVEAWAY: Does the correct answer give itself away through specificity, hedging language ("sometimes", "may"), or being the only option with qualifications? (severity: warning)
4. WEAK_DISTRACTOR: Is any distractor obviously wrong or implausible to any student? (severity: info)

${audienceDescription ? `TARGET AUDIENCE: ${audienceDescription}` : ""}

For each issue found, return a JSON object. If a question has no issues, omit it.

Return ONLY a JSON array (may be empty):
[{
  "questionIndex": 0,
  "issue": "ARGUABLY_CORRECT",
  "severity": "warning",
  "detail": "Option C could be considered correct because...",
  "suggestion": "Replace with: [better distractor text]"
}]

If all questions pass review, return an empty array: []`;

  try {
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: VALIDATE_CALL_POINT,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(questionsForReview, null, 2) },
        ],
      },
      { userId, sourceOp: VALIDATE_CALL_POINT },
    );

    if (!result.content) return [];

    const cleaned = result.content.replace(/```json\n?|\n?```/g, "").trim();
    const aiIssues: AiReviewIssue[] = JSON.parse(jsonrepair(cleaned));

    if (!Array.isArray(aiIssues)) return [];

    const mapped: McqIssue[] = aiIssues
      .filter((ai) => ai.questionIndex >= 0 && ai.questionIndex < questions.length)
      .map((ai) => ({
        questionIndex: ai.questionIndex,
        questionText: questions[ai.questionIndex].questionText,
        severity: ai.severity === "warning" ? "warning" as const : "info" as const,
        check: `ai_review_${ai.issue?.toLowerCase() || "general"}`,
        message: ai.issue || "AI review flagged an issue",
        // AI suggestions are advisory only — logged, never auto-applied
        suggestion: ai.suggestion,
      }));

    if (mapped.length > 0) {
      console.log(`[validate-mcqs] AI review: flagged ${mapped.length} issue(s) across ${questions.length} questions`);
      for (const issue of mapped) {
        if (issue.suggestion) {
          console.log(`[validate-mcqs] AI suggestion (NOT auto-applied) for Q${issue.questionIndex}: ${issue.suggestion}`);
        }
      }
    }

    return mapped;
  } catch (err) {
    console.warn("[validate-mcqs] AI review failed (non-blocking):", err);
    return [];
  }
}
