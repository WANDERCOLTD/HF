/**
 * Question Bank Extractor
 *
 * Specialist extractor for tutor question banks — structured teaching
 * references with skill-mapped questions and tiered model responses.
 *
 * Key differences from other extractors:
 * 1. Extracts TUTOR_QUESTION items with full tiered response metadata
 * 2. Preserves Emerging/Developing/Secure model responses + tutor moves
 * 3. Captures skill mappings (Retrieval, Inference, Vocabulary, etc.)
 * 4. Stores text references, follow-up prompts, assessment notes
 * 5. Session metadata (recommended sequence, objectives)
 *
 * The rich metadata is stored in ContentQuestion.metadata JSON field,
 * keeping the schema clean while capturing the full pedagogical structure.
 */

import type { ExtractionConfig } from "../resolve-config";
import type { ExtractedAssertion } from "../extract-assertions";
import { sanitiseLORef } from "../validate-lo-linkage";
import {
  DocumentExtractor,
  callAI,
  parseJsonResponse,
  hashContent,
  buildLoRefHint,
  type ChunkResult,
  type ExtractionContext,
  type ExtractedQuestion,
  type ExtractedVocabulary,
} from "./base-extractor";

// ------------------------------------------------------------------
// Question-bank-specific prompt
// ------------------------------------------------------------------

const QUESTION_BANK_EXTRACTION_PROMPT = `You are extracting structured content from a tutor question bank — a teaching reference with skill-mapped questions and tiered model responses.

This is NOT a learner-facing test. It is a guide for an AI voice tutor. Each question typically has:
- The question the tutor asks (conversational, not exam-style)
- Optional follow-up prompt
- Text reference (which part of the passage the question relates to)
- Model responses at 2-3 proficiency tiers (e.g., Emerging, Developing, Secure)
- Tutor moves at each tier (what the tutor should say/do next)
- Assessment notes (what the question reveals about the learner)

You must return a JSON object with THREE arrays:

{
  "assertions": [...],   // Session metadata, skill descriptions, teaching guidance
  "questions": [...],    // The skill-mapped tutor questions with tiered responses
  "vocabulary": [...]    // Any vocabulary terms mentioned for vocabulary-focused questions
}

## assertions array
Each item: {
  "assertion": string,
  "category": "session_metadata" | "skill_description" | "assessment_guidance",
  "chapter": string?,    // Skill name (e.g., "Retrieval", "Inference")
  "section": string?,
  "tags": string[],
  "learningOutcomeRef": string | null  // Which LO this assertion serves — see LO enum in user prompt. Null if none apply.
}

## questions array (the main output)
Each item: {
  "questionText": string,          // The tutor's question as they would ask it
  "questionType": "TUTOR_QUESTION",
  "section": string?,              // Question number (e.g., "1.1", "2.3")
  "tags": string[],                // Include the skill name as a tag
  "skillRef": string?,             // Skill reference (e.g., "SKILL-01:Retrieval", "SKILL-02:Inference")
  "learningOutcomeRef": string | null,  // Which LO this question assesses — see LO enum in user prompt. Null if none apply.
  "bloomLevel": "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE",
  "metadata": {
    "followUp": string?,           // Optional follow-up prompt
    "textReference": string?,      // Which part of the passage this relates to
    "modelResponses": {
      "emerging": { "response": string, "tutorMove": string }?,
      "developing": { "response": string, "tutorMove": string }?,
      "secure": { "response": string, "tutorMove": string }?
    },
    "assessmentNote": string?,     // What this question tests/reveals
    "recommendedOrder": number?    // Suggested order within the session
  }
}

## vocabulary array
Vocabulary terms from vocabulary-focused questions:
Each item: {
  "term": string,
  "definition": string,
  "exampleUsage": string?,
  "tags": string[]
}

BLOOM LEVEL — classify each question's cognitive demand:
- REMEMBER = locate or recall explicit information from the text
- UNDERSTAND = explain, infer, interpret meaning, deduce what is implied
- APPLY = use knowledge or a skill in a new or unfamiliar context
- ANALYZE = examine structure, purpose, technique, or why the writer made choices
- EVALUATE = form and justify an opinion with specific textual evidence
- CREATE = produce an original response, synthesis, or creative interpretation

Mapping guide (comprehension skills → bloom):
- Retrieval → REMEMBER
- Inference, Vocabulary in Context → UNDERSTAND
- Summary → UNDERSTAND
- Language Effect, Structure Awareness → ANALYZE
- Comparison, Evaluation with Evidence → EVALUATE

SKILL REFERENCE FORMAT — use these standard refs when the document maps to comprehension skills:
- SKILL-01:Retrieval
- SKILL-02:Inference
- SKILL-03:Vocabulary
- SKILL-04:Summary
- SKILL-05:Language Effect
- SKILL-06:Structure
- SKILL-07:Comparison
- SKILL-08:Evaluation

If the document uses different skill names, map to the closest standard ref and include the original name in tags.

IMPORTANT:
- Extract EVERY question, not just the first few
- Preserve the EXACT wording of model responses and tutor moves
- If a tier is missing (some questions only have 2 tiers), omit it from modelResponses
- Include the full text of assessment notes — these are pedagogically valuable
- recommendedOrder should reflect the document's suggested sequence (1-based)
- Return ONLY valid JSON`;

