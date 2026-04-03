/**
 * Document Type Classification
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

// ------------------------------------------------------------------
// Types
// ------------------------------------------------------------------

export interface ClassificationResult {
  documentType: DocumentType;
  confidence: number;
  reasoning: string;
  /** True when the AI call failed and the type is a fallback default */
  classificationFailed?: boolean;
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
  { pattern: /question[_-]?bank/i, type: "QUESTION_BANK", role: "questions" },
  { pattern: /reading[_-]?passage/i, type: "READING_PASSAGE", role: "passage" },
  { pattern: /lesson[_-]?plan/i, type: "LESSON_PLAN", role: "pedagogy" },
  { pattern: /mark[_-]?scheme/i, type: "ASSESSMENT", role: "questions" },
  { pattern: /past[_-]?paper/i, type: "ASSESSMENT", role: "questions" },
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
      const overriddenResult = {
        documentType: hint.type,
        confidence: Math.max(confidence, 0.85),
        reasoning: `${parsed.reasoning || "No reasoning provided"} [Filename signal: "${fileName}" → ${hint.type}]`,
      };
      logAI("content-trust.classify:result", `Classify ${fileName}`, JSON.stringify(overriddenResult), {
        fileName, documentType: hint.type, confidence: overriddenResult.confidence, filenameOverride: true,
      });
      return overriddenResult;
    }

    const classifiedResult = {
      documentType,
      confidence,
      reasoning: parsed.reasoning || "No reasoning provided",
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
