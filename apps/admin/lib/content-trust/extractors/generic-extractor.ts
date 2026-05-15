/**
 * Generic Document Extractor
 *
 * Port of the original extractAssertions() logic. Used as fallback for
 * document types without a specialist extractor (TEXTBOOK, WORKSHEET,
 * EXAMPLE, REFERENCE, LESSON_PLAN, POLICY_DOCUMENT).
 *
 * Extracts assertions only (no questions or vocabulary).
 */

import type { ExtractionConfig, DocumentType } from "../resolve-config";
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
} from "./base-extractor";

export class GenericExtractor extends DocumentExtractor {
  readonly documentType: DocumentType;

  constructor(documentType: DocumentType = "TEXTBOOK") {
    super();
    this.documentType = documentType;
  }

  async extractFromChunk(
    chunk: string,
    config: ExtractionConfig,
    context: ExtractionContext,
  ): Promise<ChunkResult> {
    const { extraction } = config;
    const validCategoryIds = new Set(extraction.categories.map((c) => c.id));

    // #385 Slice 1 Phase 3 — accept all four COURSE_REFERENCE* values.
    const isCourseRef =
      this.documentType === "COURSE_REFERENCE" ||
      this.documentType === "COURSE_REFERENCE_CANONICAL" ||
      this.documentType === "COURSE_REFERENCE_TUTOR_BRIEFING" ||
      this.documentType === "COURSE_REFERENCE_ASSESSOR_RUBRIC";
    const qualRef = context.qualificationRef ? `${context.qualificationRef} ` : "";

    const openingLine = isCourseRef
      ? `Extract all tutor instructions, teaching rules, and pedagogical techniques from this ${qualRef}teacher guide.`
      : `Extract all teaching points from this ${qualRef}training material.`;

    const courseRefHint = isCourseRef
      ? [
          `\nThis is a TEACHER GUIDE / COURSE REFERENCE document. Your primary job is to extract TUTOR INSTRUCTIONS — rules, techniques, session flow, scaffolding, assessment approaches, communication guidelines, and differentiation strategies.`,
          `\nInstruction categories (PRIORITISE these): ${extraction.categories.filter(c => !["fact", "definition", "example", "threshold", "rule", "process"].includes(c.id)).map(c => c.id).join(", ") || extraction.categories.map(c => c.id).join(", ")}`,
          `Content categories (use ONLY for student-facing facts/definitions mixed in): fact, definition, threshold, rule, process, example`,
          `\nBe thorough — extract EVERY distinct instruction, technique, and guideline. A single paragraph may contain multiple separate instructions. Do not summarise or merge — one assertion per distinct rule/technique.`,
        ].join("\n")
      : "";

    const userPrompt = [
      openingLine,
      `\nValid categories: ${extraction.categories.map((c) => c.id).join(", ")}`,
      courseRefHint,
      buildLoRefHint(context.curriculumLoRefs),
      context.focusChapters?.length
        ? `Focus on: ${context.focusChapters.join(", ")}`
        : "",
      `\n---\n${chunk}\n---`,
    ].filter(Boolean).join("\n");

    console.log(`[GenericExtractor] Chunk ${context.chunkIndex}/${context.totalChunks} (${chunk.length} chars) for ${context.sourceSlug} [${this.documentType}]`);

    const aiResult = await callAI(
      extraction.systemPrompt,
      userPrompt,
      "content-trust.extract",
      extraction.llmConfig,
      {
        description: `Extract chunk ${context.chunkIndex} (${chunk.length} chars) for ${context.sourceSlug}`,
        sourceSlug: context.sourceSlug,
        chunkIndex: context.chunkIndex,
        documentType: this.documentType,
      },
    );

    console.log(`[GenericExtractor] AI response for chunk ${context.chunkIndex}: ${aiResult.content.length} chars, stopReason=${aiResult.stopReason}`);

    const raw = parseJsonResponse(aiResult.content);

    if (!Array.isArray(raw)) {
      console.warn(`[GenericExtractor] Chunk ${context.chunkIndex} returned non-array:`, typeof raw, JSON.stringify(raw).substring(0, 200));
      return { assertions: [], questions: [], vocabulary: [], warnings: [] };
    }

    console.log(`[GenericExtractor] Chunk ${context.chunkIndex}: parsed ${raw.length} assertions`);

    // If we're in curriculum-aware mode, also reject refs outside the whitelist
    const curriculumRefSet = context.curriculumLoRefs && context.curriculumLoRefs.length > 0
      ? new Set(context.curriculumLoRefs.map((lo) => lo.ref.toUpperCase()))
      : null;

    const assertions: ExtractedAssertion[] = raw.map((item: any) => {
      let loRef = sanitiseLORef(item.learningOutcomeRef) ?? undefined;
      if (loRef && curriculumRefSet && !curriculumRefSet.has(loRef)) {
        loRef = undefined;
      }
      return {
        assertion: String(item.assertion || ""),
        category: validCategoryIds.has(item.category) ? item.category : "fact",
        chapter: item.chapter || undefined,
        section: item.section || undefined,
        tags: Array.isArray(item.tags) ? item.tags : [],
        examRelevance: typeof item.examRelevance === "number" ? item.examRelevance : undefined,
        // Guard per epic #131 A2: free-text refs become null; whitelist enforced.
        learningOutcomeRef: loRef,
        validUntil: item.validUntil || undefined,
        taxYear: item.taxYear || undefined,
        contentHash: hashContent(item.assertion || ""),
      };
    });

    return { assertions, questions: [], vocabulary: [], warnings: [] };
  }
}
