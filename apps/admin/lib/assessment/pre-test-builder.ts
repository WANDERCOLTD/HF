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
  bloomLevel: string | null;
  skillRef: string | null;
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
// Resolve content source IDs — curriculum path or playbook-wide search
// ---------------------------------------------------------------------------

async function getSourceIdsForCurriculum(curriculumId: string): Promise<string[]> {
  const curriculum = await prisma.curriculum.findUnique({
    where: { id: curriculumId },
    select: { primarySourceId: true, playbookId: true, subjectId: true },
  });
  if (!curriculum) return [];

  // Direct FK is the fast path
  if (curriculum.primarySourceId) return [curriculum.primarySourceId];

  // Tier 1: PlaybookSource via curriculum.playbookId
  if (curriculum.playbookId) {
    const { getSourceIdsForPlaybook } = await import("@/lib/knowledge/domain-sources");
    const ids = await getSourceIdsForPlaybook(curriculum.playbookId);
    if (ids.length > 0) return ids;
  }

  // Tier 2: Legacy SubjectSource fallback
  if (curriculum.subjectId) {
    const sources = await prisma.subjectSource.findMany({
      where: { subjectId: curriculum.subjectId },
      select: { sourceId: true },
      orderBy: { createdAt: "asc" },
    });
    return sources.map((s) => s.sourceId);
  }

  return [];
}

async function getSourceIdsForPlaybook(playbookId: string): Promise<string[]> {
  // Use central resolution which prefers PlaybookSource
  const { getSourceIdsForPlaybook: resolve } = await import("@/lib/knowledge/domain-sources");
  return resolve(playbookId);
}

// ---------------------------------------------------------------------------
// Fetch questions from content sources
// ---------------------------------------------------------------------------

