/**
 * Curriculum Extractor
 *
 * Specialist extractor for formal qualification documents (syllabuses,
 * curriculum specs) with Learning Outcomes → Assessment Criteria → Range
 * structure.
 *
 * Key differences from generic extraction:
 * 1. Pre-parse: detect LO/AC/Range structure before chunking
 * 2. Chunk by LO boundary (not 8KB) so hierarchies stay together
 * 3. Extract with structural awareness (AI knows which LO it's in)
 * 4. Auto-generate implied questions from assessment criteria
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
} from "./base-extractor";

// ------------------------------------------------------------------
// LO boundary detection
// ------------------------------------------------------------------

/**
 * Regex patterns for detecting Learning Outcome boundaries.
 * Matches common formats:
 * - "Learning Outcome 1" / "LO1" / "LO 1"
 * - "1.0", "2.0" at line start (top-level numbering)
 * - "Unit 1:", "Module 2:"
 */
const LO_BOUNDARY_PATTERNS = [
  /^(?:Learning\s+Outcome|LO)\s*(\d+)/im,
  /^(\d+)\.0\s+/m,
  /^(?:Unit|Module)\s+(\d+)\s*[:.]/im,
];

/**
 * Detect Learning Outcome boundaries in text.
 * Returns offsets where each LO starts, for structural chunking.
 */
function detectLOBoundaries(text: string): number[] {
  const boundaries: number[] = [];

  for (const pattern of LO_BOUNDARY_PATTERNS) {
    const globalPattern = new RegExp(pattern.source, "gim");
    let match;
    while ((match = globalPattern.exec(text)) !== null) {
      boundaries.push(match.index);
    }
  }

  // Deduplicate and sort
  const unique = [...new Set(boundaries)].sort((a, b) => a - b);

  // Filter out boundaries too close together (< 200 chars apart = probably same LO)
  const filtered: number[] = [];
  for (const b of unique) {
    if (filtered.length === 0 || b - filtered[filtered.length - 1] > 200) {
      filtered.push(b);
    }
  }

  return filtered;
}

// ------------------------------------------------------------------
// Curriculum Extractor
// ------------------------------------------------------------------

export class CurriculumExtractor extends DocumentExtractor {
  readonly documentType = "CURRICULUM" as const;

  /**
   * Override chunking to split by LO boundaries instead of fixed size.
   * Falls back to standard chunking if no LO boundaries detected.
   */
  chunkText(text: string, maxChars: number = 8000): string[] {
    const boundaries = detectLOBoundaries(text);

    // If fewer than 2 boundaries, fall back to standard chunking
    if (boundaries.length < 2) {
      return super.chunkText(text, maxChars);
    }

    const chunks: string[] = [];

    // Text before first LO (preamble)
    if (boundaries[0] > 100) {
      chunks.push(text.substring(0, boundaries[0]));
    }

    // Each LO to the next
    for (let i = 0; i < boundaries.length; i++) {
      const start = boundaries[i];
      const end = i < boundaries.length - 1 ? boundaries[i + 1] : text.length;
      const loChunk = text.substring(start, end);

      // If LO chunk is too large, sub-chunk it
      if (loChunk.length > maxChars) {
        chunks.push(...super.chunkText(loChunk, maxChars));
      } else {
        chunks.push(loChunk);
      }
    }

    return chunks.filter((c) => c.trim().length > 0);
  }

  async extractFromChunk(
    chunk: string,
    config: ExtractionConfig,
    context: ExtractionContext,
  ): Promise<ChunkResult> {
    const { extraction } = config;
    const validCategoryIds = new Set(extraction.categories.map((c) => c.id));

    // Detect if this chunk contains LO structure
    const hasLOStructure = LO_BOUNDARY_PATTERNS.some((p) => p.test(chunk));

    const structureHint = hasLOStructure
      ? `\nThis text contains formal curriculum structure. Preserve LO/AC/Range references exactly as written.`
      : "";

    const userPrompt = [
      `Extract all teaching points from this ${context.qualificationRef ? `${context.qualificationRef} ` : ""}curriculum document.`,
      structureHint,
      `\nValid categories: ${extraction.categories.map((c) => c.id).join(", ")}`,
      buildLoRefHint(context.curriculumLoRefs),
      context.focusChapters?.length
        ? `Focus on: ${context.focusChapters.join(", ")}`
        : "",
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

    const aiResult = await callAI(
      extraction.systemPrompt,
      userPrompt,
      "content-trust.extract",
      extraction.llmConfig,
      {
        description: `Extract curriculum chunk ${context.chunkIndex} (${chunk.length} chars) for ${context.sourceSlug}`,
        sourceSlug: context.sourceSlug,
        chunkIndex: context.chunkIndex,
        documentType: "CURRICULUM",
      },
    );

    const warnings: string[] = [];
    if (aiResult.stopReason === "max_tokens") {
      warnings.push(`Curriculum chunk ${context.chunkIndex + 1}/${context.totalChunks} truncated at max_tokens — authored modules may be missing. Raise content-trust.extract maxTokens in /x/ai-config.`);
    }

    const raw = parseJsonResponse(aiResult.content);

    if (!Array.isArray(raw)) {
      return { assertions: [], questions: [], vocabulary: [], warnings };
    }

    const assertions: ExtractedAssertion[] = raw.map((item: any) => ({
      assertion: String(item.assertion || ""),
      category: validCategoryIds.has(item.category) ? item.category : "fact",
      chapter: item.chapter || undefined,
      section: item.section || undefined,
      tags: Array.isArray(item.tags) ? item.tags : [],
      examRelevance: typeof item.examRelevance === "number" ? item.examRelevance : undefined,
      // Guard per epic #131 A2.
      learningOutcomeRef: enforceWhitelist(item.learningOutcomeRef),
      validUntil: item.validUntil || undefined,
      taxYear: item.taxYear || undefined,
      contentHash: hashContent(item.assertion || ""),
    }));

    // Auto-generate implied questions from assessment criteria
    const questions = this.generateImpliedQuestions(assertions);

    return { assertions, questions, vocabulary: [], warnings };
  }

  /**
   * Assessment criteria imply testable questions.
   * "AC2.3: Explain the importance of temperature control"
   * → Question: "Explain the importance of temperature control."
   */
  private generateImpliedQuestions(assertions: ExtractedAssertion[]): ExtractedQuestion[] {
    const questions: ExtractedQuestion[] = [];

    for (const a of assertions) {
      if (a.category !== "assessment_criterion") continue;

      // Strip AC reference prefix (e.g., "AC2.3: ")
      const text = a.assertion.replace(/^(?:AC\s*)?[\d.]+\s*[:–—-]\s*/i, "").trim();
      if (!text || text.length < 10) continue;

      // Determine question type from Bloom's verbs
      const lowerText = text.toLowerCase();
      let questionType: ExtractedQuestion["questionType"] = "SHORT_ANSWER";
      if (/^(?:list|name|identify|state)\b/.test(lowerText)) {
        questionType = "SHORT_ANSWER";
      } else if (/^(?:explain|describe|discuss|evaluate|analyse|justify)\b/.test(lowerText)) {
        questionType = "OPEN";
      } else if (/^(?:define)\b/.test(lowerText)) {
        questionType = "SHORT_ANSWER";
      }

      questions.push({
        questionText: text.endsWith("?") || text.endsWith(".") ? text : `${text}.`,
        questionType,
        learningOutcomeRef: a.learningOutcomeRef,
        tags: [...a.tags, "implied-from-ac"],
        chapter: a.chapter,
        section: a.section,
        contentHash: hashContent(`question:${text}`),
      });
    }

    return questions;
  }
}
