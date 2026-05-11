/**
 * Document Type Classification
 *
 * @canonical-doc docs/CONTENT-PIPELINE.md §4
 *
 * Classifies uploaded documents into pedagogical types before extraction.
 * Uses multi-point sampling (start + middle + end) for better coverage
 * of composite documents.
 *
 * Types: CURRICULUM, TEXTBOOK, WORKSHEET, EXAMPLE, ASSESSMENT, REFERENCE, COMPREHENSION, LESSON_PLAN, POLICY_DOCUMENT
 *
 * The classification prompt is spec-driven via CONTENT-EXTRACT-001 config.
 *
 * **Few-shot learning:** When admin corrections exist, they are injected as
 * examples in the prompt so the classifier improves over time.
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { prisma } from "@/lib/prisma";
import { getAITimeoutSettings } from "@/lib/system-settings";
import { logAI } from "@/lib/logger";
import type { ExtractionConfig, DocumentType } from "./resolve-config";
import { parseContentDeclaration, type ContentDeclaration } from "./parse-content-declaration";

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ClassificationResult {
  documentType: DocumentType;
  confidence: number;
  reasoning: string;
  /** True when the AI call failed and the type is a fallback default */
  classificationFailed?: boolean;
  /**
   * When the documentType came from an in-document front-matter declaration
   * (parseContentDeclaration), this is `"declared:by-doc"`. Callers should
   * stamp this directly into `ContentSource.documentTypeSource` instead of
   * the usual `ai:<confidence>` format. Absent otherwise.
   */
  source?: "declared:by-doc";
  /** Parsed declaration when present (passed through so callers can stash it). */
  declaration?: ContentDeclaration;
}

export interface ClassificationExample {
  textSample: string;
  fileName: string;
  documentType: DocumentType;
  reasoning: string;
}

const VALID_TYPES: DocumentType[] = [
  "CURRICULUM", "TEXTBOOK", "WORKSHEET", "EXAMPLE", "ASSESSMENT", "REFERENCE",
  "COMPREHENSION", "LESSON_PLAN", "POLICY_DOCUMENT", "READING_PASSAGE", "QUESTION_BANK",
  "COURSE_REFERENCE",
];

// ------------------------------------------------------------------
// Filename-based classification hints
// ------------------------------------------------------------------

/**
 * Strong filename signals that override AI classification when it returns
 * a generic type (e.g. TEXTBOOK) for a file explicitly named "course-reference".
 *
 * Only fires on unambiguous filename patterns — not meant to catch every case,
 * just prevent obvious misclassifications.
 */
