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
import { VALID_DISTRACTOR_TYPES, type DistractorType } from "@/lib/content-trust/extractors/base-extractor";
import { createHash } from "crypto";
import { jsonrepair } from "jsonrepair";
import { INSTRUCTION_CATEGORIES } from "@/lib/content-trust/resolve-config";
import { validateMcqBatch, aiReviewMcqs } from "./validate-mcqs";
import {
  resolveModuleGroupsForSource,
  computeModuleBudget,
  type ModuleGroup,
} from "./module-groups";

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
  /\b(socratic|teaching\s*approach|teaching\s*method|pedagog)/i,
  /\bwhat does the acronym\b/i,
  /\bwhat does ['"]?\w{1,5}['"]? stand for\b/i,
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GeneratedMcq {
  question: string;
  questionType?: "MCQ" | "TRUE_FALSE";
  bloomLevel?: string;
  options: { label: string; text: string; isCorrect: boolean; distractorType?: string }[];
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
// Audience context from COURSE_REFERENCE structuredContent
// ---------------------------------------------------------------------------

interface AudienceContext {
  studentAge?: string;
  prerequisite?: string;
  subject?: string;
  delivery?: string;
  qualificationLevel?: string;
}

/**
 * Load audience descriptors from the COURSE_REFERENCE linked to a subject.
 *
 * Reads ContentAssertion rows tagged with `co:*` — the PDF-extracted
 * course-reference path via course-ref-to-assertions.ts. An earlier draft
 * of this function also supported a "structuredContent.courseOverview"
 * path for wizard-built references, but that field was never added to
 * the ContentSource schema and produced a Prisma validation error at
 * runtime. The wizard now writes course overview fields into playbook
 * config and/or assertions instead.
 *
 * Returns null when no COURSE_REFERENCE exists for the subject.
 */
async function getAudienceContext(subjectId: string): Promise<AudienceContext | null> {
  const refSource = await prisma.subjectSource.findFirst({
    where: {
      subjectId,
      source: { documentType: "COURSE_REFERENCE" },
    },
    select: { sourceId: true },
  });

  if (!refSource) return null;

  // Query assertions with co:* tags (PDF-extracted course reference)
  const audienceAssertions = await prisma.contentAssertion.findMany({
    where: {
      sourceId: refSource.sourceId,
      category: "session_metadata",
      chapter: "Course Overview",
    },
    select: { assertion: true, tags: true },
  });

  if (audienceAssertions.length === 0) return null;

  const context: AudienceContext = {};
  for (const a of audienceAssertions) {
    const tags = a.tags as string[];
    // Extract value after "Label: " prefix
    const value = a.assertion.includes(": ") ? a.assertion.split(": ").slice(1).join(": ") : undefined;
    if (!value) continue;

    if (tags.includes("co:studentAge")) context.studentAge = value;
    else if (tags.includes("co:prerequisite")) context.prerequisite = value;
    else if (tags.includes("co:subject")) context.subject = value;
    else if (tags.includes("co:delivery")) context.delivery = value;
    else if (tags.includes("co:qualificationLevel")) context.qualificationLevel = value;
  }

  // Only return if we found at least one field
  return Object.values(context).some(Boolean) ? context : null;
}

/** Format audience context as a prompt section. Returns empty string if no context. */
function formatAudienceSection(audience: AudienceContext | null): string {
  if (!audience) return "";
  const lines: string[] = ["AUDIENCE CONTEXT (calibrate vocabulary and difficulty to this level):"];
  if (audience.subject) lines.push(`- Subject: ${audience.subject}`);
  if (audience.studentAge) lines.push(`- Student profile: ${audience.studentAge}`);
  if (audience.qualificationLevel) lines.push(`- Qualification level: ${audience.qualificationLevel}`);
  if (audience.prerequisite) lines.push(`- Prerequisites: ${audience.prerequisite}`);
  if (audience.delivery) lines.push(`- Delivery: ${audience.delivery}`);
  return lines.length > 1 ? "\n\n" + lines.join("\n") : "";
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
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
): { systemPrompt: string; userContent: string } {
  const mcqCount = Math.max(1, count - 2);
  const tfCount = Math.min(3, count - mcqCount);

  const distractorStrategy = assessmentIntent === "PRE_TEST"
    ? `DISTRACTOR STRATEGY (PRE-TEST — diagnose baseline knowledge):
- Distractor 1: a common MISCONCEPTION about the topic (type: "misconception") — based on the EMERGING tier response
- Distractor 2: a PARTIAL TRUTH that shows incomplete understanding (type: "partial_truth") — based on the DEVELOPING tier response
- Distractor 3: a SURFACE-LEVEL LURE that uses words from the question but misapplies them (type: "surface_lure")
Pre-test distractors should be clearly wrong to someone who has studied the material, but tempting to someone who hasn't yet.`
    : assessmentIntent === "POST_TEST"
    ? `DISTRACTOR STRATEGY (POST-TEST — test mastery with subtle distractors):
- Distractor 1: a PARTIAL TRUTH that is almost correct but missing a key nuance (type: "partial_truth") — based on the DEVELOPING tier response
- Distractor 2: a RELATED CONCEPT that confuses a similar but distinct idea (type: "related_concept")
- Distractor 3: a common MISCONCEPTION that persists even after study (type: "misconception") — based on the EMERGING tier response
Post-test distractors should be subtle — they should only trip up someone who didn't fully learn the material.`
    : `DISTRACTOR STRATEGY (GENERAL — balanced diagnostic spread):
- Distractor 1: a common MISCONCEPTION about the topic (type: "misconception") — based on the EMERGING tier response
- Distractor 2: a PARTIAL TRUTH showing incomplete understanding (type: "partial_truth") — based on the DEVELOPING tier response
- Distractor 3: a RELATED CONCEPT or SURFACE LURE (type: "related_concept" or "surface_lure")`;

  const audienceSection = formatAudienceSection(audience);

  const systemPrompt = `You are converting tutor reference questions into student-facing assessment items for an educational platform.

You are given open-ended comprehension questions that a tutor would ask, along with model responses at different proficiency tiers (Emerging = weak, Developing = partial, Secure = strong). Your job is to convert these into ${mcqCount} multiple-choice (MCQ) and ${tfCount} true/false (TRUE_FALSE) questions.
${audienceSection}

CONVERSION STRATEGY:
- Use the SECURE tier response as the basis for the CORRECT answer
- Use the EMERGING tier response as the basis for a misconception distractor
- Use the DEVELOPING tier response as the basis for a partial-truth distractor
- Generate 1 additional distractor (related concept or surface lure)
- The question should test the same comprehension SKILL as the original tutor question
- Preserve the bloom cognitive level (REMEMBER, UNDERSTAND, ANALYZE, EVALUATE)

${distractorStrategy}

MCQ rules:
- Each MCQ must have exactly 4 options labeled A, B, C, D
- Exactly one option must be correct
- Each INCORRECT option must include a "distractorType" field: one of "misconception", "partial_truth", "related_concept", "surface_lure"
- Correct option must NOT have a distractorType field
- All options must be similar in length and grammatical structure (no giveaways)

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
    { "label": "A", "text": "...", "isCorrect": false, "distractorType": "misconception" },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false, "distractorType": "partial_truth" },
    { "label": "D", "text": "...", "isCorrect": false, "distractorType": "related_concept" }
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
// Comprehension skill-distributed MCQ prompt (assertion fallback for comprehension courses)
// ---------------------------------------------------------------------------

/**
 * When a comprehension course has no QUESTION_BANK, generate MCQs from assertions
 * but distribute across the 6 PIRLS/KS2-aligned comprehension skills instead of bloom levels.
 * This ensures MCQs test the same skills the pipeline measures (COMP_RETRIEVAL, etc.).
 */
function buildComprehensionSkillPrompt(
  assertionText: string,
  count: number,
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
): string {
  // Distribute questions across the 6 skills (favour inference + retrieval)
  const retrievalCount = Math.max(1, Math.floor(count * 0.2));
  const inferenceCount = Math.max(1, Math.floor(count * 0.2));
  const vocabCount = Math.max(1, Math.floor(count * 0.15));
  const languageCount = Math.max(1, Math.floor(count * 0.15));
  const evaluationCount = Math.max(1, Math.floor(count * 0.15));
  const recallCount = Math.max(0, count - retrievalCount - inferenceCount - vocabCount - languageCount - evaluationCount);

  const audienceSection = formatAudienceSection(audience);
  const distractorNote = assessmentIntent === "PRE_TEST"
    ? "Use obvious misconceptions and surface lures — diagnose what the student doesn't yet know."
    : assessmentIntent === "POST_TEST"
    ? "Use subtle partial truths and related concepts — test whether the student truly mastered the material."
    : "Use a balanced mix of misconceptions, partial truths, and related concepts.";

  return `You are generating comprehension assessment questions for an educational platform.
Given content assertions (facts/concepts from course materials), generate questions that test COMPREHENSION SKILLS — not factual recall.
${audienceSection}

Generate exactly ${count} questions distributed across these comprehension skills:
- ${retrievalCount} RETRIEVAL: Can the student find explicitly stated information? ("According to the text...", "The passage states that...")
- ${inferenceCount} INFERENCE: Can they read between the lines? ("What can you infer...", "The author implies...")
- ${vocabCount} VOCABULARY: Do they understand words from context? ("In this context, the word X means...", "Which word best replaces...")
- ${languageCount} LANGUAGE: Can they identify the effect of the author's choices? ("Why does the author use...", "The effect of this phrase is...")
- ${evaluationCount} EVALUATION: Can they form and justify an opinion? ("Do you agree that...", "Which viewpoint is best supported...")
- ${recallCount} RECALL: Can they remember key details accurately? ("What happened when...", "Who did X...")

IMPORTANT: Frame every question as a COMPREHENSION task, even when the source material is factual.
- Instead of "What is X?" (recall), ask "Based on this information, what can you conclude about X?" (inference)
- Instead of "Define X" (recall), ask "In this context, what does X most likely refer to?" (vocabulary)

CRITICAL: Each question must be SELF-CONTAINED. The student will NOT have a passage in front of them.
- Embed enough context in the question stem that the student can answer without a separate text.
- BAD: "Based on the passage, what can you infer about the character's feelings?"
- GOOD: "In a story where a girl stamps her foot and demands to be let in after being told to wait, what emotion is she most likely displaying?"
- BAD: "What does the author imply about the economy?"
- GOOD: "A writer describes factories closing, families moving away, and shops boarding up their windows. What is the writer implying about the local economy?"
- Include a brief scenario, quote, or situation in the stem that gives the student something to reason about.

Each question can be MCQ (4 options A/B/C/D, one correct) or TRUE_FALSE.
Aim for roughly 75% MCQ and 25% TRUE_FALSE.

MCQ rules:
- Each MCQ must have exactly 4 options labeled A, B, C, D
- Exactly one option must be correct
- Each INCORRECT option must include a "distractorType" field: one of "misconception", "partial_truth", "related_concept", "surface_lure"
- Correct option must NOT have a distractorType field
- All options must be similar in length and grammatical structure (no giveaways)
- ${distractorNote}

TRUE_FALSE rules:
- Each TRUE_FALSE is a clear statement that is definitively true or false
- Options are exactly: [{ "label": "True", "text": "True" }, { "label": "False", "text": "False" }]
- correctAnswer is "True" or "False"

NEVER generate questions about:
- Assessment frameworks, rubrics, or skill levels
- The structure or design of the curriculum itself
- How students are assessed or graded
- Internal skill codes

Return ONLY a JSON array:
[{
  "questionType": "MCQ",
  "question": "Based on the passage, what can you infer about...?",
  "bloomLevel": "UNDERSTAND",
  "skillRef": "SKILL-02:Inference",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false, "distractorType": "misconception" },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false, "distractorType": "partial_truth" },
    { "label": "D", "text": "...", "isCorrect": false, "distractorType": "related_concept" }
  ],
  "correctAnswer": "B",
  "chapter": "Inference",
  "explanation": "Brief explanation"
}]

