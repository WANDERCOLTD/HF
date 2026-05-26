/**
 * synthesizePriorCallRecap (#599 Slice 1)
 *
 * AI-synthesized prior-call recap. Wraps the templated path from
 * `loadPriorCallFeedback` (#492 Slice 3.5) with a brief diagnosis that names
 * the likely cause and offers a concrete re-entry angle — the moment of
 * highest cold-start friction on call 2+.
 *
 * Depth semantics:
 *   - "minimal" — no AI call. Returns the existing templated `summary`
 *     verbatim. Used as the safe-default fallback for every blocked gate
 *     (env var off, allowlist absent, daily cap exceeded, etc.).
 *   - "standard" — 2–3 sentences, score + likely cause + re-entry. No raw
 *     numeric scores in the output text (the eval asserts no `\d+\.\d+`).
 *   - "rich" — 3–4 sentences + one transcript-grounded observation.
 *     Transcript is hard-sliced at 6000 chars by the caller.
 *
 * Cascade discipline:
 *   - Uses `getConfiguredMeteredAICompletion` with `callPoint:
 *     "compose.prior-call-recap"`. **No explicit maxTokens/temperature**
 *     are passed at the call site — registry defaults in `lib/ai/call-points.ts`
 *     and DB AIConfig drive the cascade.
 *
 * @see lib/prompt/composition/loaders/priorCallFeedback.ts (the wrapper that
 *   gates this function behind env var → enabled → allowlist → daily cap)
 */

import { getConfiguredMeteredAICompletion } from "@/lib/metering";
import type { PriorCallFeedbackData } from "./priorCallFeedback";
import type { PriorCallRecapDepth } from "@/lib/types/json-fields";

/**
 * Maximum transcript slice fed to the synthesis prompt for the "rich" depth.
 * Bounded so a single rich synthesis call never exceeds the call-point token
 * budget regardless of source transcript length.
 */
export const RICH_TRANSCRIPT_SLICE_LIMIT = 6000;

export interface SynthesizePriorCallRecapInput {
  feedback: PriorCallFeedbackData;
  depth: PriorCallRecapDepth;
  /** Caller's first name, used for personalisation. Optional. */
  callerName?: string | null;
  /**
   * Full transcript of the prior call. Only consulted for `depth: "rich"`;
   * the function slices it to {@link RICH_TRANSCRIPT_SLICE_LIMIT} chars
   * regardless of incoming length.
   */
  transcript?: string | null;
  /** Metering context — current call being composed for. */
  callId?: string;
  callerId?: string;
  /**
   * Playbook being composed for. Threaded into `UsageEvent.metadata` so the
   * daily-cap query (`metadata->>'playbookId'`) can scope counts per course.
   */
  playbookId?: string;
}

export interface SynthesizePriorCallRecapResult {
  text: string;
  tokensUsed: number;
  latencyMs: number;
}

const MINIMAL_RESULT_TOKENS = 0;

/**
 * Synthesize a prior-call recap at the requested depth.
 *
 * For `depth: "minimal"`, returns the existing templated `feedback.summary`
 * with `tokensUsed: 0` — no AI call is made. The caller's gate sequence
 * relies on this for the safe fallback path.
 *
 * For `standard` and `rich`, fires the configured AI call point with the
 * appropriate prompt shape. Failures throw — the caller is expected to
 * try/catch and fall back to the templated path on error (matching the
 * existing `SectionDataLoader` safe-by-default policy).
 */
export async function synthesizePriorCallRecap(
  input: SynthesizePriorCallRecapInput,
): Promise<SynthesizePriorCallRecapResult> {
  const started = Date.now();

  if (input.depth === "minimal") {
    return {
      text: input.feedback.summary ?? "",
      tokensUsed: MINIMAL_RESULT_TOKENS,
      latencyMs: Date.now() - started,
    };
  }

  const { systemPrompt, userPrompt } = buildSynthesisPrompt(input);

  const aiResult = await getConfiguredMeteredAICompletion(
    {
      callPoint: "compose.prior-call-recap",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    },
    {
      callId: input.callId,
      callerId: input.callerId,
      sourceOp: "compose.prior-call-recap",
      // Daily-cap scoping. The loader's gate query filters UsageEvent rows by
      // `sourceOp = 'compose.prior-call-recap' AND metadata->>'playbookId' = $id`.
      extraMetadata: input.playbookId ? { playbookId: input.playbookId } : undefined,
    },
  );

  const tokensUsed =
    (aiResult.usage?.inputTokens ?? 0) + (aiResult.usage?.outputTokens ?? 0);

  return {
    text: aiResult.content.trim(),
    tokensUsed,
    latencyMs: Date.now() - started,
  };
}

// =============================================================
// Prompt construction
// =============================================================

interface BuiltPrompt {
  systemPrompt: string;
  userPrompt: string;
}

function buildSynthesisPrompt(
  input: SynthesizePriorCallRecapInput,
): BuiltPrompt {
  const { feedback, depth, callerName, transcript } = input;

  const learnerLabel = callerName ? callerName : "the learner";

  const systemPrompt = [
    "You are a coaching consultant briefing a 1:1 tutor on a returning learner.",
    "Your job is to write a brief, encouraging diagnosis of the learner's last attempt that the tutor will read just before greeting the learner.",
    "Speak about the learner in the third person. Be specific, kind, and forward-looking.",
    "",
    "Hard rules:",
    "- Do NOT include raw numeric scores or fractions (e.g. '5.2/9', '0.4'). Translate to qualitative language.",
    "- Do NOT congratulate or commiserate excessively. One light affective beat at most.",
    "- Do NOT speculate about the learner's emotions beyond what the evidence supports.",
    "- Output plain prose. No bullets, no headers, no markdown.",
    depth === "standard"
      ? "- Produce 2 to 3 sentences. Cover: what they struggled with, the likely cause in plain language, and one concrete re-entry angle the tutor can use."
      : "- Produce 3 to 4 sentences. Cover: what they struggled with, the likely cause, one transcript-grounded observation (cite the moment without quoting at length), and one concrete re-entry angle.",
  ].join("\n");

  const evidenceLines: string[] = [];
  evidenceLines.push(`Learner: ${learnerLabel}`);
  if (feedback.weakestParameterName) {
    evidenceLines.push(
      `Weakest area on last attempt: ${feedback.weakestParameterName}`,
    );
  }
  if (feedback.lastCallAt) {
    evidenceLines.push(`Last attempt at: ${feedback.lastCallAt}`);
  }
  if (feedback.summary) {
    evidenceLines.push(`Templated baseline summary: ${feedback.summary}`);
  }

  if (depth === "rich" && transcript) {
    const sliced = transcript.slice(0, RICH_TRANSCRIPT_SLICE_LIMIT);
    evidenceLines.push("");
    evidenceLines.push("Transcript excerpt (most recent first ~6000 chars):");
    evidenceLines.push(sliced);
  }

  const userPrompt = evidenceLines.join("\n");

  return { systemPrompt, userPrompt };
}