// ------------------------------------------------------------------
// Skill name → ref mapping
// ------------------------------------------------------------------

const SKILL_REF_MAP: Record<string, string> = {
  retrieval: "SKILL-01:Retrieval",
  inference: "SKILL-02:Inference",
  vocabulary: "SKILL-03:Vocabulary",
  "vocabulary in context": "SKILL-03:Vocabulary",
  summary: "SKILL-04:Summary",
  "summary and synthesis": "SKILL-04:Summary",
  "language effect": "SKILL-05:Language Effect",
  "language": "SKILL-05:Language Effect",
  structure: "SKILL-06:Structure",
  "structure awareness": "SKILL-06:Structure",
  comparison: "SKILL-07:Comparison",
  evaluation: "SKILL-08:Evaluation",
  "evaluation with evidence": "SKILL-08:Evaluation",
};

function normalizeSkillRef(raw: string | undefined | null): string | undefined {
  if (!raw) return undefined;
  // Already in standard format
  if (raw.startsWith("SKILL-")) return raw;
  // Look up by lowercase name
  const key = raw.toLowerCase().trim();
  return SKILL_REF_MAP[key] || `SKILL-00:${raw}`;
}

// ------------------------------------------------------------------
// Bloom level helpers
// ------------------------------------------------------------------

type BloomLevel = "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";

const VALID_BLOOM_LEVELS = new Set<BloomLevel>(["REMEMBER", "UNDERSTAND", "APPLY", "ANALYZE", "EVALUATE", "CREATE"]);

function normalizeBloomLevel(raw: unknown): BloomLevel | undefined {
  if (typeof raw !== "string") return undefined;
  const upper = raw.toUpperCase().trim() as BloomLevel;
  return VALID_BLOOM_LEVELS.has(upper) ? upper : undefined;
}

/** Infer bloom level from comprehension skill ref */
const SKILL_TO_BLOOM: Record<string, BloomLevel> = {
  "SKILL-01:Retrieval": "REMEMBER",
  "SKILL-02:Inference": "UNDERSTAND",
  "SKILL-03:Vocabulary": "UNDERSTAND",
  "SKILL-04:Summary": "UNDERSTAND",
  "SKILL-05:Language Effect": "ANALYZE",
  "SKILL-06:Structure": "ANALYZE",
  "SKILL-07:Comparison": "EVALUATE",
  "SKILL-08:Evaluation": "EVALUATE",
};

function inferBloomFromSkill(skillRef: string | undefined): BloomLevel | undefined {
  if (!skillRef) return undefined;
  return SKILL_TO_BLOOM[skillRef];
}

// ------------------------------------------------------------------
// Question Bank Extractor
// ------------------------------------------------------------------

export class QuestionBankExtractor extends DocumentExtractor {
  readonly documentType = "QUESTION_BANK" as const;

