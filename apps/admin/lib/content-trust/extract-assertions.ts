/**
 * Content Assertion Extraction
 *
 * Parses documents (PDF, text, markdown) into atomic ContentAssertions
 * using AI to identify teaching points, facts, thresholds, and definitions.
 *
 * Extraction config is spec-driven:
 * - System spec CONTENT-EXTRACT-001 provides defaults
 * - Domain-level override specs customize per domain
 * - Resolved via resolveExtractionConfig()
 *
 * Flow: Document → text extraction → chunking → AI extraction → assertions
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { resolveExtractionConfig, type ExtractionConfig, type DocumentType } from "./resolve-config";
import type { DocumentSection } from "./segment-document";
import { filterSections, detectFigureRefs } from "./filter-sections";
import crypto from "crypto";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ExtractedAssertion {
  assertion: string;
  category: string;
  chapter?: string;
  section?: string;
  pageRef?: string;
  tags: string[];
  validUntil?: string;
  taxYear?: string;
  examRelevance?: number;
  learningOutcomeRef?: string;
  contentHash: string;
  /** Figure/diagram/table references detected in this assertion's source text */
  figureRefs?: string[];
}

export interface ExtractionResult {
  ok: boolean;
  assertions: ExtractedAssertion[];
  documentTitle?: string;
  documentStructure?: { chapters: string[] };
  warnings: string[];
  error?: string;
}

/** Data emitted per-chunk for progressive persistence */
export interface ChunkCompleteData {
  assertions: ExtractedAssertion[];
  chunkIndex: number;
  totalChunks: number;
}

export interface ExtractionOptions {
  sourceSlug: string;
  sourceId?: string;
  documentType?: DocumentType;
  qualificationRef?: string;
  focusChapters?: string[];
  maxAssertions?: number;
  /** Called after each chunk completes (for progress tracking) */
  onChunkDone?: (chunkIndex: number, totalChunks: number, extractedSoFar: number) => void;
  /** Called after each chunk completes with the chunk's extracted data (for progressive DB saves) */
  onChunkComplete?: (data: ChunkCompleteData) => Promise<void>;
}

// ------------------------------------------------------------------
// Text extraction
// ------------------------------------------------------------------

/**
 * Extract text from a PDF buffer using pdf-parse.
 */
export async function extractTextFromPdf(buffer: Buffer): Promise<{ text: string; pages: number }> {
  // Dynamic import to avoid bundling issues
  // @ts-expect-error — no @types/pdf-parse installed
  const pdfParse = (await import("pdf-parse")).default;
  const data = await pdfParse(buffer);
  return { text: data.text, pages: data.numpages };
}

/**
 * Extract text from a DOCX buffer using mammoth.
 */
export async function extractTextFromDocx(buffer: Buffer): Promise<{ text: string }> {
  // Dynamic import to avoid bundling issues
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  return { text: result.value };
}

/**
 * Extract text from various file types.
 */
export async function extractText(
  file: File
): Promise<{ text: string; pages?: number; fileType: string }> {
  const name = file.name.toLowerCase();

  if (name.endsWith(".pdf")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text, pages } = await extractTextFromPdf(buffer);
    return { text, pages, fileType: "pdf" };
  }

  if (name.endsWith(".docx")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text } = await extractTextFromDocx(buffer);
    return { text, fileType: "docx" };
  }

  // Text-based formats
  const text = await file.text();
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return { text, fileType: "markdown" };
  }
  if (name.endsWith(".json")) {
    return { text, fileType: "json" };
  }
  return { text, fileType: "text" };
}

/**
 * Extract text from a buffer + filename (for files read from storage).
 */
export async function extractTextFromBuffer(
  buffer: Buffer,
  fileName: string,
): Promise<{ text: string; pages?: number; fileType: string }> {
  const name = fileName.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { text, pages } = await extractTextFromPdf(buffer);
    return { text, pages, fileType: "pdf" };
  }

  if (name.endsWith(".docx")) {
    const { text } = await extractTextFromDocx(buffer);
    return { text, fileType: "docx" };
  }

  const text = buffer.toString("utf-8");
  if (name.endsWith(".md") || name.endsWith(".markdown")) {
    return { text, fileType: "markdown" };
  }
  if (name.endsWith(".json")) {
    return { text, fileType: "json" };
  }
  return { text, fileType: "text" };
}

