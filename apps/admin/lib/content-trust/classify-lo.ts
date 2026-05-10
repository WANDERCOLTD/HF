/**
 * LO Audience Classifier (#317)
 *
 * Decides whether a Learning Objective is for the LEARNER (visible on the
 * curriculum page) or for the SYSTEM (assessor prompt / item generator /
 * score reveal). Hybrid: a heuristic regex pass catches the unambiguous
 * cases cheaply; ambiguous LOs fall through to a single LLM call.
 *
 * Output is a `LoClassifierProposal` shaped exactly for the
 * `validateLoClassification()` guard. This module does NO database writes
 * — the caller (ingestion hook or reclassify CLI) wires the guard's
 * decision into a $transaction with the LO update + history row create.
 *
 * classifierVersion stamping:
 *   - Heuristic hits: "heuristic-v1"
 *   - LLM hits:       "llm:<model>+<promptHash>"
 *   - LLM failures:   "llm-fallback-v1" with confidence 0
 *
 * Re-running with a newer heuristic / model / prompt produces a different
 * version string, so re-runs aren't deduped against the prior history row.
 */

import pLimit from "p-limit";
import { jsonrepair } from "jsonrepair";
import { getConfiguredMeteredAICompletion } from "@/lib/metering/instrumented-ai";
import { getAITimeoutSettings } from "@/lib/system-settings";
import { getPromptTemplate } from "@/lib/prompts/prompt-settings";
import { logAssistantCall } from "@/lib/ai/assistant-wrapper";
import { logAI } from "@/lib/logger";
import type { LoClassifierProposal } from "./validate-lo-classification";
import type { LoSystemRole } from "@prisma/client";

// ── Types ──────────────────────────────────────────────

export interface ClassifyLoInput {
  loId: string;
  ref: string;
  description: string;
  /** Optional context that improves LLM disambiguation. */
  moduleTitle?: string | null;
  moduleDescription?: string | null;
  courseTitle?: string | null;
}

export type ClassifierSource = "heuristic" | "llm" | "fallback";

export interface ClassifyLoResult {
  proposal: LoClassifierProposal;
  source: ClassifierSource;
  /** Raw LLM response text — populated on LLM/fallback paths for audit. */
  rawJson?: string;
}

// ── Heuristic patterns ─────────────────────────────────
//
// Each pattern is paired with a target systemRole + a confidence the heuristic
// is willing to assert. Matches are conservative: a false positive here ships
// to the LO row without LLM second-opinion, so we only match when the
// description is unambiguous. Anything ambiguous falls through to the LLM.

interface HeuristicRule {
  pattern: RegExp;
  systemRole: LoSystemRole;
  confidence: number;
  reason: string;
}

const HEURISTIC_RULES: ReadonlyArray<HeuristicRule> = [
  // ASSESSOR_RUBRIC — naming rubric criteria, band descriptors, characteristics of bands
  {
    pattern: /\bidentify\s+band\s+\d/i,
    systemRole: "ASSESSOR_RUBRIC",
    confidence: 0.95,
    reason: "names band-specific characteristics — rubric content for the assessor",
  },
  {
    pattern: /\bcharacteristics?\s+of\s+(band|level)\s+\d/i,
    systemRole: "ASSESSOR_RUBRIC",
    confidence: 0.95,
    reason: "describes characteristics of a specific band — rubric criteria",
  },
  {
    // "Identify the four criteria" / "Identify the four assessment criteria"
    // / "Identify the three core criteria of fluency". Allows up to 2
    // intermediate adjectives between the count word and the head noun.
    pattern: /\bidentify\s+the\s+(?:four|three|five|six|seven|two|\d+)\s+(?:\w+\s+){0,2}(?:criteri(?:a|on)|standards|rubrics?)\b/i,
    systemRole: "ASSESSOR_RUBRIC",
    confidence: 0.95,
    reason: "identifies the N rubric criteria — assessor knowledge",
  },
  {
    pattern: /\b(band|rubric|scoring|grading|marking)\s+(descriptor|criteria|criterion|rubric)\b/i,
    systemRole: "ASSESSOR_RUBRIC",
    confidence: 0.9,
    reason: "describes scoring rubric or band descriptors",
  },
  {
    pattern: /\bexplain\s+\w+\s+as\s+the\s+assessment\s+of\b/i,
    systemRole: "ASSESSOR_RUBRIC",
    confidence: 0.9,
    reason: "defines a criterion as 'the assessment of X' — rubric framing",
  },

  // SCORE_EXPLAINER — meta-knowledge about how scores are computed/aggregated
  {
    pattern: /\b(explain|describe)\s+(the\s+)?(averaging|weighting|aggregation|aggregating|score\s+calculation|grade\s+calculation)\b/i,
    systemRole: "SCORE_EXPLAINER",
    confidence: 0.95,
    reason: "explains how scores are aggregated — score-reveal disclosure content",
  },
  {
    pattern: /\bhow\s+(scores?|bands?|grades?)\s+(are|is)\s+(calculated|computed|averaged|determined|aggregated)\b/i,
    systemRole: "SCORE_EXPLAINER",
    confidence: 0.95,
    reason: "describes score-calculation mechanics",
  },
  {
    pattern: /\b(describe|explain)\s+(the\s+)?band\s+descriptor\s+(structure|breakdown|hierarchy)\b/i,
    systemRole: "SCORE_EXPLAINER",
    confidence: 0.9,
    reason: "describes how the band descriptor structure is organised",
  },

  // ITEM_GENERATOR_SPEC — boundary specs for question generation
  {
    pattern: /\bdistinguish(ing)?\s+(?:band\s+\d+\/\d+|features?\s+(of|between)\s+band)/i,
    systemRole: "ITEM_GENERATOR_SPEC",
    confidence: 0.85,
    reason: "boundary spec between bands — used by question generator",
  },
  {
    pattern: /\bband\s+\d+\s+vs\s+\d+\b/i,
    systemRole: "ITEM_GENERATOR_SPEC",
    confidence: 0.85,
    reason: "band-comparison spec for item generation",
  },
];