  async extractFromChunk(
    chunk: string,
    config: ExtractionConfig,
    context: ExtractionContext,
  ): Promise<ChunkResult> {
    const userPrompt = [
      `Extract all questions and teaching content from this tutor question bank.`,
      context.qualificationRef ? `Context: ${context.qualificationRef}` : "",
      buildLoRefHint(context.curriculumLoRefs),
      `\n---\n${chunk}\n---`,
    ].filter(Boolean).join("\n");

    const curriculumRefSet = context.curriculumLoRefs && context.curriculumLoRefs.length > 0
      ? new Set(context.curriculumLoRefs.map((lo) => lo.ref.toUpperCase()))
      : null;
    const enforceWhitelist = (raw: string | null | undefined): string | undefined => {
      const sanitised = sanitiseLORef(raw);
      if (!sanitised) return undefined;
      if (curriculumRefSet && !curriculumRefSet.has(sanitised)) return undefined;
      return sanitised;
    };

    // @ai-call content-trust.extract-question-bank — Extract questions with tiered model responses from question banks | config: /x/ai-config
    const aiResult = await callAI(
      QUESTION_BANK_EXTRACTION_PROMPT,
      userPrompt,
      "content-trust.extract-question-bank",
      config.extraction.llmConfig,
      {
        description: `Extract question bank chunk ${context.chunkIndex} (${chunk.length} chars) for ${context.sourceSlug}`,
        sourceSlug: context.sourceSlug,
        chunkIndex: context.chunkIndex,
        documentType: "QUESTION_BANK",
      },
    );

    const parsed = parseJsonResponse(aiResult.content);

    const rawAssertions = Array.isArray(parsed) ? parsed : (parsed.assertions || []);
    const rawQuestions = Array.isArray(parsed) ? [] : (parsed.questions || []);
    const rawVocabulary = Array.isArray(parsed) ? [] : (parsed.vocabulary || []);

    // Parse assertions (session metadata, skill descriptions, guidance)
    const assertions: ExtractedAssertion[] = (rawAssertions as any[]).map((item: any) => ({
      assertion: String(item.assertion || ""),
      category: item.category || "assessment_guidance",
      chapter: item.chapter || undefined,
      section: item.section || undefined,
      tags: Array.isArray(item.tags) ? item.tags : [],
      // Guard per epic #131 A2.
      learningOutcomeRef: enforceWhitelist(item.learningOutcomeRef),
      contentHash: hashContent(item.assertion || ""),
    }));

    // Parse questions with rich metadata
    const questions: ExtractedQuestion[] = (rawQuestions as any[])
      .filter((q: any) => q.questionText)
      .map((q: any, i: number) => {
        const skillRef = normalizeSkillRef(q.skillRef);
        const metadata = q.metadata || {};

        // Ensure modelResponses structure is clean
        const modelResponses: Record<string, { response: string; tutorMove: string }> = {};
        if (metadata.modelResponses) {
          for (const tier of ["emerging", "developing", "secure"]) {
            const tierData = metadata.modelResponses[tier];
            if (tierData?.response) {
              modelResponses[tier] = {
                response: String(tierData.response),
                tutorMove: String(tierData.tutorMove || ""),
              };
            }
          }
        }

        // Infer bloom level from skillRef if AI didn't provide it
        const bloomLevel = normalizeBloomLevel(q.bloomLevel)
          ?? inferBloomFromSkill(skillRef);

        return {
          questionText: String(q.questionText),
          questionType: "TUTOR_QUESTION" as const,
          section: q.section || undefined,
          tags: Array.isArray(q.tags) ? q.tags : [],
          skillRef,
          learningOutcomeRef: enforceWhitelist(q.learningOutcomeRef),
          bloomLevel,
          assessmentUse: "TUTOR_ONLY" as const,
          metadata: {
            followUp: metadata.followUp || undefined,
            textReference: metadata.textReference || undefined,
            modelResponses: Object.keys(modelResponses).length > 0 ? modelResponses : undefined,
            assessmentNote: metadata.assessmentNote || undefined,
            recommendedOrder: typeof metadata.recommendedOrder === "number" ? metadata.recommendedOrder : i + 1,
          },
          contentHash: hashContent(`tutor-q:${q.questionText}`),
        } as ExtractedQuestion;
      });

    // Parse vocabulary
    const vocabulary: ExtractedVocabulary[] = (rawVocabulary as any[])
      .filter((v: any) => v.term && v.definition)
      .map((v: any) => ({
        term: String(v.term),
        definition: String(v.definition),
        exampleUsage: v.exampleUsage || undefined,
        topic: v.topic || undefined,
        tags: Array.isArray(v.tags) ? v.tags : [],
        contentHash: hashContent(`vocab:${v.term}:${v.definition}`),
      }));

    return { assertions, questions, vocabulary, warnings: [] };
  }
}