// ------------------------------------------------------------------
// Chunking
// ------------------------------------------------------------------

/**
 * Split text into manageable chunks for AI processing.
 * Tries to split on paragraph/section boundaries.
 */
export function chunkText(text: string, maxChars: number = 8000): string[] {
  if (text.length <= maxChars) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point (double newline, then single newline, then space)
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

// ------------------------------------------------------------------
// AI extraction
// ------------------------------------------------------------------

/** Max retries per chunk before giving up */
const MAX_CHUNK_RETRIES = 3;

/** Base delay in ms for exponential backoff (doubles each retry: 2s, 4s, 8s) */
const RETRY_BASE_DELAY_MS = 2000;

/**
 * Generate a content hash for deduplication.
 */
function hashAssertion(text: string): string {
  return crypto.createHash("sha256").update(text.trim().toLowerCase()).digest("hex").substring(0, 16);
}

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build the category list string for the extraction prompt from spec config.
 */
function buildCategoryList(extractionConfig: ExtractionConfig): string {
  return extractionConfig.extraction.categories
    .map((c) => `- ${c.id}: ${c.description}`)
    .join("\n");
}

/**
 * Use AI to extract assertions from a text chunk.
 * Config is spec-driven — prompt, categories, LLM settings all from resolved config.
 * Retries up to MAX_CHUNK_RETRIES times with exponential backoff on failure.
 */
async function extractFromChunk(
  chunk: string,
  options: ExtractionOptions,
  chunkIndex: number,
  extractionConfig: ExtractionConfig,
): Promise<ExtractedAssertion[]> {
  const { extraction } = extractionConfig;
  const validCategoryIds = new Set(extraction.categories.map((c) => c.id));

  const userPrompt = [
    `Extract all teaching points from this ${options.qualificationRef ? `${options.qualificationRef} ` : ""}training material.`,
    `\nValid categories: ${extraction.categories.map((c) => c.id).join(", ")}`,
    options.focusChapters?.length
      ? `Focus on: ${options.focusChapters.join(", ")}`
      : "",
    `\nIf the text references any figures, diagrams, images, or illustrations (e.g. "Figure 1.2", "Fig. 3", "Diagram A", "see image"), include a "figureRefs" array in each relevant assertion, e.g. ["Figure 1.2", "Diagram A"].`,
    `\n---\n${chunk}\n---`,
  ].filter(Boolean).join("\n");

  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    try {
      // @ai-call content-trust.extract — Extract assertions from training material | config: /x/ai-config
      const result = await getConfiguredMeteredAICompletion(
        {
          callPoint: "content-trust.extract",
          messages: [
            { role: "system", content: extraction.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          maxTokens: extraction.llmConfig.maxTokens,
          temperature: extraction.llmConfig.temperature,
        },
        { sourceOp: "content-trust:extract" }
      );

      // Log for learning
      logAssistantCall(
        {
          callPoint: "content-trust.extract",
          userMessage: `Extract chunk ${chunkIndex} (${chunk.length} chars) for ${options.sourceSlug}`,
          metadata: { sourceSlug: options.sourceSlug, chunkIndex, attempt },
        },
        { response: `Extracted assertions`, success: true }
      );

      // Warn if response was truncated (max_tokens hit)
      if (result.stopReason === "max_tokens") {
        console.warn(`[extract-assertions] Chunk ${chunkIndex} response truncated (max_tokens=${extraction.llmConfig.maxTokens}). Consider increasing llmConfig.maxTokens.`);
      }

      // Parse JSON response (with repair for common AI mistakes)
      const text = result.content.trim();
      // Handle potential markdown code fences
      let jsonStr = text.startsWith("[") || text.startsWith("{") ? text : text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
      // Remove trailing commas before ] or }
      jsonStr = jsonStr.replace(/,\s*([\]}])/g, "$1");
      // Fix missing commas between }{ patterns
      jsonStr = jsonStr.replace(/\}(\s*)\{/g, "},$1{");
      const raw = JSON.parse(jsonStr);

      if (!Array.isArray(raw)) return [];

      return raw.map((item: any) => ({
        assertion: String(item.assertion || ""),
        category: validCategoryIds.has(item.category) ? item.category : "fact",
        chapter: item.chapter || undefined,
        section: item.section || undefined,
        tags: Array.isArray(item.tags) ? item.tags : [],
        examRelevance: typeof item.examRelevance === "number" ? item.examRelevance : undefined,
        learningOutcomeRef: item.learningOutcomeRef || undefined,
        validUntil: item.validUntil || undefined,
        taxYear: item.taxYear || undefined,
        contentHash: hashAssertion(item.assertion || ""),
        figureRefs: Array.isArray(item.figureRefs) ? item.figureRefs : undefined,
      }));
    } catch (err: any) {
      const isLastAttempt = attempt === MAX_CHUNK_RETRIES - 1;
      if (isLastAttempt) {
        console.error(`[extract-assertions] Chunk ${chunkIndex} failed after ${MAX_CHUNK_RETRIES} attempts:`, err.message);
        return [];
      }
      const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[extract-assertions] Chunk ${chunkIndex} attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, err.message);
      await sleep(delayMs);
    }
  }

  return []; // unreachable, but satisfies TS
}

