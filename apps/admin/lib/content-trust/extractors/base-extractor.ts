/**
 * Base Document Extractor
 *
 * Abstract base class for type-specific document extractors.
 * Provides shared infrastructure (chunking, retry, dedup, AI calls)
 * while allowing subclasses to customize extraction prompts,
 * chunk strategies, and post-processing.
 *
 * Subclasses override:
 * - extractFromChunk() — type-specific extraction logic
 * - chunkText() — optional: custom chunk boundaries
 * - postProcess() — optional: save questions/vocabulary after extraction
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { logAI } from "@/lib/logger";
import type { ExtractionConfig, DocumentType } from "../resolve-config";
import type { ExtractedAssertion, ExtractionOptions, ExtractionResult, ChunkCompleteData } from "../extract-assertions";
import crypto from "crypto";

// ------------------------------------------------------------------
// Extended result types for specialist extractors
// ------------------------------------------------------------------

export interface ExtractedQuestion {
  questionText: string;
  questionType: "MCQ" | "TRUE_FALSE" | "MATCHING" | "FILL_BLANK" | "SHORT_ANSWER" | "OPEN" | "UNSCRAMBLE" | "ORDERING" | "TUTOR_QUESTION";
  options?: Array<{ label: string; text: string; isCorrect?: boolean }>;
  correctAnswer?: string;
  answerExplanation?: string;
  markScheme?: string;
  learningOutcomeRef?: string;
  skillRef?: string;
  metadata?: Record<string, unknown>;
  difficulty?: number;
  pageRef?: string;
  chapter?: string;
  section?: string;
  tags: string[];
  contentHash: string;
}

export interface ExtractedVocabulary {
  term: string;
  definition: string;
  partOfSpeech?: string;
  exampleUsage?: string;
  pronunciation?: string;
  topic?: string;
  difficulty?: number;
  chapter?: string;
  pageRef?: string;
  tags: string[];
  contentHash: string;
}

export interface ChunkResult {
  assertions: ExtractedAssertion[];
  questions: ExtractedQuestion[];
  vocabulary: ExtractedVocabulary[];
  warnings: string[];
}

export interface FullExtractionResult extends ExtractionResult {
  questions: ExtractedQuestion[];
  vocabulary: ExtractedVocabulary[];
}

export interface ExtractionContext {
  chunkIndex: number;
  totalChunks: number;
  sourceSlug: string;
  qualificationRef?: string;
  focusChapters?: string[];
  /** Interaction pattern from the playbook — shapes extraction emphasis */
  interactionPattern?: string;
}

/** Data emitted per-chunk for specialist extractors (includes questions + vocabulary) */
export interface SpecialistChunkCompleteData extends ChunkCompleteData {
  questions: ExtractedQuestion[];
  vocabulary: ExtractedVocabulary[];
}

// ------------------------------------------------------------------
// Constants
// ------------------------------------------------------------------

const MAX_CHUNK_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 2000;

// ------------------------------------------------------------------
// Base class
// ------------------------------------------------------------------

export abstract class DocumentExtractor {
  abstract readonly documentType: DocumentType;

  /**
   * Extract from a single chunk. Subclasses implement this with
   * type-specific prompts and parsing logic.
   */
  abstract extractFromChunk(
    chunk: string,
    config: ExtractionConfig,
    context: ExtractionContext,
  ): Promise<ChunkResult>;

  /**
   * Split text into chunks. Default: 8KB paragraph-boundary splitting.
   * Subclasses can override for structural chunking (e.g., by LO boundary).
   */
  chunkText(text: string, maxChars: number = 8000): string[] {
    if (text.length <= maxChars) return [text];

    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      if (remaining.length <= maxChars) {
        chunks.push(remaining);
        break;
      }

      let splitAt = remaining.lastIndexOf("\n\n", maxChars);
      if (splitAt < maxChars * 0.5) {
        splitAt = remaining.lastIndexOf("\n", maxChars);
      }
      if (splitAt < maxChars * 0.3) {
        splitAt = remaining.lastIndexOf(" ", maxChars);
      }
      if (splitAt < 1) {
        splitAt = maxChars;
      }

      chunks.push(remaining.substring(0, splitAt));
      remaining = remaining.substring(splitAt).trimStart();
    }

