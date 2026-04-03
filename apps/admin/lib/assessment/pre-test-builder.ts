/**
 * Pre-test question sourcing — selects MCQ questions from curriculum content
 * for baseline knowledge assessment. Questions are stored by ID so the post-test
 * can mirror the exact same set for uplift comparison.
 */

import { prisma } from "@/lib/prisma";
import { config } from "@/lib/config";
import { ContractRegistry } from "@/lib/contracts/registry";
import type { SurveyStepConfig } from "@/lib/types/json-fields";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ContentQuestionRow {
  id: string;
  questionText: string;
  questionType: string;
  options: unknown;
  correctAnswer: string | null;
  answerExplanation: string | null;
  chapter: string | null;
  section: string | null;
  learningOutcomeRef: string | null;
  difficulty: number | null;
}

interface McqOption {
  label: string;
  text: string;
  isCorrect?: boolean;
}

interface AssessmentConfig {
  questionCount: number;
  selectionStrategy: string;
  questionTypes: string[];
}

// ---------------------------------------------------------------------------
// Default config (from contract fallback)
// ---------------------------------------------------------------------------

const DEFAULT_CONFIG: AssessmentConfig = {
  questionCount: 5,
  selectionStrategy: "one_per_module",
  questionTypes: ["MCQ", "TRUE_FALSE"],
};

// ---------------------------------------------------------------------------
// Load assessment config from contract
// ---------------------------------------------------------------------------

async function getAssessmentConfig(): Promise<AssessmentConfig> {
  try {
    const contract = await ContractRegistry.getContract(config.specs.onboardingAssessment);
    const preTest = contract?.config?.phases?.pre_test;
    if (preTest) {
      return {
        questionCount: preTest.questionCount ?? DEFAULT_CONFIG.questionCount,
        selectionStrategy: preTest.selectionStrategy ?? DEFAULT_CONFIG.selectionStrategy,
        questionTypes: preTest.questionTypes ?? DEFAULT_CONFIG.questionTypes,
      };
    }
  } catch {
    // Fall through to default
  }
  return DEFAULT_CONFIG;
}

// ---------------------------------------------------------------------------
// Resolve curriculum's primary content source
// ---------------------------------------------------------------------------