SKILL REF MAPPING — use these exact values:
- Retrieval questions: skillRef = "SKILL-01:Retrieval"
- Inference questions: skillRef = "SKILL-02:Inference"
- Vocabulary questions: skillRef = "SKILL-03:Vocabulary"
- Language questions: skillRef = "SKILL-04:Language Effect"
- Evaluation questions: skillRef = "SKILL-05:Evaluation"
- Recall questions: skillRef = "SKILL-06:Recall"

Set the "chapter" field to the skill name (e.g. "Inference", "Vocabulary").`;
}

// ---------------------------------------------------------------------------
// Default bloom-distributed MCQ prompt (for non-comprehension courses)
// ---------------------------------------------------------------------------

function buildBloomDistributedPrompt(
  assertionText: string,
  count: number,
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
): string {
  const rememberCount = Math.max(1, Math.floor(count * 0.25));
  const understandCount = Math.max(1, Math.floor(count * 0.25));
  const applyCount = Math.max(1, Math.floor(count * 0.25));
  const analyzeCount = Math.max(0, count - rememberCount - understandCount - applyCount);

  const distractorStrategy = assessmentIntent === "PRE_TEST"
    ? `DISTRACTOR STRATEGY (PRE-TEST — diagnose baseline knowledge):
Each MCQ must have 3 distractors, each with a typed purpose:
- One "misconception": a common wrong belief about the topic (the answer a student gives BEFORE learning)
- One "partial_truth": an answer that is partly correct but missing key detail
- One "surface_lure": an answer that uses familiar words from the content but misapplies them
Pre-test distractors should be clearly wrong to someone who has studied, but tempting to someone who hasn't.`
    : assessmentIntent === "POST_TEST"
    ? `DISTRACTOR STRATEGY (POST-TEST — test mastery with subtle distractors):
Each MCQ must have 3 distractors, each with a typed purpose:
- One "partial_truth": almost correct but missing a crucial nuance or condition
- One "related_concept": confuses a similar but distinct concept from the same topic area
- One "misconception": a persistent wrong belief that survives even after study
Post-test distractors should be subtle — they should only trip up someone who didn't fully learn.`
    : `DISTRACTOR STRATEGY (GENERAL — balanced diagnostic spread):
Each MCQ must have 3 distractors, each with a typed purpose:
- One "misconception": a common wrong belief about the topic
- One "partial_truth": partly correct but incomplete or overgeneralized
- One "related_concept" or "surface_lure": confuses similar concepts OR uses familiar words incorrectly`;

  const audienceSection = formatAudienceSection(audience);

  return `You are an assessment question generator for an educational platform.
Given a list of content assertions (facts/concepts from course materials), generate a mix of questions spread across cognitive levels.
${audienceSection}

Generate exactly ${count} questions with this bloom distribution:
- ${rememberCount} at REMEMBER level (recall, define, identify)
- ${understandCount} at UNDERSTAND level (explain, describe, interpret)
- ${applyCount} at APPLY level (use in context, calculate, demonstrate)
- ${analyzeCount} at ANALYZE level (compare, contrast, evaluate)

${distractorStrategy}

Each question can be MCQ (4 options A/B/C/D, one correct) or TRUE_FALSE.
Aim for roughly 75% MCQ and 25% TRUE_FALSE.

MCQ rules:
- Each MCQ must have exactly 4 options labeled A, B, C, D
- Exactly one option must be correct
- Each INCORRECT option must include a "distractorType" field: one of "misconception", "partial_truth", "related_concept", "surface_lure"
- Correct option must NOT have a distractorType field
- All options must be similar in length and grammatical structure (no giveaways)

TRUE_FALSE rules:
- Each TRUE_FALSE is a clear statement that is definitively true or false
- Options are exactly: [{ "label": "True", "text": "True" }, { "label": "False", "text": "False" }]
- correctAnswer is "True" or "False"
- Avoid trivially obvious statements — make the student think

General rules:
- REMEMBER questions test recall of USEFUL, ACTIONABLE facts — things a student needs to know to perform well. NEVER test recall of acronyms, jargon definitions, assessment criteria names, or marking scheme terminology. Bad: "What does TR stand for?" Good: "What is the minimum requirement for a well-structured essay argument?"
- UNDERSTAND questions test whether the student can explain or interpret a concept in their own words
- APPLY questions test whether the student can use knowledge in a realistic scenario
- ANALYZE questions test whether the student can compare, evaluate, or reason about trade-offs
- Frame questions from the LEARNER'S perspective — what would help them improve? Not what would help them pass a quiz about the curriculum.
- Spread across different topics/chapters
- Include a brief 1-sentence explanation for the correct answer
- VARY question stems — NEVER repeat the same opening phrase (e.g. "Which of the following"). Use diverse formats: "What is…", "How would you…", "Why does…", "Calculate…", "A student claims X — is this correct?", scenario-based setups, etc.

NEVER generate questions about:
- Assessment frameworks, rubrics, or skill levels (e.g. "Emerging", "Developing", "Secure")
- The structure or design of the curriculum itself
- How students are assessed or graded
- Internal skill codes (e.g. SKILL-01, SKILL-02)
- Acronyms, abbreviations, or what letters stand for (e.g. "What does TR stand for?")
- Teaching methods or pedagogical approaches used in the course
Questions must test the SUBJECT MATTER from the learner's perspective, not knowledge of the teaching system or its terminology.

Return ONLY a JSON array:
[{
  "questionType": "MCQ",
  "question": "What is...?",
  "bloomLevel": "REMEMBER",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false, "distractorType": "misconception" },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false, "distractorType": "partial_truth" },
    { "label": "D", "text": "...", "isCorrect": false, "distractorType": "related_concept" }
  ],
  "correctAnswer": "B",
  "chapter": "optional chapter reference",
  "explanation": "Brief explanation"
}]`;
}