// Strong learner-facing performance verbs at the head of the description.
// When matched AND no system-role pattern fires, we can confidently assert
// systemRole=NONE without an LLM call. The LLM still produces a polished
// performanceStatement on second-pass — the heuristic only confirms the
// audience, leaving performanceStatement = description (caller can
// optionally re-run an LLM pass to refine it).
const LEARNER_PERFORMANCE_VERBS = /^\s*(speak|paraphrase|summari[sz]e|rephrase|argue|present|deliver|practi[sc]e|apply|compare|contrast|analy[sz]e|evaluate|create|design|build|solve|calculate|complete|perform|produce|write|read aloud|listen)\b/i;

// ── Helpers ────────────────────────────────────────────

const HEURISTIC_VERSION = "heuristic-v1";

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(16);
}

function buildLlmVersion(model: string, promptText: string): string {
  return `llm:${model}+${djb2(promptText).slice(0, 8)}`;
}

// ── Heuristic pass ─────────────────────────────────────

/**
 * Try to classify an LO with regex rules alone. Returns null when no rule
 * fires confidently — caller then runs the LLM.
 */
export function classifyLoHeuristic(input: ClassifyLoInput): ClassifyLoResult | null {
  const text = input.description ?? "";

  for (const rule of HEURISTIC_RULES) {
    if (rule.pattern.test(text)) {
      return {
        proposal: {
          loId: input.loId,
          classifierVersion: HEURISTIC_VERSION,
          learnerVisible: false,
          performanceStatement: null,
          systemRole: rule.systemRole,
          confidence: rule.confidence,
          rationale: rule.reason,
        },
        source: "heuristic",
      };
    }
  }

  // Strong learner-facing verb at start AND no rubric markers → confident NONE.
  // We DON'T set performanceStatement here (heuristic can't rewrite); leave
  // null so the validator falls back to `description` at render time. The
  // optional LLM polish pass can fill this in later.
  if (LEARNER_PERFORMANCE_VERBS.test(text) && text.length >= 12) {
    return {
      proposal: {
        loId: input.loId,
        classifierVersion: HEURISTIC_VERSION,
        learnerVisible: true,
        // null = renderer falls back to `description`; LLM polish can refine later
        performanceStatement: null,
        systemRole: "NONE",
        confidence: 0.85,
        rationale: "learner-facing performance verb at head of LO description",
      },
      source: "heuristic",
    };
  }

  return null;
}

// ── LLM pass ───────────────────────────────────────────

interface LlmRawOutput {
  systemRole?: string;
  learnerVisible?: boolean;
  performanceStatement?: string | null;
  confidence?: number;
  rationale?: string;
}

const LLM_FALLBACK_VERSION = "llm-fallback-v1";

/**
 * Call the LLM to classify a single LO. Always returns a proposal, even on
 * AI failure — the fallback proposal has confidence 0 so the guard routes
 * it to the review queue rather than auto-applying.
 */