    return chunks;
  }

  /**
   * Optional post-processing hook. Called after all chunks are extracted.
   * Subclasses can override to save questions, vocabulary, etc.
   */
  async postProcess(
    _result: FullExtractionResult,
    _sourceId: string,
  ): Promise<void> {
    // Default: no-op
  }

  /**
   * Main extraction pipeline. Chunks text, extracts from each chunk,
   * deduplicates, and returns combined results.
   *
   * @param onChunkComplete - Optional callback for progressive persistence.
   *   Called after each chunk with assertions, questions, and vocabulary.
   *   Errors are caught and logged (extraction continues on save failure).
   */
  async extract(
    text: string,
    options: ExtractionOptions,
    extractionConfig: ExtractionConfig,
    onChunkComplete?: (data: SpecialistChunkCompleteData) => Promise<void>,
  ): Promise<FullExtractionResult> {
    const warnings: string[] = [];

    if (!text.trim()) {
      return {
        ok: false,
        assertions: [],
        questions: [],
        vocabulary: [],
        warnings: [],
        error: "Empty document",
      };
    }

    const chunks = this.chunkText(text, extractionConfig.extraction.chunkSize);
    if (chunks.length > 20) {
      warnings.push(`Large document split into ${chunks.length} chunks — extraction may be slow`);
    }

    const allAssertions: ExtractedAssertion[] = [];
    const allQuestions: ExtractedQuestion[] = [];
    const allVocabulary: ExtractedVocabulary[] = [];
    const limit = options.maxAssertions || extractionConfig.extraction.maxAssertionsPerDocument;
    let failedChunks = 0;

    for (let i = 0; i < chunks.length && allAssertions.length < limit; i++) {
      const context: ExtractionContext = {
        chunkIndex: i,
        totalChunks: chunks.length,
        sourceSlug: options.sourceSlug,
        qualificationRef: options.qualificationRef,
        focusChapters: options.focusChapters,
      };

      let chunkResult: ChunkResult | null = null;

      // Retry with exponential backoff
      for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
        try {
          chunkResult = await this.extractFromChunk(chunks[i], extractionConfig, context);
          break;
        } catch (err: any) {
          const isLastAttempt = attempt === MAX_CHUNK_RETRIES - 1;
          const errorMsg = err.message || String(err);

          // Structured log so failures appear in AI Logs panel
          logAI(`content-trust.extract:error`, `Chunk ${i} attempt ${attempt + 1}/${MAX_CHUNK_RETRIES} for ${options.sourceSlug}`, errorMsg, {
            chunkIndex: i,
            attempt: attempt + 1,
            maxAttempts: MAX_CHUNK_RETRIES,
            documentType: this.documentType,
            final: isLastAttempt,
            sourceOp: "content-trust:extract",
          });

          if (isLastAttempt) {
            console.error(`[${this.documentType}-extractor] Chunk ${i} failed after ${MAX_CHUNK_RETRIES} attempts:`, errorMsg);
            failedChunks++;
          } else {
            const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
            console.warn(`[${this.documentType}-extractor] Chunk ${i} attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, errorMsg);
            await sleep(delayMs);
          }
        }
      }

      if (chunkResult) {
        allAssertions.push(...chunkResult.assertions);
        allQuestions.push(...chunkResult.questions);
        allVocabulary.push(...chunkResult.vocabulary);
        warnings.push(...chunkResult.warnings);

        // Progressive persistence: emit chunk data for per-chunk DB saves
        const hasContent = chunkResult.assertions.length > 0 || chunkResult.questions.length > 0 || chunkResult.vocabulary.length > 0;
        if (hasContent && onChunkComplete) {
          try {
            await onChunkComplete({
              assertions: chunkResult.assertions,
              questions: chunkResult.questions,
              vocabulary: chunkResult.vocabulary,
              chunkIndex: i,
              totalChunks: chunks.length,
            });
          } catch (err: any) {
            console.warn(`[${this.documentType}-extractor] onChunkComplete failed for chunk ${i}:`, err.message);
          }
        }
      }

      options.onChunkDone?.(i, chunks.length, allAssertions.length);
    }

    if (failedChunks > 0) {
      warnings.push(`${failedChunks} chunk${failedChunks > 1 ? "s" : ""} failed extraction after ${MAX_CHUNK_RETRIES} retries`);
    }

    if (allAssertions.length >= limit) {
      warnings.push(`Reached assertion limit (${limit}). Document may have more content.`);
    }

    // Deduplicate assertions by content hash
    const seenAssertions = new Set<string>();
    const dedupAssertions = allAssertions.filter((a) => {
      if (seenAssertions.has(a.contentHash)) return false;
      seenAssertions.add(a.contentHash);
      return true;
    });

    // Deduplicate questions by content hash
    const seenQuestions = new Set<string>();
    const dedupQuestions = allQuestions.filter((q) => {
      if (seenQuestions.has(q.contentHash)) return false;
      seenQuestions.add(q.contentHash);
      return true;
    });

    // Deduplicate vocabulary by term (case-insensitive)
    const seenVocab = new Set<string>();
    const dedupVocabulary = allVocabulary.filter((v) => {
      const key = v.term.toLowerCase().trim();
      if (seenVocab.has(key)) return false;
      seenVocab.add(key);
      return true;
    });

    const dupAssertions = allAssertions.length - dedupAssertions.length;
    const dupQuestions = allQuestions.length - dedupQuestions.length;
    const dupVocab = allVocabulary.length - dedupVocabulary.length;
    if (dupAssertions > 0) warnings.push(`Removed ${dupAssertions} duplicate assertions`);
    if (dupQuestions > 0) warnings.push(`Removed ${dupQuestions} duplicate questions`);
    if (dupVocab > 0) warnings.push(`Removed ${dupVocab} duplicate vocabulary items`);

    return {
      ok: true,
      assertions: dedupAssertions,
      questions: dedupQuestions,
      vocabulary: dedupVocabulary,
      warnings,
    };
  }
}

// ------------------------------------------------------------------
// Shared utilities for subclasses
// ------------------------------------------------------------------

export function hashContent(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex").substring(0, 16);
}

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  callPoint: string,
  config: ExtractionConfig["extraction"]["llmConfig"],
  metadata?: Record<string, any>,
): Promise<string> {
  // @ai-call content-trust.extract — Extract content via specialist extractor | config: /x/ai-config
  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxTokens: config.maxTokens,
      temperature: config.temperature,
      timeoutMs: 120000, // 2 min — extraction prompts are large + structured JSON output
      maxRetries: 0, // Outer extractor loop handles retry with better backoff
    },
    { sourceOp: `content-trust:${callPoint}` },
  );

  logAssistantCall(
    {
      callPoint,
      userMessage: metadata?.description || `Extract via ${callPoint}`,
      metadata,
    },
    { response: "Extraction complete", success: true },
  );

  return result.content.trim();
}

export function parseJsonResponse(text: string): any {
  let jsonStr = text.startsWith("[") || text.startsWith("{")
    ? text
    : text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
  jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
  jsonStr = jsonStr.replace(/\}(\s*)\{/g, "},$1{");
  return JSON.parse(jsonStr);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