// ---------------------------------------------------------------------------
// #308: Module-balanced MCQ prompt (authored-modules courses only)
// ---------------------------------------------------------------------------

function buildModuleDistributedPrompt(
  assertionText: string,
  groups: ModuleGroup[],
  budgets: number[],
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
): string {
  const totalCount = budgets.reduce((s, n) => s + n, 0);
  const moduleLines = groups
    .map(
      (g, i) =>
        `- module "${g.moduleId}" (${g.moduleLabel}) → generate ${budgets[i]} questions tagged with one of [${g.outcomeRefs.join(", ")}]`,
    )
    .join("\n");

  const distractorStrategy = assessmentIntent === "PRE_TEST"
    ? `DISTRACTOR STRATEGY (PRE-TEST — diagnose baseline knowledge):
Each MCQ must have 3 distractors, each with a typed purpose:
- One "misconception": a common wrong belief about the topic
- One "partial_truth": partly correct but missing key detail
- One "surface_lure": uses familiar words from the content but misapplies them
Pre-test distractors should be clearly wrong to someone who has studied, but tempting to someone who hasn't.`
    : assessmentIntent === "POST_TEST"
    ? `DISTRACTOR STRATEGY (POST-TEST — test mastery with subtle distractors):
Each MCQ must have 3 distractors:
- One "partial_truth": almost correct but missing a crucial nuance
- One "related_concept": a similar but distinct concept
- One "misconception": a persistent wrong belief that survives study`
    : `DISTRACTOR STRATEGY (GENERAL):
Each MCQ must have 3 distractors covering "misconception", "partial_truth", and one of "related_concept" / "surface_lure".`;

  const audienceSection = formatAudienceSection(audience);

  return `You are an assessment question generator for a multi-module course.
Each module owns specific outcomes. Your job is to generate MCQs that cover EVERY module so a per-module pre-test has at least one diagnostic question per module.
${audienceSection}

Generate exactly ${totalCount} questions distributed across modules:
${moduleLines}

For EACH question, set "learningOutcomeRef" to the OUT-NN code (from the bracketed list for that module) most relevant to the assertion you used. Pick assertions tagged [LO:OUT-NN] in the source list when possible. If no tagged assertion fits a module's slot, use an untagged assertion that covers the same topic and stamp the appropriate OUT-NN ref.

Within each module, mix Bloom levels: ~50% REMEMBER + UNDERSTAND, ~50% APPLY + ANALYZE.

${distractorStrategy}

Each question can be MCQ (4 options A/B/C/D, one correct) or TRUE_FALSE (~75/25 mix).

MCQ rules:
- 4 options labeled A, B, C, D, exactly one correct
- Each INCORRECT option includes a "distractorType" field: "misconception" | "partial_truth" | "related_concept" | "surface_lure"
- Correct option must NOT have a distractorType field
- Options similar in length and structure (no giveaways)

TRUE_FALSE rules:
- Statement clearly true or false
- Options [{ "label": "True", "text": "True" }, { "label": "False", "text": "False" }]
- correctAnswer is "True" or "False"

General rules:
- Test useful, actionable knowledge from the LEARNER'S perspective
- NEVER test acronyms, rubric/criterion names, jargon definitions
- VARY question stems — diverse formats, scenarios, "A student says X — is this correct?"
- Frame each question so it diagnoses what THIS module is supposed to teach

NEVER generate questions about:
- Assessment frameworks, rubrics, or skill levels
- Curriculum design or how students are graded
- Internal skill codes (SKILL-01, etc.) or acronym definitions

Return ONLY a JSON array:
[{
  "questionType": "MCQ",
  "question": "...",
  "bloomLevel": "REMEMBER",
  "learningOutcomeRef": "OUT-NN",
  "options": [
    { "label": "A", "text": "...", "isCorrect": false, "distractorType": "misconception" },
    { "label": "B", "text": "...", "isCorrect": true },
    { "label": "C", "text": "...", "isCorrect": false, "distractorType": "partial_truth" },
    { "label": "D", "text": "...", "isCorrect": false, "distractorType": "related_concept" }
  ],
  "correctAnswer": "B",
  "chapter": "module label or chapter ref",
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
  options?: { count?: number; userId?: string; subjectSourceId?: string; assessmentIntent?: "PRE_TEST" | "POST_TEST" | "BOTH" },
): Promise<GenerateMcqsResult> {
  const count = options?.count ?? DEFAULT_COUNT;
  const assessmentIntent = options?.assessmentIntent ?? "BOTH";

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

  // Load audience context from COURSE_REFERENCE (graceful no-op if unavailable)
  const audience = subjectId ? await getAudienceContext(subjectId) : null;

  // Comprehension path: try to generate from TUTOR_QUESTIONs first
  if (isComprehension && subjectId) {
    const tutorQuestions = await fetchTutorQuestionsForSubject(subjectId);
    if (tutorQuestions.length >= 3) {
      return generateFromTutorQuestions(sourceId, tutorQuestions, count, options, audience, assessmentIntent);
    }
    // Fall through to assertion-based path if too few TUTOR_QUESTIONs
  }

  // #308: Authored-modules courses get the module-balanced prompt path. The
  // string-ref grouping (Playbook.config.modules[].outcomesPrimary against
  // ContentAssertion.learningOutcomeRef) covers more data than the FK path
  // until the learningObjectiveId backfill story lands.
  const moduleGroups = await resolveModuleGroupsForSource(sourceId);

  // Default path: generate from assertions
  return generateFromAssertions(
    sourceId,
    count,
    options,
    isComprehension ? "comprehension" : "assertion",
    audience,
    assessmentIntent,
    moduleGroups,
  );
}

// ---------------------------------------------------------------------------
// Comprehension path: TUTOR_QUESTION → MCQ
// ---------------------------------------------------------------------------

async function generateFromTutorQuestions(
  sourceId: string,
  tutorQuestions: TutorQuestionData[],
  count: number,
  options?: { userId?: string; subjectSourceId?: string },
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
): Promise<GenerateMcqsResult> {
  const { systemPrompt, userContent } = buildComprehensionPrompt(tutorQuestions, count, audience, assessmentIntent);

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

  return parseAndSaveMcqs(sourceId, result.content, options, "comprehension", assessmentIntent);
}

// ---------------------------------------------------------------------------
// Default path: Assertion → MCQ (bloom-distributed)
// ---------------------------------------------------------------------------

async function generateFromAssertions(
  sourceId: string,
  count: number,
  options?: { userId?: string; subjectSourceId?: string },
  source: "comprehension" | "assertion" = "assertion",
  audience: AudienceContext | null = null,
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
  moduleGroups: ModuleGroup[] | null = null,
): Promise<GenerateMcqsResult> {
  // Load assertions for this source (scoped by subjectSourceId when available).
  // Include learningOutcomeRef so MCQs can inherit the outcome tag from the
  // assertion they were generated from — otherwise every question lands with
  // null learningOutcomeRef and no module-level mcqCount aggregation works.
  const assertionSelect = {
    id: true,
    assertion: true,
    category: true,
    chapter: true,
    section: true,
    learningOutcomeRef: true,
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

  // Build assertion summary for prompt — include the LO ref tag in brackets
  // when present so the AI can carry it into the generated MCQ output.
  const assertionText = assertions
    .map((a, i) => {
      const tag = a.learningOutcomeRef ? `[LO:${a.learningOutcomeRef}] ` : "";
      return `${i + 1}. ${tag}[${a.category}] ${a.assertion}${a.chapter ? ` (${a.chapter})` : ""}`;
    })
    .join("\n");

  // Index for downstream tagging fallback. Lookup by 1-based position so the
  // generator can still stamp learningOutcomeRef on each saved MCQ even if the
  // AI didn't return it in JSON (some prompt variants don't ask for it).
  const sourceAssertionLoByIndex: Map<number, string | null> = new Map(
    assertions.map((a, i) => [i + 1, a.learningOutcomeRef ?? null]),
  );

  // #308: For authored-modules courses with at least one module-matching
  // assertion, use the module-balanced prompt and an outcome-spread budget.
  // Applies to both knowledge and comprehension subjects when modules are
  // authored — module balance is orthogonal to teaching profile.
  let useModuleBalanced = false;
  let effectiveCount = count;
  let moduleBudgets: number[] = [];
  let prunedGroups: ModuleGroup[] = [];
  if (moduleGroups && moduleGroups.length > 0) {
    // Drop modules that have zero matching assertions in this source — asking
    // the AI to fabricate questions for an empty group wastes tokens.
    prunedGroups = moduleGroups.filter((g) => {
      const refSet = new Set(g.outcomeRefs);
      return assertions.some((a) => a.learningOutcomeRef && refSet.has(a.learningOutcomeRef));
    });
    if (prunedGroups.length > 0) {
      moduleBudgets = computeModuleBudget(prunedGroups.length);
      effectiveCount = moduleBudgets.reduce((s, n) => s + n, 0);
      useModuleBalanced = true;
      console.log(
        `[generate-mcqs] #308 module-balanced: ${prunedGroups.length} module(s), budget [${moduleBudgets.join(", ")}], total=${effectiveCount} (vs DEFAULT_COUNT=${count})`,
      );
    }
  }

  // #308: module-balanced prompt wins over both comprehension and bloom paths
  // when authored modules are defined — module spread is the higher-priority
  // distribution constraint. The within-module Bloom hint covers cognitive mix.
  const systemPrompt = useModuleBalanced
    ? buildModuleDistributedPrompt(assertionText, prunedGroups, moduleBudgets, audience, assessmentIntent)
    : source === "comprehension"
      ? buildComprehensionSkillPrompt(assertionText, count, audience, assessmentIntent)
      : buildBloomDistributedPrompt(assertionText, count, audience, assessmentIntent);

  const callPoint = source === "comprehension" ? COMPREHENSION_CALL_POINT : CALL_POINT;

  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Content assertions:\n\n${assertionText}\n\nIMPORTANT — when an assertion is tagged [LO:OUT-NN] above, include "learningOutcomeRef": "OUT-NN" on the generated question so it links to the right module outcome.` },
      ],
    },
    { userId: options?.userId, sourceOp: callPoint },
  );

  if (!result.content) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "ai_no_response" };
  }

  const saveResult = await parseAndSaveMcqs(sourceId, result.content, options, source, assessmentIntent, sourceAssertionLoByIndex);

  // #308 post-generation guard: if any module that had matching assertions
  // ended up with zero MCQs in the final saved set, log a warning. This is
  // the AI-to-DB structural guard required by .claude/rules/ai-to-db-guard.md.
  if (useModuleBalanced && prunedGroups.length > 0 && !saveResult.skipped) {
    const savedQs = await prisma.contentQuestion.findMany({
      where: { sourceId },
      select: { learningOutcomeRef: true },
    });
    const savedRefs = new Set(savedQs.map((q) => q.learningOutcomeRef).filter(Boolean) as string[]);
    const missing: string[] = [];
    for (const g of prunedGroups) {
      const hasAny = g.outcomeRefs.some((ref) => savedRefs.has(ref));
      if (!hasAny) missing.push(g.moduleId);
    }
    if (missing.length > 0) {
      console.warn(
        `[generate-mcqs] #308 guard: modules with assertions but zero MCQs after save: ${missing.join(", ")}. ` +
          `AI may have ignored module-balance instruction or dedup pruned every candidate.`,
      );
    }
  }

  return saveResult;
}

