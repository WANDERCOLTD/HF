/**
 * Content Assertion Extraction
 *
 * Parses documents (PDF, DOCX, DOC, PPTX, text, markdown) into atomic ContentAssertions
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
import { logAI } from "@/lib/logger";
import { resolveExtractionConfig, type ExtractionConfig, type DocumentType, categoryToTeachMethod, INSTRUCTION_CATEGORIES } from "./resolve-config";
import { parseJsonResponse } from "./extractors/base-extractor";
import { sanitiseLORef } from "./validate-lo-linkage";
import type { DocumentSection } from "./segment-document";
import { filterSections, detectFigureRefs } from "./filter-sections";
import crypto from "crypto";
import { tmpdir } from "os";
import { join } from "path";
import { writeFile, unlink } from "fs/promises";

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
  /** Teach method auto-assigned from category + teaching mode (e.g., "recall_quiz") */
  teachMethod?: string;
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
  /** Teaching mode for auto-assigning teachMethod to extracted assertions */
  teachingMode?: import("./resolve-config").TeachingMode;
  /**
   * Default ContentAssertion.category supplied by an in-doc declaration
   * (hf-default-category). Used as the fallback for assertions where the
   * extractor's per-row category lookup didn't match a known value. The
   * extractor's own AI-classified category still wins when it's valid —
   * the declared default ONLY fills in for invalid / missing categories.
   * See docs/CONTENT-PIPELINE.md §3.x and parse-content-declaration.ts.
   */
  declaredDefaultCategory?: string;
  /**
   * Curriculum-aware extraction: list of LO refs the AI may tag assertions with.
   * When provided, the prompt constrains `learningOutcomeRef` to this enum and
   * `sanitiseLORef` rejects any free-text value the AI returns. Populated by the
   * extract route when the subject already has a curriculum with LOs — gives the
   * extractor visibility into the curriculum structure it should align to.
   * Epic #131 Story A2.
   */
  curriculumLoRefs?: { ref: string; description: string }[];
  /** Called after each chunk completes (for progress tracking) */
  onChunkDone?: (chunkIndex: number, totalChunks: number, extractedSoFar: number) => void;
  /** Called after each chunk completes with the chunk's extracted data (for progressive DB saves) */
  onChunkComplete?: (data: ChunkCompleteData) => Promise<void>;
  /** Called when a chunk extraction fails and will be retried */
  onRetry?: (info: { chunkIndex: number; totalChunks: number; attempt: number; maxAttempts: number; delayMs: number }) => void;
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
 * Extract text from a PPTX buffer using node-pptx-parser.
 * Writes to a temp file because the parser only accepts file paths.
 */
export async function extractTextFromPptx(buffer: Buffer): Promise<{ text: string }> {
  const tmpPath = join(tmpdir(), `hf-pptx-${crypto.randomUUID()}.pptx`);
  try {
    await writeFile(tmpPath, buffer);
    // Dynamic import to avoid bundling issues
    const PptxParser = (await import("node-pptx-parser")).default;
    const parser = new PptxParser(tmpPath);
    const slides = await parser.extractText();
    const text = slides.map((s: { text: string[] }) => s.text.join("\n")).join("\n\n");
    return { text };
  } finally {
    await unlink(tmpPath).catch(() => {});
  }
}

/**
 * Extract text from a DOC buffer using word-extractor.
 */
