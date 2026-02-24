/**
 * Reading Passage Extractor
 *
 * Specialist extractor for standalone reading passages — text the learner
 * reads before or during a tutoring session.
 *
 * Key differences from generic extraction:
 * 1. Extracts literary/informational content (events, characters, themes, language features)
 * 2. Identifies vocabulary-rich words suitable for "What does this word mean?" questions
 * 3. Captures key quotes for close reading
 * 4. Outputs vocabulary items (challenging words with contextual definitions)
 * 5. No questions extracted (reading passages have no questions)
 */

import type { ExtractionConfig } from "../resolve-config";
import type { ExtractedAssertion } from "../extract-assertions";
import {
  DocumentExtractor,
  callAI,
  parseJsonResponse,
  hashContent,
  type ChunkResult,
  type ExtractionContext,
  type ExtractedVocabulary,
} from "./base-extractor";

// ------------------------------------------------------------------
// Reading-passage-specific prompt
// ------------------------------------------------------------------

const READING_PASSAGE_EXTRACTION_PROMPT = `You are extracting structured content from a reading passage that a learner reads before a tutoring session.
This is literary or informational prose — there are NO questions. Extract content a tutor would discuss.

You must return a JSON object with TWO arrays:

{
  "assertions": [...],   // Teaching points from the passage
  "vocabulary": [...]    // Challenging/interesting words for vocabulary discussion
}

## assertions array
Each item: {
  "assertion": string,     // The teaching point (for key_quote, include the EXACT quote in quotation marks)
  "category": string,      // One of the categories below
  "chapter": string?,      // Section or paragraph reference
  "section": string?,      // Sub-section
  "tags": string[],        // 2-5 keywords
  "learningOutcomeRef": string?  // Skill reference if applicable
}

Categories:
- key_event: A major plot event, turning point, or factual point
- character: A character introduction, description, or significant action/dialogue
- vocabulary_highlight: A word/phrase rich for vocabulary-in-context discussion (include the word and surrounding context)
- language_feature: Notable language — metaphor, simile, personification, imagery, alliteration, tone shift, atmosphere
- theme: A theme, idea, or message the passage explores or implies
- key_quote: A significant quote for close reading (include the EXACT text)
- setting: Place, time, or atmosphere detail

## vocabulary array
Each item: {
  "term": string,           // The challenging/interesting word
  "definition": string,     // Meaning in context (not dictionary definition)
  "partOfSpeech": string?,  // "verb", "noun", "adjective", etc.
  "exampleUsage": string?,  // The sentence from the passage containing this word
  "topic": string?,         // Topic area
  "tags": string[]
}

IMPORTANT:
- For vocabulary_highlight assertions AND vocabulary items, choose words a tutor would ask "What do you think this word means here?"
- For language_feature, explain WHAT the technique is and WHY the writer used it
- For key_quote, include the EXACT text in quotation marks
- Capture the passage's emotional arc or atmosphere shifts
- Do NOT invent content not in the source text
- Return ONLY valid JSON`;

// ------------------------------------------------------------------
// Reading Passage Extractor
// ------------------------------------------------------------------

export class ReadingPassageExtractor extends DocumentExtractor {
  readonly documentType = "READING_PASSAGE" as const;

  async extractFromChunk(
    chunk: string,
    config: ExtractionConfig,
    context: ExtractionContext,
  ): Promise<ChunkResult> {
    const userPrompt = [
      `Extract all teaching content from this reading passage.`,
      context.qualificationRef ? `Context: ${context.qualificationRef}` : "",
      `\n---\n${chunk}\n---`,
    ].filter(Boolean).join("\n");

    const responseText = await callAI(
      READING_PASSAGE_EXTRACTION_PROMPT,
      userPrompt,
      "content-trust.extract-reading-passage",
      config.extraction.llmConfig,
      {
        description: `Extract reading passage chunk ${context.chunkIndex} (${chunk.length} chars) for ${context.sourceSlug}`,
        sourceSlug: context.sourceSlug,
        chunkIndex: context.chunkIndex,
        documentType: "READING_PASSAGE",
      },
    );

    const parsed = parseJsonResponse(responseText);

    const rawAssertions = Array.isArray(parsed) ? parsed : (parsed.assertions || []);
    const rawVocabulary = Array.isArray(parsed) ? [] : (parsed.vocabulary || []);

    // Parse assertions
    const assertions: ExtractedAssertion[] = (rawAssertions as any[]).map((item: any) => ({
      assertion: String(item.assertion || ""),
      category: item.category || "key_event",
      chapter: item.chapter || undefined,
      section: item.section || undefined,
      tags: Array.isArray(item.tags) ? item.tags : [],
      examRelevance: typeof item.examRelevance === "number" ? item.examRelevance : undefined,
      learningOutcomeRef: item.learningOutcomeRef || undefined,
      contentHash: hashContent(item.assertion || ""),
    }));

    // Parse vocabulary
    const vocabulary: ExtractedVocabulary[] = (rawVocabulary as any[])
      .filter((v: any) => v.term && v.definition)
      .map((v: any) => ({
        term: String(v.term),
        definition: String(v.definition),
        partOfSpeech: v.partOfSpeech || undefined,
        exampleUsage: v.exampleUsage || undefined,
        topic: v.topic || undefined,
        tags: Array.isArray(v.tags) ? v.tags : [],
        contentHash: hashContent(`vocab:${v.term}:${v.definition}`),
      }));

    // No questions from reading passages
    return { assertions, questions: [], vocabulary, warnings: [] };
  }
}
