/**
 * Section → loader / output-key mappings — #1558 (Story 3 of EPIC #1555).
 *
 * Companion to `section.ts` (the section taxonomy). This file is the
 * **dependency graph** layer over the taxonomy: which loaders does each
 * section need (read-side), and which `llmPrompt` outputKeys does it
 * write to (write-side).
 *
 * Authored against the live `getDefaultSections()` registry in
 * `CompositionExecutor.ts:700-1080` plus the transform set in
 * `transforms/*.ts`. Cross-checked by `section-loaders.test.ts`. When a
 * transform changes which outputKey it writes, or a new section is added,
 * update BOTH this file AND `PIPELINE_STATE_SECTION_LOADERS` in the same
 * PR — section-scoped recompose silently uses stale data otherwise.
 *
 * ## Section→outputKey mapping is many-to-many
 *
 * The S1 taxonomy is opinionated at the **educator-meaningful** level (a
 * "section" is a region a teacher wants to think about), while the composer
 * works at the **implementation** level (each transform writes one
 * outputKey). One section may correspond to several outputKeys (e.g.
 * `welcome` config flows into `_quickStart` AND influences first-line
 * generation), and one outputKey may be written by transforms attributed
 * to several sections (e.g. `curriculum` carries module structure,
 * per-module mastery, AND per-LO mastery).
 *
 * For partial recompose, the route mints a NEW full `ComposedPrompt`
 * via `executeComposition()` (deterministic, no LLM calls), then patches
 * ONLY the outputKeys listed for the target section into every active
 * stored prompt. Sibling outputKeys are preserved byte-for-byte from
 * the prior stored prompt — the byte-identical-sibling AC is satisfied
 * by construction.
 *
 * ## Why the map is conservative
 *
 * Where a section's content could reasonably live in MULTIPLE outputKeys,
 * we list ALL of them. False positives (patching one extra outputKey) are
 * acceptable — the result is a slightly broader patch, not a semantic
 * bug. False negatives (forgetting an outputKey) leave stale text behind
 * after a section-scoped recompose, which IS a bug. Err on the side of
 * over-listing.
 */

import { PIPELINE_STATE_SECTION_LOADERS } from "./section";
import type { ComposeSectionKey } from "./section";

/**
 * For each `ComposeSection`, the `llmPrompt` outputKey(s) that carry the
 * section's text in a composed prompt. Used by
 * `POST /api/courses/[courseId]/recompose-section` to patch only the
 * affected outputKeys into stored `ComposedPrompt` rows.
 *
 * Empty array means the section is structurally not patchable — recompose
 * for these returns 422. None of the S1 sections fall here; the type
 * keeps the door open for future additions.
 */
export const SECTION_OUTPUT_KEYS: Record<ComposeSectionKey, readonly string[]> = {
  // kind: "config" — these influence other sections' outputs (via
  // computePedagogyMode + computeAudienceGuidance) but don't write a
  // dedicated outputKey themselves. The transforms that READ them are
  // attributed to the sections they affect (modulesGate, instructions).
  // Section-scoped recompose on these falls through to a full sweep of
  // the influenced outputKeys.
  firstCallMode: ["_quickStart", "instructions"],
  modePolicy: ["pedagogyMode", "audienceGuidance", "teachingStyle"],

  // kind: "runtime", config-sourced.
  intake: ["_quickStart"],
  welcome: ["_quickStart"],
  onboarding: ["_quickStart"],
  offboarding: ["offboarding"],
  nps: ["_quickStart"],

  // kind: "runtime", pipeline-state.
  modulesGate: ["curriculum"],
  instructions: ["instructions", "instructions_pedagogy", "instructions_voice"],
  moduleMastery: ["curriculum"],
  loMastery: ["curriculum"],
  behaviorTargets: ["behaviorTargets"],
  personality: ["personality"],
  contentTrust: ["contentTrust"],
  carryOverActions: ["_quickStart", "instructions"],
  priorCallFeedback: ["priorCallFeedback"],
};

/**
 * Returns the union of loader names that must be fresh to recompose the
 * supplied sections in isolation. Derived from
 * `PIPELINE_STATE_SECTION_LOADERS`. Used by the route for documentation
 * and by the dry-run preview to surface "these loaders will run".
 *
 * Empty result is meaningful: the section is config-sourced (no per-call
 * state) and the recompose is a pure config read.
 */
export function getLoaderDepsForSections(
  sectionKeys: readonly ComposeSectionKey[],
): readonly string[] {
  const set = new Set<string>();
  for (const key of sectionKeys) {
    for (const loader of PIPELINE_STATE_SECTION_LOADERS[key] ?? []) {
      set.add(loader);
    }
  }
  return Array.from(set).sort();
}

/**
 * Returns the union of `llmPrompt` outputKeys that carry the supplied
 * sections' text. Used by the route to scope the patch on stored
 * `ComposedPrompt` rows.
 *
 * Empty result is meaningful: the section is structurally non-patchable
 * (route returns 422). None of the S1 sections fall here today.
 */
export function getOutputKeysForSections(
  sectionKeys: readonly ComposeSectionKey[],
): readonly string[] {
  const set = new Set<string>();
  for (const key of sectionKeys) {
    for (const outputKey of SECTION_OUTPUT_KEYS[key] ?? []) {
      set.add(outputKey);
    }
  }
  return Array.from(set).sort();
}