async function fetchQuestions(
  sourceIds: string[],
  questionTypes: string[],
): Promise<ContentQuestionRow[]> {
  if (sourceIds.length === 0) return [];
  return prisma.contentQuestion.findMany({
    where: {
      sourceId: { in: sourceIds },
      // Filter to requested types, excluding TUTOR_QUESTION (never student-facing)
      questionType: { in: questionTypes.filter((t) => t !== "TUTOR_QUESTION") as any },
      // Exclude POST_TEST-only and TUTOR_ONLY questions from student pre-tests
      assessmentUse: { notIn: ["POST_TEST", "TUTOR_ONLY"] },
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
      bloomLevel: true,
      skillRef: true,
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

/**
 * Top up a partially-filled selection from the unused remainder of the pool.
 * Dedupes by id, random-fills until `target` is reached or the pool is exhausted.
 */
function fillUp(
  selected: ContentQuestionRow[],
  pool: ContentQuestionRow[],
  target: number,
): ContentQuestionRow[] {
  if (selected.length >= target) return selected;
  const usedIds = new Set(selected.map((q) => q.id));
  const remainder = pool.filter((q) => !usedIds.has(q.id));
  const shuffled = [...remainder].sort(() => Math.random() - 0.5);
  return [...selected, ...shuffled.slice(0, target - selected.length)];
}

/**
 * Select questions distributed across Bloom cognitive levels.
 * Prioritises higher-order thinking (UNDERSTAND, ANALYZE) over pure recall.
 */
function selectByBloomSpread(
  questions: ContentQuestionRow[],
  count: number,
): ContentQuestionRow[] {
  const byBloom = new Map<string, ContentQuestionRow[]>();
  for (const q of questions) {
    const key = q.bloomLevel ?? "REMEMBER";
    const group = byBloom.get(key) ?? [];
    group.push(q);
    byBloom.set(key, group);
  }

  // Priority order: UNDERSTAND and ANALYZE first (the most diagnostic),
  // then REMEMBER (baseline), EVALUATE, APPLY, CREATE
  const priority = ["UNDERSTAND", "ANALYZE", "REMEMBER", "EVALUATE", "APPLY", "CREATE"];

  const selected: ContentQuestionRow[] = [];
  let round = 0;

  while (selected.length < count && round < 10) {
    for (const level of priority) {
      if (selected.length >= count) break;
      const group = byBloom.get(level);
      if (group && round < group.length) {
        selected.push(group[round]);
      }
    }
    round++;
  }

  return selected;
}

/**
 * Select questions distributed across comprehension skillRefs.
 * Prioritises one question per skill for balanced coverage.
 */
function selectBySkillSpread(
  questions: ContentQuestionRow[],
  count: number,
): ContentQuestionRow[] {
  const bySkill = new Map<string, ContentQuestionRow[]>();
  for (const q of questions) {
    const key = q.skillRef ?? q.chapter ?? "_ungrouped";
    const group = bySkill.get(key) ?? [];
    group.push(q);
    bySkill.set(key, group);
  }

  const selected: ContentQuestionRow[] = [];
  const skills = [...bySkill.keys()];
  let round = 0;

  while (selected.length < count && round < 10) {
    for (const skill of skills) {
      if (selected.length >= count) break;
      const group = bySkill.get(skill)!;
      if (round < group.length) {
        selected.push(group[round]);
      }
    }
    round++;
  }

  return selected;
}

// ---------------------------------------------------------------------------
// Fetch comprehension questions (POST_TEST eligible)
// ---------------------------------------------------------------------------

async function fetchComprehensionQuestions(
  sourceIds: string[],
  questionTypes: string[],
): Promise<ContentQuestionRow[]> {
  if (sourceIds.length === 0) return [];
  return prisma.contentQuestion.findMany({
    where: {
      sourceId: { in: sourceIds },
      questionType: { in: questionTypes as any },
      // Include POST_TEST and BOTH — these are the comprehension MCQs
      assessmentUse: { in: ["POST_TEST", "BOTH"] },
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
      bloomLevel: true,
      skillRef: true,
    },
    orderBy: { sortOrder: "asc" },
  });
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

export interface BuildPreTestOptions {
  /**
   * When the learner has picked a specific authored module (#302), restrict the
   * pre-test pool to MCQs whose `learningOutcomeRef` is in this set. If the
   * resulting pool is empty, the builder falls back to the full course pool with
   * a server-side warning so the pre-test is never silently skipped.
   */
  lockedOutcomeRefs?: string[];
}

/**
 * Build a pre-test question set for a given curriculum.
 * Returns questions as SurveyStepConfig[] ready for ChatSurvey rendering.
 */
export async function buildPreTest(
  curriculumId: string,
  opts?: BuildPreTestOptions,
): Promise<PreTestResult> {
  return buildFromSourceIds(await getSourceIdsForCurriculum(curriculumId), opts);
}

/**
 * Build a pre-test by searching all subjects linked to a playbook (course).
 * Broader search — finds questions across all content sources in the course.
 */
export async function buildPreTestForPlaybook(
  playbookId: string,
  opts?: BuildPreTestOptions,
): Promise<PreTestResult> {
  return buildFromSourceIds(await getSourceIdsForPlaybook(playbookId), opts);
}

async function buildFromSourceIds(
  sourceIds: string[],
  opts?: BuildPreTestOptions,
): Promise<PreTestResult> {
  if (sourceIds.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_content_source" };
  }

  const assessmentCfg = await getAssessmentConfig();
  const allQuestions = await fetchQuestions(sourceIds, assessmentCfg.questionTypes);
  if (allQuestions.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_questions", sourceId: sourceIds[0] };
  }

  // #302: When a learner has locked a module, restrict the primary pool to
  // questions tagged with that module's outcomesPrimary. Empty match falls back
  // to the full pool (logged) so the pre-test is never silently skipped.
  const lockedRefs = opts?.lockedOutcomeRefs;
  let pool = allQuestions;
  if (lockedRefs && lockedRefs.length > 0) {
    const refSet = new Set(lockedRefs);
    const lockedPool = allQuestions.filter(
      (q) => q.learningOutcomeRef && refSet.has(q.learningOutcomeRef),
    );
    if (lockedPool.length > 0) {
      pool = lockedPool;
    } else {
      console.warn(
        `[pre-test] Locked module pool empty for refs [${lockedRefs.join(", ")}] — falling back to full course pool (${allQuestions.length} MCQs)`,
      );
    }
  }

  const strategy = assessmentCfg.selectionStrategy;

  const primary =
    strategy === "bloom_spread"
      ? selectByBloomSpread(pool, assessmentCfg.questionCount)
      : strategy === "one_per_module"
        ? selectOnePerModule(pool, assessmentCfg.questionCount)
        : selectRandom(pool, assessmentCfg.questionCount);

  // fillUp first from the locked pool, then from the full pool so a thin lock
  // still delivers questionCount questions overall.
  const filledFromLocked = fillUp(primary, pool, assessmentCfg.questionCount);
  const selected = pool === allQuestions
    ? filledFromLocked
    : fillUp(filledFromLocked, allQuestions, assessmentCfg.questionCount);

  // Convert to SurveyStepConfig
  const steps = selected.map(toSurveyStep).filter((s): s is SurveyStepConfig => s !== null);

  if (steps.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_valid_mcq" };
  }

  return {
    questions: steps,
    questionIds: steps.map((s) => s.id),
    skipped: false,
    sourceId: sourceIds[0],
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
      bloomLevel: true,
      skillRef: true,
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

/**
 * Build a comprehension post-test (or mid-test) by querying POST_TEST-tagged MCQs directly.
 * Does NOT depend on pre-test question IDs — comprehension courses skip pre-tests.
 * Selects questions spread across comprehension skillRefs (SKILL-01 through SKILL-06).
 */
export async function buildComprehensionPostTest(playbookId: string): Promise<PreTestResult> {
  const sourceIds = await getSourceIdsForPlaybook(playbookId);
  if (sourceIds.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_content_source" };
  }

  const assessmentCfg = await getAssessmentConfig();
  const allQuestions = await fetchComprehensionQuestions(sourceIds, assessmentCfg.questionTypes);
  if (allQuestions.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_questions", sourceId: sourceIds[0] };
  }

  const primary = selectBySkillSpread(allQuestions, assessmentCfg.questionCount);
  const selected = fillUp(primary, allQuestions, assessmentCfg.questionCount);

  const steps = selected.map(toSurveyStep).filter((s): s is SurveyStepConfig => s !== null);

  if (steps.length === 0) {
    return { questions: [], questionIds: [], skipped: true, skipReason: "no_valid_mcq" };
  }

  return {
    questions: steps,
    questionIds: steps.map((s) => s.id),
    skipped: false,
    sourceId: sourceIds[0],
  };
}
