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
import { categoryToTeachMethod, type ExtractionConfig, type DocumentType } from "../resolve-config";
import type { ExtractedAssertion, ExtractionOptions, ExtractionResult, ChunkCompleteData } from "../extract-assertions";
import crypto from "crypto";
import { jsonrepair } from "jsonrepair";
import pLimit from "p-limit";

// ------------------------------------------------------------------
// Extended result types for specialist extractors
// ------------------------------------------------------------------

export type DistractorType = "misconception" | "partial_truth" | "related_concept" | "surface_lure";

export const VALID_DISTRACTOR_TYPES = new Set<DistractorType>(["misconception", "partial_truth", "related_concept", "surface_lure"]);

export interface ExtractedQuestion {
  questionText: string;
  questionType: "MCQ" | "TRUE_FALSE" | "MATCHING" | "FILL_BLANK" | "SHORT_ANSWER" | "OPEN" | "UNSCRAMBLE" | "ORDERING" | "TUTOR_QUESTION";
  options?: Array<{ label: string; text: string; isCorrect?: boolean; distractorType?: DistractorType }>;
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
  bloomLevel?: "REMEMBER" | "UNDERSTAND" | "APPLY" | "ANALYZE" | "EVALUATE" | "CREATE";
  assessmentUse?: "PRE_TEST" | "POST_TEST" | "BOTH" | "FORMATIVE" | "TUTOR_ONLY";
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
const CHUNK_CONCURRENCY = 3;

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
   * @param onRetry - Optional callback fired when a chunk fails and will be retried.
   */
  async extract(
    text: string,
    options: ExtractionOptions,
    extractionConfig: ExtractionConfig,
    onChunkComplete?: (data: SpecialistChunkCompleteData) => Promise<void>,
    onRetry?: (info: { chunkIndex: number; totalChunks: number; attempt: number; maxAttempts: number; delayMs: number }) => void,
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
    console.log(`[Extractor] ${this.documentType}: ${text.length} chars → ${chunks.length} chunks (chunkSize=${extractionConfig.extraction.chunkSize})`);
    if (chunks.length > 20) {
      warnings.push(`Large document split into ${chunks.length} chunks — extraction may be slow`);
    }

    const maxAssertions = options.maxAssertions || extractionConfig.extraction.maxAssertionsPerDocument;
    let failedChunks = 0;

    // Parallel chunk extraction with bounded concurrency
    const concurrency = pLimit(CHUNK_CONCURRENCY);
    const chunkResults: (ChunkResult | null)[] = new Array(chunks.length).fill(null);

    const chunkPromises = chunks.map((chunk, i) => {
      const context: ExtractionContext = {
        chunkIndex: i,
        totalChunks: chunks.length,
        sourceSlug: options.sourceSlug,
        qualificationRef: options.qualificationRef,
        focusChapters: options.focusChapters,
      };

      return concurrency(async () => {
        let chunkResult: ChunkResult | null = null;

        // Retry with exponential backoff
        for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
          try {
            chunkResult = await this.extractFromChunk(chunk, extractionConfig, context);
            break;
          } catch (err: any) {
            const isLastAttempt = attempt === MAX_CHUNK_RETRIES - 1;
            const errorMsg = err.message || String(err);

            logAI(`content-trust.extract:error`, `Chunk ${i} attempt ${attempt + 1}/${MAX_CHUNK_RETRIES} for ${options.sourceSlug}`, errorMsg, {
              chunkIndex: i,
              attempt: attempt + 1,
              maxAttempts: MAX_CHUNK_RETRIES,
              documentType: this.documentType,
              final: isLastAttempt,
              sourceOp: "content-trust:extract",
              deep: true,
            });

            if (isLastAttempt) {
              console.error(`[${this.documentType}-extractor] Chunk ${i} failed after ${MAX_CHUNK_RETRIES} attempts:`, errorMsg);
              failedChunks++;
            } else {
              const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
              console.warn(`[${this.documentType}-extractor] Chunk ${i} attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, errorMsg);
              onRetry?.({ chunkIndex: i, totalChunks: chunks.length, attempt: attempt + 1, maxAttempts: MAX_CHUNK_RETRIES, delayMs });
              await sleep(delayMs);
            }
          }
        }

        chunkResults[i] = chunkResult;

        // Progressive persistence: fire onChunkComplete immediately as each chunk lands
        if (chunkResult) {
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

          options.onChunkDone?.(i, chunks.length, chunkResult.assertions.length);
        }
      });
    });

    await Promise.all(chunkPromises);

    // Merge results in chunk order (preserves deterministic dedup — first-seen wins)
    const allAssertions: ExtractedAssertion[] = [];
    const allQuestions: ExtractedQuestion[] = [];
    const allVocabulary: ExtractedVocabulary[] = [];

    for (const result of chunkResults) {
      if (result) {
        allAssertions.push(...result.assertions);
        allQuestions.push(...result.questions);
        allVocabulary.push(...result.vocabulary);
        warnings.push(...result.warnings);
      }
    }

    if (failedChunks > 0) {
      warnings.push(`${failedChunks} chunk${failedChunks > 1 ? "s" : ""} failed extraction after ${MAX_CHUNK_RETRIES} retries`);
    }

    if (allAssertions.length >= maxAssertions) {
      warnings.push(`Reached assertion limit (${maxAssertions}). Document may have more content.`);
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

    // Assign teachMethod from category + teachingMode (specialist extractors don't set it per-chunk)
    if (options.teachingMode) {
      for (const a of dedupAssertions) {
        if (!a.teachMethod) {
          a.teachMethod = categoryToTeachMethod(a.category, options.teachingMode);
        }
      }
    }

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

export interface CallAIResult {
  content: string;
  stopReason?: string;
}

export async function callAI(
  systemPrompt: string,
  userPrompt: string,
  callPoint: string,
  _llmConfig?: ExtractionConfig["extraction"]["llmConfig"],
  metadata?: Record<string, any>,
): Promise<CallAIResult> {
  // @ai-call content-trust.extract — Extract content via specialist extractor | config: /x/ai-config
  // maxTokens and temperature are resolved from the AI Config cascade:
  // DB AIConfig (admin overrides) → SystemSettings → call-points.ts defaults
  // Do NOT pass explicit values here — that would bypass admin overrides.
  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      maxRetries: 0, // Outer extractor loop handles retry with better backoff
    },
    { sourceOp: `content-trust:${callPoint}` },
  );

  // Warn if response was truncated (max_tokens hit) — likely means incomplete JSON
  if (result.stopReason === "max_tokens") {
    console.warn(`[${callPoint}] Response truncated at max_tokens. Output may be incomplete. Check AI Config for this call point.`);
    logAI(`${callPoint}:truncated`, `Response truncated — max_tokens reached`, "max_tokens hit — output likely incomplete JSON", {
      callPoint,
      responseLength: result.content.length,
      sourceOp: `content-trust:${callPoint}`,
      deep: true,
      ...metadata,
    });
  }

  logAssistantCall(
    {
      callPoint,
      userMessage: metadata?.description || `Extract via ${callPoint}`,
      metadata,
    },
    { response: "Extraction complete", success: true },
  );

  return { content: result.content.trim(), stopReason: result.stopReason };
}

export function parseJsonResponse(text: string): any {
  // Strip markdown code fences that LLMs commonly wrap JSON in
  let jsonStr = text.startsWith("[") || text.startsWith("{")
    ? text
    : text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");

  // Strip trailing AI commentary (e.g. "I extracted 5 items.") by finding
  // where the top-level JSON structure closes. Only strips if brackets balance;
  // leaves truncated JSON intact for jsonrepair to handle.
  if (jsonStr.startsWith("[") || jsonStr.startsWith("{")) {
    const close = jsonStr[0] === "[" ? "]" : "}";
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = 0; i < jsonStr.length; i++) {
      const ch = jsonStr[i];
      if (esc) { esc = false; continue; }
      if (ch === "\\") { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === jsonStr[0]) depth++;
      if (ch === close) depth--;
      if (depth === 0) {
        jsonStr = jsonStr.substring(0, i + 1);
        break;
      }
    }
  }

  // jsonrepair handles: truncated JSON, trailing commas, single quotes,
  // unquoted keys, missing commas, comments, Python booleans, and more.
  // See https://github.com/josdejong/jsonrepair
  return JSON.parse(jsonrepair(jsonStr));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