export async function extractTextFromDoc(buffer: Buffer): Promise<{ text: string }> {
  // Dynamic import to avoid bundling issues
  const WordExtractor = (await import("word-extractor")).default;
  const extractor = new WordExtractor();
  const doc = await extractor.extract(buffer);
  return { text: doc.getBody() };
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

  if (name.endsWith(".doc")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text } = await extractTextFromDoc(buffer);
    return { text, fileType: "doc" };
  }

  if (name.endsWith(".pptx")) {
    const buffer = Buffer.from(await file.arrayBuffer());
    const { text } = await extractTextFromPptx(buffer);
    return { text, fileType: "pptx" };
  }

  if (name.endsWith(".ppt")) {
    return { text: "", fileType: "ppt" };
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

  if (name.endsWith(".doc")) {
    const { text } = await extractTextFromDoc(buffer);
    return { text, fileType: "doc" };
  }

  if (name.endsWith(".pptx")) {
    const { text } = await extractTextFromPptx(buffer);
    return { text, fileType: "pptx" };
  }

  if (name.endsWith(".ppt")) {
    return { text: "", fileType: "ppt" };
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
  // Accept both type-specific categories AND instruction categories as valid output.
  // This prevents tutor instructions in mixed documents from being silently remapped to "fact".
  const validCategoryIds = new Set([
    ...extraction.categories.map((c) => c.id),
    ...INSTRUCTION_CATEGORIES,
  ]);

  // Build document-type context for the AI
  const docTypeLabel = options.documentType
    ? options.documentType.replace(/_/g, " ").toLowerCase()
    : "training";

  const isCourseRef = options.documentType === "COURSE_REFERENCE";

  // For non-COURSE_REFERENCE documents, hint that tutor instructions may be present
  const instructionHint = !isCourseRef
    ? `\nIf any content instructs the TUTOR (how to teach) rather than teaching the STUDENT, classify it using: ${INSTRUCTION_CATEGORIES.join(", ")}.`
    : "";

  // For COURSE_REFERENCE, emphasise instruction extraction with category guidance
  const courseRefHint = isCourseRef
    ? [
        `\nThis is a TEACHER GUIDE / COURSE REFERENCE document. Your primary job is to extract TUTOR INSTRUCTIONS — rules, techniques, session flow, scaffolding, assessment approaches, communication guidelines, and differentiation strategies.`,
        `\nInstruction categories (PRIORITISE these): ${INSTRUCTION_CATEGORIES.join(", ")}`,
        `Content categories (use ONLY for student-facing facts/definitions mixed in): fact, definition, threshold, rule, process, example`,
        `\nBe thorough — extract EVERY distinct instruction, technique, and guideline. A single paragraph may contain multiple separate instructions. Do not summarise or merge — one assertion per distinct rule/technique.`,
      ].join("\n")
    : "";

  const qualRef = options.qualificationRef ? `${options.qualificationRef} ` : "";
  const openingLine = isCourseRef
    ? `Extract all tutor instructions, teaching rules, and pedagogical techniques from this ${qualRef}teacher guide.`
    : `Extract all teaching points from this ${qualRef}${docTypeLabel} material.`;

  // Curriculum-aware LO constraint (epic #131 A2). When a curriculum already
  // exists for this subject, we pass its LO list as a constrained enum so the
  // AI tags assertions with structured refs (LO1, LO2) instead of free-text
  // topic names like "Character analysis". If empty, the AI is told to omit
  // the field entirely — better null than garbage.
  const loRefHint = options.curriculumLoRefs && options.curriculumLoRefs.length > 0
    ? [
        `\nLEARNING OUTCOME REFS — STRICT ENUM`,
        `Tag each teaching point with exactly one of these LO refs in the "learningOutcomeRef" field, or null if the point doesn't map to any listed LO.`,
        `Do NOT invent ref strings. Do NOT use free-text topic names (e.g. "Character analysis"). ONLY these refs are valid:`,
        ...options.curriculumLoRefs.map((lo) => `  - ${lo.ref}: ${lo.description}`),
        `If a teaching point doesn't clearly match any LO above, set "learningOutcomeRef": null.`,
      ].join("\n")
    : `\nFor "learningOutcomeRef": only populate this field if the source text explicitly labels a point with a structured ref like "LO1" or "AC2.3". Otherwise set it to null. Never use free-text topic names.`;

  const userPrompt = [
    openingLine,
    `\nValid categories: ${extraction.categories.map((c) => c.id).join(", ")}`,
    instructionHint,
    courseRefHint,
    loRefHint,
    options.focusChapters?.length
      ? `Focus on: ${options.focusChapters.join(", ")}`
      : "",
    `\nIf the text references any figures, diagrams, images, or illustrations (e.g. "Figure 1.2", "Fig. 3", "Diagram A", "see image"), include a "figureRefs" array in each relevant assertion, e.g. ["Figure 1.2", "Diagram A"].`,
    `\n---\n${chunk}\n---`,
  ].filter(Boolean).join("\n");

  for (let attempt = 0; attempt < MAX_CHUNK_RETRIES; attempt++) {
    let result: { content: string; stopReason?: string } | undefined;
    try {
      // @ai-call content-trust.extract — Extract assertions from training material | config: /x/ai-config
      result = await getConfiguredMeteredAICompletion(
        {
          callPoint: "content-trust.extract",
          messages: [
            { role: "system", content: extraction.systemPrompt },
            { role: "user", content: userPrompt },
          ],
          maxTokens: extraction.llmConfig.maxTokens,
          temperature: extraction.llmConfig.temperature,
          maxRetries: 0, // Outer loop handles retry with better backoff
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

      // Parse JSON response (shared repair handles truncation, unquoted keys, etc.)
      const responseText = result.content.trim();
      const raw = parseJsonResponse(responseText);

      if (!Array.isArray(raw)) return [];

      // Optional curriculum-ref whitelist (epic #131 A2). If provided, anything
      // outside the set is rejected even if it passes the structured-format regex.
      const curriculumRefSet = options.curriculumLoRefs && options.curriculumLoRefs.length > 0
        ? new Set(options.curriculumLoRefs.map((lo) => lo.ref.toUpperCase()))
        : null;

      // Precedence for assertion category:
      //   1. AI-supplied category — wins when it's in the validCategoryIds set
      //      (extraction-config categories OR an INSTRUCTION_CATEGORY).
      //   2. Declared default (hf-default-category) — fills in when the AI
      //      returned a value but it didn't match the allow-list.
      //   3. Hard fallback to "fact" — preserved for back-compat.
      // The declared default never overrides a valid AI category; it only
      // rescues invalid ones. See parse-content-declaration.ts.
      const declaredFallback =
        options.declaredDefaultCategory &&
        validCategoryIds.has(options.declaredDefaultCategory)
          ? options.declaredDefaultCategory
          : "fact";

      return raw
        .filter((item: any) => item.assertion && String(item.assertion).trim())
        .map((item: any) => {
        const category = validCategoryIds.has(item.category) ? item.category : declaredFallback;
        // Sanitise learningOutcomeRef: free-text topic names ("Character analysis")
        // become null, only structured refs (LO1, AC2.3) survive. If the curriculum
        // has a whitelist, also enforce that the ref is in the allowed set.
        let loRef = sanitiseLORef(item.learningOutcomeRef) ?? undefined;
        if (loRef && curriculumRefSet && !curriculumRefSet.has(loRef)) {
          loRef = undefined;
        }
        return {
          assertion: String(item.assertion).trim(),
          category,
          chapter: item.chapter || undefined,
          section: item.section || undefined,
          tags: Array.isArray(item.tags) ? item.tags : [],
          examRelevance: typeof item.examRelevance === "number" ? item.examRelevance : undefined,
          learningOutcomeRef: loRef,
          validUntil: item.validUntil || undefined,
          taxYear: item.taxYear || undefined,
          contentHash: hashAssertion(item.assertion || ""),
          figureRefs: Array.isArray(item.figureRefs) ? item.figureRefs : undefined,
          teachMethod: categoryToTeachMethod(category, options.teachingMode || "recall"),
        };
      });
    } catch (err: any) {
      const isLastAttempt = attempt === MAX_CHUNK_RETRIES - 1;
      const errorMsg = err.message || String(err);
      // Capture raw AI response for debugging parse failures
      const rawResponse = result?.content ?? "(no response captured)";

      // Structured log so failures appear in AI Logs panel
      logAI(`content-trust.extract:error`, `Chunk ${chunkIndex} attempt ${attempt + 1}/${MAX_CHUNK_RETRIES} for ${options.sourceSlug}`, errorMsg, {
        chunkIndex,
        attempt: attempt + 1,
        maxAttempts: MAX_CHUNK_RETRIES,
        final: isLastAttempt,
        sourceOp: "content-trust:extract",
        stopReason: result?.stopReason,
        rawResponseLength: rawResponse.length,
        rawResponseTail: rawResponse.slice(-500),
        deep: true,
      });

      if (isLastAttempt) {
        console.error(`[extract-assertions] Chunk ${chunkIndex} failed after ${MAX_CHUNK_RETRIES} attempts:`, errorMsg);
        return [];
      }
      const delayMs = RETRY_BASE_DELAY_MS * Math.pow(2, attempt);
      console.warn(`[extract-assertions] Chunk ${chunkIndex} attempt ${attempt + 1} failed, retrying in ${delayMs}ms:`, errorMsg);
      options.onRetry?.({ chunkIndex, totalChunks: 0, attempt: attempt + 1, maxAttempts: MAX_CHUNK_RETRIES, delayMs });
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

  // Info: note if a COURSE_REFERENCE doc contains student-facing content.
  // These now flow through to curriculum loaders (no longer orphaned),
  // but we still surface the count as an informational note.
  if (options.documentType === "COURSE_REFERENCE") {
    const instructionCatSet = new Set<string>(INSTRUCTION_CATEGORIES);
    const contentAssertions = deduplicated.filter((a) => !instructionCatSet.has(a.category));
    if (contentAssertions.length > 0) {
      warnings.push(
        `This teacher guide also contains ${contentAssertions.length} student-facing teaching point${contentAssertions.length > 1 ? "s" : ""} (${[...new Set(contentAssertions.map((a) => a.category))].join(", ")}). ` +
        `These will be included in curriculum content alongside any dedicated content sources.`
      );
    }
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

// ------------------------------------------------------------------
// Quick extraction (fast first-pass preview)
// ------------------------------------------------------------------

/** Quick preview item — lightweight teaching point for immediate display */
export interface QuickPreviewItem {
  text: string;
  category: string;
}

/**
 * Fast first-pass extraction using lightweight model.
 * Returns 5-15 key teaching points for immediate preview while
 * full extraction runs in background.
 *
 * Results are NOT saved to DB — they live in the job context only.
 */
export async function quickExtract(
  text: string,
  categories: string[],
): Promise<QuickPreviewItem[]> {
  // Use first ~6000 chars (enough for most documents, fast for AI)
  const sample = text.substring(0, 6000);

  // @ai-call content-trust.quick-extract — Fast first-pass teaching point preview | config: /x/ai-config
  const result = await getConfiguredMeteredAICompletion(
    {
      callPoint: "content-trust.quick-extract",
      messages: [
        {
          role: "system",
          content:
            "You are a content extraction specialist. Quickly identify the main teaching points from this material. Return a JSON array of objects with {text, category}. Be concise — one sentence per point. Extract 5-15 key points.",
        },
        {
          role: "user",
          content: `Extract the key teaching points.\n\nValid categories: ${categories.join(", ")}\n\n---\n${sample}\n---`,
        },
      ],
      maxTokens: 1500,
      temperature: 0.3,
    },
    { sourceOp: "content-trust:quick-extract" },
  );

  // Parse JSON array from response
  try {
    const parsed: unknown = parseJsonResponse(result.content.trim());
    if (!Array.isArray(parsed)) return [];
    return (parsed as any[])
      .filter((item) => item?.text && typeof item.text === "string")
      .map((item) => ({
        text: String(item.text),
        category: categories.includes(item.category) ? item.category : "fact",
      }))
      .slice(0, 20);
  } catch {
    return [];
  }
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