export async function classifyLoLlm(input: ClassifyLoInput): Promise<ClassifyLoResult> {
  const prompt = await getPromptTemplate("lo-audience-classifier");
  const userMsg = buildUserMessage(input);

  try {
    // @ai-call content-trust.classify-lo — Classify LO audience for #317 | config: /x/ai-config
    const timeouts = await getAITimeoutSettings();
    const result = await getConfiguredMeteredAICompletion(
      {
        callPoint: "content-trust.classify-lo",
        messages: [
          { role: "system", content: prompt },
          { role: "user", content: userMsg },
        ],
        timeoutMs: timeouts.classificationTimeoutMs,
      },
      { sourceOp: "content-trust:classify-lo" },
    );

    const raw = result.content.trim();
    let jsonStr = raw.startsWith("{") ? raw : raw.replace(/^```json?\n?/, "").replace(/\n?```$/, "");
    // LLM outputs sometimes contain embedded slashes, IPA notation, smart
    // quotes, or trailing commas that break JSON.parse. jsonrepair fixes
    // these without losing data — same pattern used elsewhere in the
    // codebase (#314 / generate-mcqs.ts).
    let parsed: LlmRawOutput;
    try {
      parsed = JSON.parse(jsonStr) as LlmRawOutput;
    } catch {
      parsed = JSON.parse(jsonrepair(jsonStr)) as LlmRawOutput;
    }

    const systemRole = (parsed.systemRole ?? "NONE") as LoSystemRole;
    const learnerVisible =
      typeof parsed.learnerVisible === "boolean" ? parsed.learnerVisible : systemRole === "NONE";
    const performanceStatement =
      typeof parsed.performanceStatement === "string"
        ? parsed.performanceStatement.trim() || null
        : null;
    const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0.5;
    const rationale =
      typeof parsed.rationale === "string" ? parsed.rationale.trim() || null : null;

    logAssistantCall(
      {
        callPoint: "content-trust.classify-lo",
        userMessage: `Classify LO ${input.ref} (${input.description.length} chars)`,
        metadata: { loId: input.loId, ref: input.ref, model: result.model },
      },
      { response: "classify-lo complete", success: true },
    );

    return {
      proposal: {
        loId: input.loId,
        classifierVersion: buildLlmVersion(result.model, prompt),
        learnerVisible,
        performanceStatement,
        systemRole,
        confidence,
        rationale,
      },
      source: "llm",
      rawJson: raw,
    };
  } catch (error: any) {
    const msg = error?.message ?? "unknown error";
    console.error(`[classify-lo] LLM call failed for LO ${input.ref}:`, msg);
    logAI("content-trust.classify-lo:error", `Classify LO ${input.ref}`, msg, {
      loId: input.loId,
      ref: input.ref,
      sourceOp: "content-trust:classify-lo",
    });
    // Confidence 0 routes to review queue via the guard. Keeps the row in
    // history so we know the LO was attempted but couldn't be classified.
    return {
      proposal: {
        loId: input.loId,
        classifierVersion: LLM_FALLBACK_VERSION,
        learnerVisible: true, // Fail-open to learner-visible — no row gets hidden by mistake
        performanceStatement: null,
        systemRole: "NONE",
        confidence: 0,
        rationale: `Classifier failed: ${msg}`,
      },
      source: "fallback",
    };
  }
}

function buildUserMessage(input: ClassifyLoInput): string {
  const lines: string[] = [];
  if (input.courseTitle) lines.push(`Course: ${input.courseTitle}`);
  if (input.moduleTitle) {
    lines.push(`Module: ${input.moduleTitle}`);
    if (input.moduleDescription) lines.push(`  ${input.moduleDescription}`);
  }
  lines.push("");
  lines.push(`LO ${input.ref}: ${input.description}`);
  return lines.join("\n");
}

// ── Public entry points ────────────────────────────────

/**
 * Classify a single LO. Tries the heuristic first; falls through to the LLM
 * when no heuristic rule fires.
 */
export async function classifyLo(input: ClassifyLoInput): Promise<ClassifyLoResult> {
  const heuristic = classifyLoHeuristic(input);
  if (heuristic) return heuristic;
  return classifyLoLlm(input);
}

/**
 * Classify a batch of LOs concurrently with a configurable concurrency cap.
 * Defaults to 4 — keeps the AI metering window happy while still finishing
 * a 100-LO curriculum in well under a minute.
 *
 * Errors in individual LOs do not abort the batch; each LO gets its own
 * result (potentially `source: "fallback"` with confidence 0).
 */
export async function classifyLoBatch(
  inputs: ClassifyLoInput[],
  options?: { concurrency?: number },
): Promise<ClassifyLoResult[]> {
  const limit = pLimit(options?.concurrency ?? 4);
  return Promise.all(inputs.map((input) => limit(() => classifyLo(input))));
}
