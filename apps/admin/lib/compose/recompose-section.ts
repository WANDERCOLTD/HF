/**
 * Section-scoped recompose — #1558 S3b.
 *
 * Per-caller helper that:
 *
 *   1. Runs `executeComposition({ sectionsOnly: [sectionKey] })` — the full
 *      composer pipeline still executes (no transform-skip optimization in
 *      S3a), but the returned `llmPrompt` is filtered down to the
 *      requested section's outputKeys + structural fields.
 *   2. Loads the **most-recent active** `ComposedPrompt` for
 *      `(callerId, playbookId)` — the row that any subsequent call would
 *      pick up via the I-CT2 cascade.
 *   3. Merges only the section's outputKeys into the stored `llmPrompt`,
 *      leaving every sibling outputKey byte-identical. This is the AC
 *      "partial recompose for welcome does not touch onboarding text".
 *   4. **Re-renders the prose `prompt` field globally** via
 *      `renderPromptSummary(mergedLlmPrompt)` — TL decision 2026-06-14:
 *      patching a single outputKey leaves the prose summary stale
 *      (renderer interleaves sections); the correct behaviour is to
 *      re-derive the prose from the patched JSON so the two stay
 *      consistent. The byte-identical-sibling AC applies to `llmPrompt`
 *      outputKeys, NOT to the prose `prompt`.
 *   5. Bumps `PlaybookSectionStaleness` for `(playbookId, sectionKey)`
 *      via `bumpSectionHash`, hashing the patched section's content.
 *      Sibling sections' hashes are untouched (separate clocks — the
 *      S2 invariant).
 *
 * ## When NOT to call
 *
 * Mid-pipeline. The pipeline's COMPOSE stage runs end-of-run and writes
 * a fresh `ComposedPrompt`; patching mid-pipeline would race that write.
 * The route caller is expected to be educator-triggered, not
 * pipeline-triggered. We do not detect this structurally in S3b — the
 * ADR's 422 rejection is deferred until we have a "pipeline in flight"
 * signal worth depending on. Document it in the route's JSDoc and rely
 * on call-site discipline.
 *
 * ## Returned shape
 *
 * `dryRun: true` — no writes; returns `{ before, after, sectionKey }`
 *   so the route can build a previewDiff.
 *
 * `dryRun: false` — writes the patch + bumps the section hash; returns
 *   `{ composedPromptId, patched: true, sectionKey }` so the route can
 *   surface what changed.
 *
 * `null` — no active `ComposedPrompt` exists for `(callerId, playbookId)`.
 *   Recompose-section is a PATCH primitive — it does NOT mint a fresh
 *   prompt. Callers without a baseline should run `autoComposeForCaller`
 *   first (educator-side: the Designer Console's "compose now" button).
 */

import type { Prisma } from "@prisma/client";

import { executeComposition, loadComposeConfig } from "@/lib/prompt/composition";
import { renderPromptSummary } from "@/lib/prompt/composition/renderPromptSummary";
import { prisma } from "@/lib/prisma";

import { bumpSectionHash } from "./section-staleness";
import { getOutputKeysForSections } from "./section-loaders";
import type { ComposeSectionKey } from "./section";

export interface RecomposeSectionOptions {
  /** Default false. When true, no writes; returns the diff payload. */
  dryRun?: boolean;
}

export interface RecomposeSectionDryRunResult {
  dryRun: true;
  sectionKey: ComposeSectionKey;
  /** The section's outputKey-keyed slice from the stored prompt. */
  before: Record<string, unknown>;
  /** The section's outputKey-keyed slice from the fresh compose. */
  after: Record<string, unknown>;
  /** The active `ComposedPrompt.id` the preview was sourced from. */
  composedPromptId: string;
}

export interface RecomposeSectionLiveResult {
  dryRun: false;
  sectionKey: ComposeSectionKey;
  /** The patched `ComposedPrompt.id`. */
  composedPromptId: string;
  /** True when at least one outputKey moved. False when the section was
   * already byte-identical to its fresh compose (no-op write). */
  patched: boolean;
}

export type RecomposeSectionResult =
  | RecomposeSectionDryRunResult
  | RecomposeSectionLiveResult;