// ------------------------------------------------------------------
// Main extraction pipeline
// ------------------------------------------------------------------

/**
 * Extract assertions from document text.
 * Chunks the text, runs AI extraction on each chunk, deduplicates results.
 *
 * Config is resolved from CONTENT-EXTRACT-001 spec (system) + domain overrides.
 */
export async function extractAssertions(
  text: string,
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const warnings: string[] = [];

  if (!text.trim()) {
    return { ok: false, assertions: [], warnings: [], error: "Empty document" };
  }

  // Resolve config from spec (system defaults + domain overrides + type overrides)
  const extractionConfig = await resolveExtractionConfig(options.sourceId, options.documentType);

  // Chunk the text using spec-configured chunk size
  const chunks = chunkText(text, extractionConfig.extraction.chunkSize);
  if (chunks.length > 20) {
    warnings.push(`Large document split into ${chunks.length} chunks — extraction may be slow`);
  }

  // Extract from each chunk (sequentially to avoid rate limits)
  const allAssertions: ExtractedAssertion[] = [];
  const limit = options.maxAssertions || extractionConfig.extraction.maxAssertionsPerDocument;
  let failedChunks = 0;

  for (let i = 0; i < chunks.length && allAssertions.length < limit; i++) {
    const chunkAssertions = await extractFromChunk(chunks[i], options, i, extractionConfig);
    if (chunkAssertions.length === 0 && chunks[i].trim().length > 100) {
      // Non-trivial chunk returned nothing — likely a failure after retries
      failedChunks++;
    }
    allAssertions.push(...chunkAssertions);

    // Progressive persistence: emit chunk data for per-chunk DB saves
    if (chunkAssertions.length > 0 && options.onChunkComplete) {
      try {
        await options.onChunkComplete({ assertions: chunkAssertions, chunkIndex: i, totalChunks: chunks.length });
      } catch (err: any) {
        console.warn(`[extract-assertions] onChunkComplete failed for chunk ${i}:`, err.message);
      }
    }

    options.onChunkDone?.(i, chunks.length, allAssertions.length);
  }

  if (failedChunks > 0) {
    const docTypeNote = options.documentType
      ? ` (type: ${options.documentType})`
      : " (no document type — try re-uploading via Content Sources for better results)";
    warnings.push(`${failedChunks} chunk${failedChunks > 1 ? "s" : ""} failed extraction${docTypeNote}`);
  }

  if (allAssertions.length >= limit) {
    warnings.push(`Reached assertion limit (${limit}). Document may have more content.`);
  }

  // Deduplicate by content hash
  const seen = new Set<string>();
  const deduplicated = allAssertions.filter((a) => {
    if (seen.has(a.contentHash)) return false;
    seen.add(a.contentHash);
    return true;
  });

  if (deduplicated.length < allAssertions.length) {
    warnings.push(`Removed ${allAssertions.length - deduplicated.length} duplicate assertions`);
  }

  return {
    ok: true,
    assertions: deduplicated,
    warnings,
  };
}

// ------------------------------------------------------------------
// Segmented extraction (composite documents)
// ------------------------------------------------------------------

/**
 * Extract assertions from a composite document by processing each
 * section independently with its own type-specific prompt.
 *
 * Each section's assertions are enriched with:
 * - `chapter` set to the section title
 * - `role:ROLE` tag for pedagogical filtering
 *
 * Falls back to standard extraction if only one section.
 */