const FILENAME_TYPE_HINTS: Array<{
  pattern: RegExp;
  type: DocumentType;
  role: "passage" | "questions" | "reference" | "pedagogy";
}> = [
  { pattern: /course[_-]?ref(erence)?/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /tutor[_-]?(guide|instruction|playbook|handbook|manual)/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /teaching[_-]?(guide|approach|method(ology)?)/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /delivery[_-]?(guide|handbook)/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  // #276 Slice 1: assessment rubric / band descriptor docs are tutor-facing
  // scoring criteria — NOT learner content. Misclassified as TEXTBOOK they
  // leak into MCQ generation and produce questions ABOUT the rubric ("How
  // many assessment criteria are there?", "Why do Band 9 speakers hesitate?")
  // instead of testing actual skill. Anchor them to COURSE_REFERENCE.
  { pattern: /band[_-]?descriptor/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /(assessment|scoring|marking)[_-]?(rubric|criteria|descriptor)/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /band[_-]?score(s)?/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /(ielts|cefr|toefl|toeic)[_-]?(rubric|descriptor|band|score)/i, type: "COURSE_REFERENCE", role: "pedagogy" },
  { pattern: /question[_-]?bank/i, type: "QUESTION_BANK", role: "questions" },
  { pattern: /reading[_-]?passage/i, type: "READING_PASSAGE", role: "passage" },
  { pattern: /lesson[_-]?plan/i, type: "LESSON_PLAN", role: "pedagogy" },
  { pattern: /mark[_-]?scheme|markscheme/i, type: "ASSESSMENT", role: "questions" },
  // Past papers / exam papers — catch common naming patterns:
  //   past-paper, pastpaper, past_paper
  //   sats-paper, sats_paper
  //   2024-paper, paper-2024, paper_2025
  //   mock-paper, exam-paper, test-paper, practice-paper
  //   KS2-paper, GCSE-paper
  { pattern: /past[_-]?paper|sats[_-]?paper|(?:^|[_-])(?:paper[_-]?\d{4}|\d{4}[_-]?paper)|mock[_-]?paper|exam[_-]?paper|test[_-]?paper|practice[_-]?paper|ks\d[_-]?.*paper|gcse[_-]?.*paper|a[_-]?level[_-]?.*paper/i, type: "ASSESSMENT", role: "questions" },
];

/**
 * Check if a filename contains a strong document-type signal.
 *
 * Returns the hinted type + role if found, or null if no strong signal detected.
 * Used as a post-classification sanity check — overrides AI when it conflicts
 * with an unambiguous filename.
 */
export function filenameTypeHint(
  fileName: string,
): { type: DocumentType; role: "passage" | "questions" | "reference" | "pedagogy" } | null {
  for (const hint of FILENAME_TYPE_HINTS) {
    if (hint.pattern.test(fileName)) {
      return { type: hint.type, role: hint.role };
    }
  }
  return null;
}

// ------------------------------------------------------------------
// Content-based classification hints (#276 Slice 1)
// ------------------------------------------------------------------

/**
 * Strong content-shape signals that indicate a doc is a tutor-facing rubric
 * even when the filename is generic. Rubric content has a distinctive shape:
 * scoring bands (Band 9, Band 8, ...), criterion names (Fluency and Coherence,
 * Pronunciation, Grammatical Range), and descriptive phrasing about HOW
 * speakers behave at each band.
 *
 * If the text sample has 2+ of these markers, route to COURSE_REFERENCE so the
 * downstream MCQ generator's exclusion gate fires (otherwise the rubric leaks
 * into MCQ generation and produces meta-questions about the scoring system —
 * see #276).
 *
 * Conservative threshold (2+) avoids false positives on student-facing docs
 * that happen to mention a band score in passing.
 */
const RUBRIC_CONTENT_MARKERS: RegExp[] = [
  // Band/level rubric markers — must use word boundaries to avoid matching e.g. "Banda"
  /\bband\s+[0-9](?:\.\d)?\b/i,
  /\bband\s+descriptor/i,
  /\bassessment\s+criteri(a|on)/i,
  /\bmarking\s+criteri(a|on)/i,
  /\bscoring\s+rubric/i,
  /\bband\s+score/i,
  // IELTS/CEFR specific rubric phrasing
  /\bfluency\s+and\s+coherence/i,
  /\blexical\s+resource/i,
  /\bgrammatical\s+range\s+and\s+accuracy/i,
  /\bpronunciation\s+(features|criteria)/i,
  // CEFR levels in rubric context (A1, B2, C1 + descriptor language)
  /\b[ABC][12]\s+(level|descriptor|user)/i,
  // "describes how a Band X speaker..." phrasing
  /(speakers?|candidates?)\s+(at|in)\s+(this|band)/i,
];

/**
 * Counter-signals that this is LEARNER-FACING content even if it mentions
 * the rubric. Sample answers with first-person prose, practice cue cards,
 * vocabulary lists, and pronunciation drills all skew toward this.
 *
 * If the doc has substantial student-content shape, we suppress the rubric
 * override even when rubric markers appear (e.g. a learner-facing prep doc
 * that explains the rubric for context but is mostly practice material).
 */
const LEARNER_CONTENT_MARKERS: RegExp[] = [
  // Sample answer markers — first-person prose with quote markers
  /["'"]I\s+(?:like|love|enjoy|live|think|feel|grew|cycle|travel|usually|always|often)\b/i,
  /["'"](?:Honestly|Actually|To be honest|For me|In my view)\b/i,
  // Practice / drill / exercise framing
  /\bpractice\s+(?:cue\s+card|session|drill|exercise|answer)\b/i,
  /\b(?:cue\s+card|prompt|exercise|drill)\s*[:#-]/i,
  /\bsample\s+(?:answer|response|sentence)\b/i,
  /\b(?:try\s+this|read\s+aloud|repeat|practise)\b/i,
  // Vocabulary list markers
  /\b(?:collocations?|phrasal\s+verbs?|vocabulary\s+list|word\s+bank)\b/i,
  /^\s*[-*•]\s+to\s+\w+/im, // bulleted infinitive verbs (vocab lists)
  // Pronunciation drill markers
  /\bminimal\s+pairs?\b/i,
  /\bsentence\s+stress\b/i,
  /\bschwa\b/i,
];

function countMarkerOccurrences(text: string, markers: RegExp[], stopAt: number): number {
  let total = 0;
  for (const marker of markers) {
    const global = new RegExp(marker.source, marker.flags.includes("g") ? marker.flags : marker.flags + "g");
    const hits = text.match(global);
    if (hits) total += hits.length;
    if (total >= stopAt) return total;
  }
  return total;
}

/**
 * Returns true when the text sample matches enough rubric markers to be
 * confidently classified as COURSE_REFERENCE rather than learner content.
 *
 * Counts each OCCURRENCE not just unique markers — a sample with two CEFR
 * descriptors (C1, B2) is rubric content even if all hits come from one regex.
 *
 * Counter-signal: if learner-content markers (sample answers, practice
 * framing, vocab lists, pronunciation drills) outnumber rubric markers,
 * the doc is learner-facing despite mentioning rubric concepts. Without
 * this guard the IELTS Speaking practice doc (which references the rubric
 * for context) gets misclassified as COURSE_REFERENCE and excluded from
 * MCQ generation.
 */
export function isRubricContent(textSample: string): boolean {
  const rubricHits = countMarkerOccurrences(textSample, RUBRIC_CONTENT_MARKERS, 6);
  if (rubricHits < 2) return false;
  const learnerHits = countMarkerOccurrences(textSample, LEARNER_CONTENT_MARKERS, rubricHits + 1);
  // Tie or learner-leaning → not rubric.
  return rubricHits > learnerHits;
}

// ------------------------------------------------------------------
// Few-shot example retrieval
// ------------------------------------------------------------------

/**
 * Fetch few-shot examples from admin-corrected classifications.
 *
 * Strategy:
 * 1. Prefer corrections from the same domain (via source → subject → domain)
 * 2. Fill remaining slots with global corrections
 * 3. Respect maxExamples from config
 *
 * Returns empty array when no corrections exist (cold start — no regression).
 */
export async function fetchFewShotExamples(
  options?: { sourceId?: string; domainId?: string },
  config?: ExtractionConfig["classification"]["fewShot"],
): Promise<ClassificationExample[]> {
  const maxExamples = config?.maxExamples ?? 5;
  const exampleSampleSize = config?.exampleSampleSize ?? 500;

  // Resolve domain from source if available
  let domainId = options?.domainId ?? null;
  if (!domainId && options?.sourceId) {
    try {
      const subjectSources = await prisma.subjectSource.findMany({
        where: { sourceId: options.sourceId },
        select: {
          subject: {
            select: {
              domains: { select: { domainId: true }, take: 1 },
            },
          },
        },
        take: 1,
      });
      domainId = subjectSources[0]?.subject?.domains?.[0]?.domainId ?? null;
    } catch {
      // Domain resolution is best-effort
    }
  }

  const corrections: Array<{
    name: string;
    textSample: string | null;
    documentType: string;
    aiClassification: string | null;
  }> = [];

  // Query domain-specific corrections first
  if (domainId && config?.domainAware !== false) {
    const domainCorrections = await prisma.contentSource.findMany({
      where: {
        classificationCorrected: true,
        textSample: { not: null },
        subjects: {
          some: {
            subject: {
              domains: { some: { domainId } },
            },
          },
        },
      },
      select: {
        name: true,
        textSample: true,
        documentType: true,
        aiClassification: true,
      },
      orderBy: { updatedAt: "desc" },
      take: maxExamples,
    });
    corrections.push(...domainCorrections);
  }

  // Fill remaining slots with global corrections
  if (corrections.length < maxExamples) {
    const existingNames = new Set(corrections.map((c) => c.name));
    const global = await prisma.contentSource.findMany({
      where: {
        classificationCorrected: true,
        textSample: { not: null },
        ...(existingNames.size > 0 ? { name: { notIn: [...existingNames] } } : {}),
      },
      select: {
        name: true,
        textSample: true,
        documentType: true,
        aiClassification: true,
      },
      orderBy: { updatedAt: "desc" },
      take: maxExamples - corrections.length,
    });
    corrections.push(...global);
  }

  return corrections.map((c) => {
    const [aiType] = (c.aiClassification ?? "").split(":");
    return {
      textSample: (c.textSample ?? "").substring(0, exampleSampleSize),
      fileName: c.name,
      documentType: c.documentType as DocumentType,
      reasoning: aiType
        ? `Originally classified as ${aiType}, corrected to ${c.documentType}`
        : `Classified as ${c.documentType} by admin`,
    };
  });
}

// ------------------------------------------------------------------
// Multi-point sampling
// ------------------------------------------------------------------

/**
 * Build a multi-point sample from document text.
 *
 * Instead of only reading the first N characters (which misses answer keys,
 * exercises, and other sections later in the document), samples from three
 * positions: start (40%), middle (30%), end (30%).
 *
 * This ensures the classifier sees the full pedagogical structure of
 * composite documents (e.g., worksheets with reading + exercises + answers).
 */
export function buildMultiPointSample(fullText: string, totalSize: number): string {
  if (fullText.length <= totalSize) return fullText;

  const startSize = Math.floor(totalSize * 0.4);
  const middleSize = Math.floor(totalSize * 0.3);
  const endSize = totalSize - startSize - middleSize;

  const startSample = fullText.substring(0, startSize);

  const midPoint = Math.floor(fullText.length / 2);
  const middleStart = Math.max(startSize, midPoint - Math.floor(middleSize / 2));
  const middleSample = fullText.substring(middleStart, middleStart + middleSize);

  const endStart = Math.max(middleStart + middleSize, fullText.length - endSize);
  const endSample = fullText.substring(endStart);

  return [
    "[START OF DOCUMENT]",
    startSample,
    "",
    "[MIDDLE OF DOCUMENT]",
    middleSample,
    "",
    "[END OF DOCUMENT]",
    endSample,
  ].join("\n");
}

// ------------------------------------------------------------------
// Classification
// ------------------------------------------------------------------

/**
 * Classify a document's type using AI.
 *
 * Uses multi-point sampling (start + middle + end) for better coverage
 * of composite documents. Examines the text sample and filename to
 * determine the pedagogical role of the document.
 *
 * When fewShotExamples are provided, they are appended to the user prompt
 * so the AI can learn from past admin corrections.
 *
 * Falls back to TEXTBOOK with confidence 0.0 and classificationFailed=true on any error.
 */
export async function classifyDocument(
  textSample: string,
  fileName: string,
  extractionConfig: ExtractionConfig,
  fewShotExamples?: ClassificationExample[],
): Promise<ClassificationResult> {
  // Declared front-matter overrides AI inference. The educator's declaration
  // is the authoritative classification when present. See docs/CONTENT-PIPELINE.md §3.x
  // and the conflict matrix in §5 — declared wins, AI is fallback.
  const declaration = parseContentDeclaration(textSample);
  if (declaration.documentType) {
    console.log(
      `[classify-document] Declared document type override: ${fileName} → ${declaration.documentType} (skipped AI inference)`,
    );
    const declaredResult: ClassificationResult = {
      documentType: declaration.documentType,
      confidence: 1.0,
      reasoning: `Declared by document front-matter (${declaration.format ?? "unknown"} form). AI classification skipped.`,
      source: "declared:by-doc",
      declaration,
    };
    logAI("content-trust.classify:result", `Classify ${fileName}`, JSON.stringify(declaredResult), {
      fileName,
      documentType: declaration.documentType,
      declaredOverride: true,
      format: declaration.format,
    });
    return declaredResult;
  }

  const { classification } = extractionConfig;
  const sample = buildMultiPointSample(textSample, classification.sampleSize);

  // Build few-shot section if examples are available
  const fewShotSection = fewShotExamples?.length
    ? [
        "",
        "Here are examples of correctly classified documents (learn from these):",
        "",
        ...fewShotExamples.flatMap((ex, i) => [
          `--- EXAMPLE ${i + 1} ---`,
          `Filename: ${ex.fileName}`,
          `Text: ${ex.textSample}`,
          `Correct classification: ${ex.documentType}`,
          `Note: ${ex.reasoning}`,
          `--- END EXAMPLE ${i + 1} ---`,
          "",
        ]),
        "Now classify the following document:",
        "",
      ].join("\n")
    : "";

  const userPrompt = [
    fewShotSection,
    `Filename: ${fileName}`,
    "",
    "--- TEXT SAMPLE ---",
    sample,
    "--- END SAMPLE ---",
  ].join("\n");

  try {
    // @ai-call content-trust.classify — Classify document type for extraction | config: /x/ai-config
    const timeouts = await getAITimeoutSettings();
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "content-trust.classify",
        messages: [
          { role: "system", content: classification.systemPrompt },
          { role: "user", content: userPrompt },
        ],
        timeoutMs: timeouts.classificationTimeoutMs,
      },
      { sourceOp: "content-trust:classify" },
    );

    logAssistantCall(
      {
        callPoint: "content-trust.classify",
        userMessage: `Classify ${fileName} (${sample.length} chars sample, ${fewShotExamples?.length ?? 0} examples)`,
        metadata: { fileName, fewShotCount: fewShotExamples?.length ?? 0 },
      },
      { response: "Classification complete", success: true },
    );

    // Parse response
    const text = result.content.trim();
    let jsonStr = text.startsWith("{") ? text : text.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    // Remove trailing commas
    jsonStr = jsonStr.replace(/,\s*([}\]])/g, "$1");

    const parsed = JSON.parse(jsonStr);

    const documentType: DocumentType = VALID_TYPES.includes(parsed.documentType)
      ? parsed.documentType
      : "TEXTBOOK";

    const confidence = typeof parsed.confidence === "number"
      ? Math.max(0, Math.min(1, parsed.confidence))
      : 0.5;

    // Post-classification filename sanity check — override when the filename
    // explicitly names a type but the AI returned something generic (e.g. TEXTBOOK).
    const hint = filenameTypeHint(fileName);
    if (hint && hint.type !== documentType) {
      console.log(
        `[classify-document] Filename hint override: ${fileName} AI=${documentType} → ${hint.type}`,
      );
      const overriddenResult: ClassificationResult = {
        documentType: hint.type,
        confidence: Math.max(confidence, 0.85),
        reasoning: `${parsed.reasoning || "No reasoning provided"} [Filename signal: "${fileName}" → ${hint.type}]`,
        declaration: declaration.hasDeclaration ? declaration : undefined,
      };
      logAI("content-trust.classify:result", `Classify ${fileName}`, JSON.stringify(overriddenResult), {
        fileName, documentType: hint.type, confidence: overriddenResult.confidence, filenameOverride: true,
      });
      return overriddenResult;
    }

    // #276 Slice 1: content-based rubric override. When the text sample is
    // unmistakably a tutor-facing rubric (band descriptors, scoring criteria)
    // but the AI returned a generic learner-facing type (TEXTBOOK / REFERENCE
    // / CURRICULUM), force COURSE_REFERENCE so the MCQ exclusion gate fires.
    // Filename-hint already ran above; this catches the generic-filename case.
    if (
      documentType !== "COURSE_REFERENCE" &&
      ["TEXTBOOK", "REFERENCE", "CURRICULUM"].includes(documentType) &&
      isRubricContent(sample)
    ) {
      console.log(
        `[classify-document] Rubric content override: ${fileName} AI=${documentType} → COURSE_REFERENCE (rubric markers detected in sample)`,
      );
      const overriddenResult: ClassificationResult = {
        documentType: "COURSE_REFERENCE" as DocumentType,
        confidence: Math.max(confidence, 0.85),
        reasoning: `${parsed.reasoning || "No reasoning provided"} [Content signal: rubric markers detected (band descriptors / scoring criteria) → COURSE_REFERENCE]`,
        declaration: declaration.hasDeclaration ? declaration : undefined,
      };
      logAI("content-trust.classify:result", `Classify ${fileName}`, JSON.stringify(overriddenResult), {
        fileName, documentType: "COURSE_REFERENCE", confidence: overriddenResult.confidence, contentOverride: true,
      });
      return overriddenResult;
    }

    const classifiedResult: ClassificationResult = {
      documentType,
      confidence,
      reasoning: parsed.reasoning || "No reasoning provided",
      // Pass the declaration through even when documentType wasn't declared —
      // downstream consumers (extractor, classifyLo, save-questions) still
      // honour `audience` / `loSystemRole` / `defaultCategory` / `questionAssessmentUse`.
      declaration: declaration.hasDeclaration ? declaration : undefined,
    };
    logAI("content-trust.classify:result", `Classify ${fileName}`, JSON.stringify(classifiedResult), {
      fileName, documentType, confidence,
    });
    return classifiedResult;
  } catch (error: any) {
    console.error("[classify-document] Classification failed, defaulting to TEXTBOOK:", error?.message);
    logAI("content-trust.classify:error", `Classify ${fileName}`, error?.message || "unknown error", {
      fileName, sourceOp: "content-trust:classify",
    });
    return {
      documentType: "TEXTBOOK",
      confidence: 0.0,
      reasoning: `Classification failed: ${error?.message || "unknown error"}. Defaulted to Textbook — please verify and correct if needed.`,
      classificationFailed: true,
    };
  }
}