async function getPrimarySourceId(curriculumId: string): Promise<string | null> {
  const curriculum = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: { primarySourceId: true, subjectId: true },
  });
  if (!curriculum) return null;

  // Direct FK is the fast path
  if (curriculum.primarySourceId) return curriculum.primarySourceId;

  // Fallback: find the first source linked to the curriculum's subject
  if (curriculum.subjectId) {
    const subjectSource = await prisma.subjectSource.findFirst({
      where: { subjectId: curriculum.subjectId },
      select: { sourceId: true },
      orderBy: { createdAt: "asc" },
    });
    return subjectSource?.sourceId ?? null;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Fetch questions from content source
// ---------------------------------------------------------------------------

async function fetchQuestions(
  sourceId: string,
  questionTypes: string[],
): Promise<ContentQuestionRow[]> {
  return prisma.contentQuestion.findMany({
    where: {
      sourceId,
      questionType: { in: questionTypes as any },
    },
    select: {
      id: true,
      questionText: true,
      questionType: true,
      options: true,
      correctAnswer: true,
      answerExplanation: true,
      chapter: true,
      section: true,
      learningOutcomeRef: true,
      difficulty: true,
    },
    orderBy: { sortOrder: "asc" },
  });
}

// ---------------------------------------------------------------------------
// Selection strategies
// ---------------------------------------------------------------------------

function selectOnePerModule(
  questions: ContentQuestionRow[],
  count: number,
): ContentQuestionRow[] {
  // Group by chapter (module proxy)
  const byChapter = new Map<string, ContentQuestionRow[]>();
  for (const q of questions) {
    const key = q.chapter ?? q.section ?? "_ungrouped";
    const group = byChapter.get(key) ?? [];
    group.push(q);
    byChapter.set(key, group);
  }

  const selected: ContentQuestionRow[] = [];
  const chapters = [...byChapter.keys()];

  // Round-robin pick one from each chapter until we hit count
  let round = 0;
  while (selected.length < count && round < 10) {
    for (const chapter of chapters) {
      if (selected.length >= count) break;
      const group = byChapter.get(chapter)!;
      if (round < group.length) {
        selected.push(group[round]);
      }
    }
    round++;
  }

  return selected;
}

function selectRandom(
  questions: ContentQuestionRow[],
  count: number,
): ContentQuestionRow[] {
  const shuffled = [...questions].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// ---------------------------------------------------------------------------
// Convert ContentQuestion → SurveyStepConfig
// ---------------------------------------------------------------------------

function toSurveyStep(q: ContentQuestionRow): SurveyStepConfig | null {
  const rawOptions = q.options as McqOption[] | null;
  if (!rawOptions || !Array.isArray(rawOptions) || rawOptions.length < 2) return null;

  // Find the correct answer — either from the isCorrect flag or correctAnswer field
  let correctValue: string | undefined;
  const options = rawOptions.map((opt) => {
    const value = opt.label; // "A", "B", "C", "D"
    if (opt.isCorrect) correctValue = value;
    return { value, label: `${opt.label}. ${opt.text}` };
  });

  // Fallback: match correctAnswer field against option labels
  if (!correctValue && q.correctAnswer) {
    const match = rawOptions.find(
      (opt) => opt.label === q.correctAnswer || opt.text === q.correctAnswer,
    );
    if (match) correctValue = match.label;
  }

  if (!correctValue) return null;

  return {
    id: q.id,
    type: q.questionType === "TRUE_FALSE" ? "true_false" as const : "mcq" as const,
    prompt: q.questionText,
    options,
    correctAnswer: correctValue,
    explanation: q.answerExplanation ?? undefined,
    chapter: q.chapter ?? undefined,
    contentQuestionId: q.id,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PreTestResult {
  questions: SurveyStepConfig[];
  questionIds: string[];
  skipped: boolean;
  skipReason?: string;
  sourceId?: string;
}

/**
 * Build a pre-test question set for a given curriculum.
 * Returns questions as SurveyStepConfig[] ready for ChatSurvey rendering.
 */
export async function buildPreTest(curriculumId: string): Promise<PreTestResult> {
  const assessmentCfg = await getAssessmentConfig();

  const sourceId = await getPrimarySourceId(curriculumId);
  if (!sourceId) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_content_source" };
  }

  const allQuestions = await fetchQuestions(sourceId, assessmentCfg.questionTypes);
  if (allQuestions.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_questions", sourceId };
  }

  // Apply selection strategy
  const selected =
    assessmentCfg.selectionStrategy === "one_per_module"
      ? selectOnePerModule(allQuestions, assessmentCfg.questionCount)
      : selectRandom(allQuestions, assessmentCfg.questionCount);

  // Convert to SurveyStepConfig
  const steps = selected.map(toSurveyStep).filter((s): s is SurveyStepConfig => s !== null);

  if (steps.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_valid_mcq" };
  }

  return {
    questions: steps,
    questionIds: steps.map((s) => s.id),
    skipped: false,
    sourceId,
  };
}

/**
 * Build a post-test by mirroring the pre-test questions.
 * Reads the stored question IDs from CallerAttribute and fetches the same questions.
 */
export async function buildPostTest(callerId: string): Promise<PreTestResult> {
  // Read stored pre-test question IDs
  const questionIdsAttr = await prisma.callerAttribute.findFirst({
    where: { callerId, scope: "PRE_TEST", key: "question_ids" },
    select: { jsonValue: true },
  });

  const questionIds = questionIdsAttr?.jsonValue as string[] | null;
  if (!questionIds || questionIds.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_pre_test" };
  }

  // Fetch the exact same questions
  const questions = await prisma.contentQuestion.findMany({
    where: { id: { in: questionIds } },
    select: {
      id: true,
      questionText: true,
      questionType: true,
      options: true,
      correctAnswer: true,
      answerExplanation: true,
      chapter: true,
      section: true,
      learningOutcomeRef: true,
      difficulty: true,
    },
  });

  // Preserve original order
  const byId = new Map(questions.map((q) => [q.id, q]));
  const ordered = questionIds.map((id) => byId.get(id)).filter((q): q is ContentQuestionRow => !!q);

  const steps = ordered.map(toSurveyStep).filter((s): s is SurveyStepConfig => s !== null);

  return {
    questions: steps,
    questionIds: steps.map((s) => s.id),
    skipped: steps.length === 0,
    skipReason: steps.length === 0 ? "questions_deleted" : undefined,
  };
}