export async function extractAssertionsSegmented(
  fullText: string,
  sections: DocumentSection[],
  options: ExtractionOptions,
): Promise<ExtractionResult> {
  const allAssertions: ExtractedAssertion[] = [];
  const warnings: string[] = [];
  let totalChunksProcessed = 0;

  // Apply smart section filtering (skip TOC, index, copyright, etc.)
  const filterResult = await filterSections(fullText, sections);
  const filteredSections = filterResult.sections;
  warnings.push(...filterResult.warnings);

  for (let sIdx = 0; sIdx < filteredSections.length; sIdx++) {
    const section = filteredSections[sIdx];
    const sectionText = fullText.substring(section.startOffset, section.endOffset);

    if (!sectionText.trim()) continue;

    // Extract with section-specific document type
    const sectionResult = await extractAssertions(sectionText, {
      ...options,
      documentType: section.sectionType,
      // Don't fire chunk progress for individual sections — we track overall
      onChunkDone: undefined,
      // Don't fire per-chunk saves for inner chunks — we fire once per section after enrichment
      onChunkComplete: undefined,
    });

    if (!sectionResult.ok) {
      warnings.push(`Section "${section.title}" extraction failed: ${sectionResult.error}`);
      continue;
    }

    // Detect figure refs via regex as fallback for AI-detected ones
    const regexFigureRefs = detectFigureRefs(sectionText);
    const sectionFigureRefs = new Set([
      ...(section.figureRefs || []),
      ...regexFigureRefs,
    ]);

    // Enrich assertions with section metadata
    for (const assertion of sectionResult.assertions) {
      assertion.chapter = assertion.chapter || section.title;
      assertion.tags = [
        ...assertion.tags,
        `role:${section.pedagogicalRole}`,
        ...(section.hasAnswerKey ? ["has-answers"] : []),
        ...(section.filterAction === "reference" ? ["reference-content"] : []),
      ];

      // Tag figure references (AI-detected per-assertion + section-level)
      const assertionFigRefs = new Set([
        ...(assertion.figureRefs || []),
        ...sectionFigureRefs,
      ]);
      if (assertionFigRefs.size > 0) {
        assertion.tags.push(...[...assertionFigRefs].map((ref) => `fig:${ref}`));
      }
    }

    allAssertions.push(...sectionResult.assertions);
    warnings.push(...sectionResult.warnings.map((w) => `[${section.title}] ${w}`));
    totalChunksProcessed++;

    // Progressive persistence: emit section's enriched assertions for per-section DB saves
    if (sectionResult.assertions.length > 0 && options.onChunkComplete) {
      try {
        await options.onChunkComplete({
          assertions: sectionResult.assertions,
          chunkIndex: sIdx,
          totalChunks: filteredSections.length,
        });
      } catch (err: any) {
        console.warn(`[extract-assertions] onChunkComplete failed for section "${section.title}":`, err.message);
      }
    }

    // Report overall progress
    options.onChunkDone?.(sIdx, filteredSections.length, allAssertions.length);
  }

  // Deduplicate across sections
  const seen = new Set<string>();
  const deduplicated = allAssertions.filter((a) => {
    if (seen.has(a.contentHash)) return false;
    seen.add(a.contentHash);
    return true;
  });

  if (deduplicated.length < allAssertions.length) {
    warnings.push(`Removed ${allAssertions.length - deduplicated.length} cross-section duplicates`);
  }

  return {
    ok: true,
    assertions: deduplicated,
    warnings,
  };
}

// ── FUTURE: Image Extraction ──
// TODO: When ready to extract actual images from PDFs:
// 1. Upgrade pdf-parse to v2.4.5+ (supports image extraction) OR switch to pdfjs-dist
// 2. Create extractImagesFromPdf(buffer) → { images: Buffer[], captions: string[], positions: number[] }
// 3. Auto-create MediaAsset records for each extracted image
// 4. Add mediaId FK to ContentAssertion (schema migration)
// 5. Link assertions with fig: tags to their MediaAsset via caption matching
// 6. Update prompt composition to include visual content in rendered teaching materials
// See: lib/content-trust/extract-assertions.ts, prisma/schema.prisma (MediaAsset model)