/**
 * Per-caller section-scoped recompose. See module header for the
 * contract.
 */
export async function recomposeSectionForCaller(
  callerId: string,
  playbookId: string,
  sectionKey: ComposeSectionKey,
  options: RecomposeSectionOptions = {},
): Promise<RecomposeSectionResult | null> {
  const dryRun = options.dryRun ?? false;

  // Step 1 — find the active baseline. No baseline = nothing to patch.
  // S3b's contract is "patch what's there"; full-mint flows through
  // `autoComposeForCaller`.
  const active = await prisma.composedPrompt.findFirst({
    where: { callerId, playbookId, status: "active" },
    orderBy: { composedAt: "desc" },
    select: { id: true, llmPrompt: true },
  });
  if (!active) return null;

  // Step 2 — fresh compose with the sectionsOnly filter. The returned
  // llmPrompt carries only the target outputKeys + structural fields.
  const { fullSpecConfig, sections } = await loadComposeConfig({});
  const composition = await executeComposition(
    callerId,
    sections,
    fullSpecConfig,
    "recompose-section",
    null,
    null,
    { sectionsOnly: [sectionKey] },
  );

  const outputKeys = getOutputKeysForSections([sectionKey]);

  // Slice the section's outputs from both the stored prompt and the
  // fresh compose. Used for dryRun + the byte-identical-sibling test.
  const storedLlmPrompt = (active.llmPrompt ?? {}) as Record<string, unknown>;
  const beforeSlice: Record<string, unknown> = {};
  const afterSlice: Record<string, unknown> = {};
  for (const key of outputKeys) {
    beforeSlice[key] = storedLlmPrompt[key];
    afterSlice[key] = (composition.llmPrompt as Record<string, unknown>)[key];
  }

  if (dryRun) {
    return {
      dryRun: true,
      sectionKey,
      before: beforeSlice,
      after: afterSlice,
      composedPromptId: active.id,
    };
  }

  // Step 3 — merge: copy the section's outputKeys from the fresh
  // compose into the stored llmPrompt; every other key is preserved
  // byte-for-byte. This is the structural guarantee behind the
  // byte-identical-sibling AC.
  const mergedLlmPrompt: Record<string, unknown> = { ...storedLlmPrompt };
  for (const key of outputKeys) {
    const next = (composition.llmPrompt as Record<string, unknown>)[key];
    if (next === undefined) {
      delete mergedLlmPrompt[key];
    } else {
      mergedLlmPrompt[key] = next;
    }
  }

  // Idempotence: if the patched section is byte-identical to the
  // stored value, skip the write + hash bump. Matches `bumpSectionHash`
  // semantics (same hash → no `staleSince` movement).
  const changed = outputKeys.some(
    (key) => JSON.stringify(beforeSlice[key]) !== JSON.stringify(afterSlice[key]),
  );
  if (!changed) {
    return {
      dryRun: false,
      sectionKey,
      composedPromptId: active.id,
      patched: false,
    };
  }

  // Step 4 — re-render the prose summary GLOBALLY from the merged
  // llmPrompt. TL decision 2026-06-14: prose interleaves sections;
  // patching one outputKey but leaving the prose stale is the worst
  // option (educator sees inconsistency at runtime). The byte-identical
  // -sibling AC explicitly applies to llmPrompt outputKeys, NOT to the
  // prose `prompt` field.
  const prompt = renderPromptSummary(
    mergedLlmPrompt as Parameters<typeof renderPromptSummary>[0],
  );

  // Step 5 — write the patch + bump the section hash inside one
  // transaction. The bump must commit with the patch so a concurrent
  // staleness reader can never observe "section hash fresh" with a
  // stored prompt that still carries the old section text.
  await prisma.$transaction(async (tx) => {
    await tx.composedPrompt.update({
      where: { id: active.id },
      data: {
        llmPrompt: mergedLlmPrompt as Prisma.InputJsonValue,
        prompt,
      },
    });
    await bumpSectionHash(playbookId, sectionKey, afterSlice, tx);
  });

  return {
    dryRun: false,
    sectionKey,
    composedPromptId: active.id,
    patched: true,
  };
}