// ---------------------------------------------------------------------------
// Shared: Parse AI response and save
// ---------------------------------------------------------------------------

async function parseAndSaveMcqs(
  sourceId: string,
  aiContent: string,
  options?: { userId?: string; subjectSourceId?: string },
  source: "comprehension" | "assertion" = "assertion",
  assessmentIntent: "PRE_TEST" | "POST_TEST" | "BOTH" = "BOTH",
  /**
   * Mapping of 1-based assertion index → its `learningOutcomeRef`. Lets the
   * generator tag each saved MCQ with the source assertion's LO ref even
   * when the AI doesn't echo it in its JSON. Without this fallback, the
   * MCQs land with null `learningOutcomeRef` and module banners count zero.
   */
  sourceAssertionLoByIndex?: Map<number, string | null>,
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
      // Resolve learningOutcomeRef in priority order:
      //   1. Explicit `learningOutcomeRef` from the AI's JSON output (preferred)
      //   2. Source assertion's LO ref via the index map (fallback when the
      //      AI didn't echo it but did reference an assertion number)
      // Saves don't strip null/undefined — sanitiseLORef in save-questions.ts
      // does the final whitelist guard.
      let learningOutcomeRef: string | undefined;
      const mAny = m as unknown as Record<string, unknown>;
      const aiRef = mAny.learningOutcomeRef;
      if (typeof aiRef === "string" && aiRef.trim().length > 0) {
        learningOutcomeRef = aiRef.trim();
      } else if (sourceAssertionLoByIndex) {
        const fromIdx = mAny.sourceAssertionIndex;
        if (typeof fromIdx === "number") {
          const ref = sourceAssertionLoByIndex.get(fromIdx);
          if (ref) learningOutcomeRef = ref;
        }
      }
      return {
        questionText: m.question,
        questionType: qType,
        learningOutcomeRef,
        options: m.options.map((o) => ({
          label: o.label,
          text: o.text,
          isCorrect: o.isCorrect,
          // AI-to-DB guard: whitelist distractorType, fallback to undefined for correct answers
          ...(!o.isCorrect && o.distractorType
            ? { distractorType: VALID_DISTRACTOR_TYPES.has(o.distractorType as DistractorType) ? o.distractorType as DistractorType : "surface_lure" as DistractorType }
            : {}),
        })),
        correctAnswer: m.correctAnswer,
        answerExplanation: m.explanation,
        chapter: source === "comprehension"
          ? (m.skillRef?.replace(/^SKILL-\d+:/, "") || m.chapter)
          : m.chapter,
        skillRef: m.skillRef,
        bloomLevel,
        assessmentUse: assessmentIntent,
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

  // Validation pass: deterministic checks (reject structural errors, flag warnings)
  const validation = validateMcqBatch(cleanQuestions);

  if (validation.validated.length === 0) {
    return { created: 0, duplicatesSkipped: 0, skipped: true, skipReason: "all_failed_validation" };
  }

  // AI review: non-blocking, flags issues but never modifies questions
  // Fire-and-forget — don't block save on AI review
  aiReviewMcqs(validation.validated, undefined, options?.userId).catch((err) => {
    console.warn("[generate-mcqs] AI review failed (non-blocking):", err);
  });

  const saveResult = await saveQuestions(sourceId, validation.validated, options?.subjectSourceId);

  const dropped = questions.length - cleanQuestions.length;
  const validated = cleanQuestions.length - validation.rejected;
  console.log(
    `[generate-mcqs] Source ${sourceId} (${source}): generated ${questions.length}, validated ${validated}, saved ${saveResult.created}, dupes ${saveResult.duplicatesSkipped}${dropped > 0 ? `, blocked ${dropped} framework-language` : ""}${validation.rejected > 0 ? `, rejected ${validation.rejected} (validation)` : ""}`,
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
